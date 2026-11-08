package controllers

import (
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// DamController Herramientas → Consulta DAM: lee en SOL las Declaraciones Aduaneras de Mercancías (exportación) de
// cada empresa con su clave SOL. La búsqueda es lenta, así que corre en segundo plano y queda en el historial de la
// empresa (ver services/sunat_dam_service.go). Solo lectura.
type DamController struct {
	svc    *services.SunatDamService
	access *services.AccessService
}

func NewDamController() *DamController {
	return &DamController{svc: services.NewSunatDamService(), access: services.NewAccessService()}
}

// scoped valida el alcance del usuario sobre la empresa; si falla ya respondió el error.
func (ctrl *DamController) scoped(c fiber.Ctx) (companyID uint, allowed []uint, resp error) {
	var err error
	if !hasStudioScope(c) {
		uid, uerr := getUserID(c)
		if uerr != nil {
			return 0, nil, c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		if allowed, err = ctrl.access.GetAllowedCompanyIDs(uid); err != nil {
			return 0, nil, c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "No tiene acceso"})
		}
	}
	id, perr := strconv.ParseUint(c.Params("companyId"), 10, 64)
	if perr != nil || id == 0 {
		return 0, nil, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	if serr := ctrl.svc.InScope(uint(id), allowed); serr != nil {
		return 0, nil, sunatErrorResponse(c, serr, "Sin acceso a la empresa")
	}
	return uint(id), allowed, nil
}

// StartAPI POST /tools/dam/:companyId/consulta — {"desde":"AAAA-MM-DD","hasta":"AAAA-MM-DD"}.
// Deja la consulta «en proceso» en el historial y responde enseguida; la pantalla consulta el historial hasta que termine.
func (ctrl *DamController) StartAPI(c fiber.Ctx) error {
	id, allowed, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	var body struct {
		Desde string `json:"desde"`
		Hasta string `json:"hasta"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	uid, _ := getUserID(c)
	row, err := ctrl.svc.Start(id, allowed, uid, body.Desde, body.Hasta)
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo iniciar la consulta de DAM")
	}
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"data": row})
}

func damHistoryID(c fiber.Ctx) (uint, bool) {
	n, err := strconv.ParseUint(c.Params("historyId"), 10, 64)
	return uint(n), err == nil && n > 0
}

// HistoryListAPI GET /tools/dam/:companyId/history
func (ctrl *DamController) HistoryListAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	rows, err := ctrl.svc.ListHistory(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer el historial."})
	}
	return c.JSON(fiber.Map{"data": rows})
}

// HistoryGetAPI GET /tools/dam/:companyId/history/:historyId — el resultado guardado.
func (ctrl *DamController) HistoryGetAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	hid, ok := damHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de consulta inválido"})
	}
	row, res, err := ctrl.svc.GetHistory(id, hid)
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo leer la consulta")
	}
	return c.JSON(fiber.Map{"data": res, "query": row})
}

// HistoryDeleteAPI DELETE /tools/dam/:companyId/history/:historyId
func (ctrl *DamController) HistoryDeleteAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	hid, ok := damHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de consulta inválido"})
	}
	if err := ctrl.svc.DeleteHistory(id, hid); err != nil {
		return sunatErrorResponse(c, err, "No se pudo quitar la consulta")
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// HistoryClearAPI DELETE /tools/dam/:companyId/history
func (ctrl *DamController) HistoryClearAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	n, err := ctrl.svc.ClearHistory(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo limpiar el historial."})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"removed": n}})
}
