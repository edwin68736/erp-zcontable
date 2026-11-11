package controllers

import (
	"encoding/base64"
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// RheSolController Herramientas → RH: lee en SOL los recibos por honorarios recibidos por cada empresa con su clave SOL
// y guarda el historial de consultas (ver services/rhe_sol_service.go).
type RheSolController struct {
	svc    *services.RheSolService
	access *services.AccessService
}

func NewRheSolController() *RheSolController {
	return &RheSolController{svc: services.NewRheSolService(), access: services.NewAccessService()}
}

// scoped valida el alcance del usuario sobre la empresa; si falla ya respondió el error.
func (ctrl *RheSolController) scoped(c fiber.Ctx) (companyID uint, allowed []uint, resp error) {
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

// QueryAPI GET /tools/rh-sol/:companyId/consulta?lado=receptor|emisor&desde=AAAA-MM-DD&hasta=AAAA-MM-DD
func (ctrl *RheSolController) QueryAPI(c fiber.Ctx) error {
	id, allowed, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	uid, _ := getUserID(c)
	lado, desde, hasta := c.Query("lado"), c.Query("desde"), c.Query("hasta")
	res, err := ctrl.svc.Query(id, allowed, uid, lado, desde, hasta)
	// Cada consulta (acertada o fallida) queda en el historial de la empresa; las de datos inválidos no.
	var historyID uint
	if !isInvalidParams(err) {
		historyID = ctrl.svc.RecordHistory(id, uid, lado, desde, hasta, res, err)
	}
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo consultar los recibos por honorarios")
	}
	return c.JSON(fiber.Map{"data": res, "history_id": historyID})
}

func rheSolHistoryID(c fiber.Ctx) (uint, bool) {
	n, err := strconv.ParseUint(c.Params("historyId"), 10, 64)
	return uint(n), err == nil && n > 0
}

// HistoryListAPI GET /tools/rh-sol/:companyId/history
func (ctrl *RheSolController) HistoryListAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	rows, err := ctrl.svc.ListHistory(id, c.Query("lado"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer el historial."})
	}
	return c.JSON(fiber.Map{"data": rows})
}

// HistoryGetAPI GET /tools/rh-sol/:companyId/history/:historyId — el resultado guardado.
func (ctrl *RheSolController) HistoryGetAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	hid, ok := rheSolHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de consulta inválido"})
	}
	row, res, err := ctrl.svc.GetHistory(id, hid)
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo leer la consulta")
	}
	return c.JSON(fiber.Map{"data": res, "query": row})
}

// HistoryDeleteAPI DELETE /tools/rh-sol/:companyId/history/:historyId
func (ctrl *RheSolController) HistoryDeleteAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	hid, ok := rheSolHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de consulta inválido"})
	}
	if err := ctrl.svc.DeleteHistory(id, hid); err != nil {
		return sunatErrorResponse(c, err, "No se pudo quitar la consulta")
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// HistoryClearAPI DELETE /tools/rh-sol/:companyId/history
func (ctrl *RheSolController) HistoryClearAPI(c fiber.Ctx) error {
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

// FilesAPI POST /tools/rh-sol/:companyId/archivos — {"items":[{"comprobante":"E001-20","fec_emision":"2026-10-06","emisor_doc":"10…"}],"kinds":["pdf","xml"]}.
// Baja de SUNAT el PDF y/o el XML de cada recibo recibido y los devuelve en un ZIP (en base64) con el resumen.
func (ctrl *RheSolController) FilesAPI(c fiber.Ctx) error {
	id, allowed, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	var body struct {
		Items []services.RheSolFileRef `json:"items"`
		Kinds []string                 `json:"kinds"`
	}
	if berr := c.Bind().Body(&body); berr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	uid, _ := getUserID(c)
	res, err := ctrl.svc.FetchFiles(id, allowed, uid, body.Items, body.Kinds)
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudieron bajar los archivos de los recibos")
	}
	return c.JSON(fiber.Map{"data": fiber.Map{
		"zip_base64": base64.StdEncoding.EncodeToString(res.Zip), "ok": res.OK, "files": res.Files, "failed": res.Failed, "errors": res.Errors,
	}})
}
