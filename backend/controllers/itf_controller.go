package controllers

import (
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// ItfController Herramientas → Consulta ITF: lee en SOL el Impuesto a las Transacciones Financieras de cada empresa
// con su clave SOL y guarda el historial de consultas (ver services/sunat_itf_service.go).
type ItfController struct {
	svc    *services.SunatItfService
	access *services.AccessService
}

func NewItfController() *ItfController {
	return &ItfController{svc: services.NewSunatItfService(), access: services.NewAccessService()}
}

// scoped valida el alcance del usuario sobre la empresa; si falla ya respondió el error.
func (ctrl *ItfController) scoped(c fiber.Ctx) (companyID uint, allowed []uint, resp error) {
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

// QueryAPI GET /tools/itf/:companyId/consulta?desde=AAAAMM&hasta=AAAAMM
func (ctrl *ItfController) QueryAPI(c fiber.Ctx) error {
	id, allowed, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	uid, _ := getUserID(c)
	desde, hasta := c.Query("desde"), c.Query("hasta")
	res, err := ctrl.svc.Query(id, allowed, uid, desde, hasta)
	// Cada consulta (acertada o fallida) queda en el historial de la empresa; las de datos inválidos no.
	var historyID uint
	if !isInvalidParams(err) {
		historyID = ctrl.svc.RecordHistory(id, uid, desde, hasta, res, err)
	}
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo consultar el ITF")
	}
	return c.JSON(fiber.Map{"data": res, "history_id": historyID})
}

func itfHistoryID(c fiber.Ctx) (uint, bool) {
	n, err := strconv.ParseUint(c.Params("historyId"), 10, 64)
	return uint(n), err == nil && n > 0
}

// HistoryListAPI GET /tools/itf/:companyId/history
func (ctrl *ItfController) HistoryListAPI(c fiber.Ctx) error {
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

// HistoryGetAPI GET /tools/itf/:companyId/history/:historyId — el resultado guardado.
func (ctrl *ItfController) HistoryGetAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	hid, ok := itfHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de consulta inválido"})
	}
	row, res, err := ctrl.svc.GetHistory(id, hid)
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo leer la consulta")
	}
	return c.JSON(fiber.Map{"data": res, "query": row})
}

// HistoryDeleteAPI DELETE /tools/itf/:companyId/history/:historyId
func (ctrl *ItfController) HistoryDeleteAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	hid, ok := itfHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de consulta inválido"})
	}
	if err := ctrl.svc.DeleteHistory(id, hid); err != nil {
		return sunatErrorResponse(c, err, "No se pudo quitar la consulta")
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// HistoryClearAPI DELETE /tools/itf/:companyId/history
func (ctrl *ItfController) HistoryClearAPI(c fiber.Ctx) error {
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
