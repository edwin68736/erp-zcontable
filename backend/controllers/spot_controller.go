package controllers

import (
	"mime"
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// SpotController Herramientas → Consulta de Detracciones: baja de la plataforma de Pagos de SUNAT los pagos de
// detracciones (constancias de depósito) de cada empresa con su clave SOL. Corre en segundo plano y queda en el historial
// de la empresa con el Excel y las constancias (ver services/sunat_spot_service.go). Solo lectura.
type SpotController struct {
	svc    *services.SunatSpotService
	access *services.AccessService
}

func NewSpotController() *SpotController {
	return &SpotController{svc: services.NewSunatSpotService(), access: services.NewAccessService()}
}

// scoped valida el alcance del usuario sobre la empresa; si falla ya respondió el error.
func (ctrl *SpotController) scoped(c fiber.Ctx) (companyID uint, allowed []uint, resp error) {
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

// StartAPI POST /tools/detracciones/:companyId/descargas — los filtros de la pantalla de SUNAT:
// {"tipo_cuenta":"1","tipo_pago":"individuales","modo":"fecha","desde":"AAAA-MM-DD","hasta":"AAAA-MM-DD"} o {"modo":"periodo","periodo":"AAAAMM"}.
// Deja la descarga «en proceso» en el historial y responde enseguida; la pantalla consulta el historial hasta que termine.
func (ctrl *SpotController) StartAPI(c fiber.Ctx) error {
	id, allowed, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	var body services.SpotFilter
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	uid, _ := getUserID(c)
	row, err := ctrl.svc.Start(id, allowed, uid, body)
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo iniciar la descarga de detracciones")
	}
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"data": row})
}

func spotHistoryID(c fiber.Ctx) (uint, bool) {
	n, err := strconv.ParseUint(c.Params("historyId"), 10, 64)
	return uint(n), err == nil && n > 0
}

// HistoryListAPI GET /tools/detracciones/:companyId/descargas
func (ctrl *SpotController) HistoryListAPI(c fiber.Ctx) error {
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

// ZipAPI GET /tools/detracciones/:companyId/descargas/:historyId/zip — el Excel y las constancias.
// ?excel=1 entrega solo el Excel del reporte.
func (ctrl *SpotController) ZipAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	hid, ok := spotHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de descarga inválido"})
	}
	row, data, err := ctrl.svc.GetZip(id, hid)
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo leer la descarga")
	}
	name := "Detracciones_" + row.CreatedAt.Format("20060102_1504") + ".zip"
	ctype := "application/zip"
	if c.Query("excel") == "1" {
		xname, xlsx, xerr := services.ZipExcel(data)
		if xerr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer el Excel guardado."})
		}
		name, data, ctype = xname, xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	}
	c.Set("Content-Type", ctype)
	c.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	return c.Send(data)
}

// HistoryDeleteAPI DELETE /tools/detracciones/:companyId/descargas/:historyId
func (ctrl *SpotController) HistoryDeleteAPI(c fiber.Ctx) error {
	id, _, resp := ctrl.scoped(c)
	if id == 0 {
		return resp
	}
	hid, ok := spotHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de descarga inválido"})
	}
	if err := ctrl.svc.DeleteHistory(id, hid); err != nil {
		return sunatErrorResponse(c, err, "No se pudo quitar la descarga")
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// HistoryClearAPI DELETE /tools/detracciones/:companyId/descargas
func (ctrl *SpotController) HistoryClearAPI(c fiber.Ctx) error {
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
