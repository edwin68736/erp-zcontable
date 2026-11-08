package controllers

import (
	"strconv"
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// RheListAPI GET /tools/rh/:companyId/comprobantes?tipo=C|V&cod_cpe=02|01&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&estados=01,03
// Consulta la plataforma de confirmación del RHE y de la FE (api-cpe) con las credenciales de API de la empresa.
func (ctrl *SireController) RheListAPI(c fiber.Ctx) error {
	sess, id, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	q := services.RheQuery{
		Tipo:   c.Query("tipo", services.RheTipoCompras),
		CodCpe: c.Query("cod_cpe", "02"),
		Desde:  c.Query("desde"),
		Hasta:  c.Query("hasta"),
	}
	if e := strings.TrimSpace(c.Query("estados")); e != "" {
		q.Estados = strings.Split(e, ",")
	}
	res, lerr := sess.RheList(q)
	if uid, uerr := getUserID(c); uerr == nil {
		ctrl.svc.LogAccessTarget("rhe", id, uid, lerr)
	}
	// Cada consulta (acertada o fallida) queda en el historial de la empresa.
	uid, _ := getUserID(c)
	historyID := ctrl.svc.RecordRheHistory(id, uid, q, res, lerr)
	if lerr != nil {
		return ctrl.fail(c, lerr)
	}
	return c.JSON(fiber.Map{"data": res, "estados": services.RheEstados, "motivos": services.RheMotivos, "history_id": historyID})
}

func rheHistoryID(c fiber.Ctx) (uint, bool) {
	n, err := strconv.ParseUint(c.Params("historyId"), 10, 64)
	return uint(n), err == nil && n > 0
}

// RheHistoryListAPI GET /tools/rh/:companyId/history — historial de consultas de la empresa (sin los resultados).
func (ctrl *SireController) RheHistoryListAPI(c fiber.Ctx) error {
	id, _, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	rows, lerr := ctrl.svc.ListRheHistory(id)
	if lerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer el historial."})
	}
	return c.JSON(fiber.Map{"data": rows})
}

// RheHistoryGetAPI GET /tools/rh/:companyId/history/:historyId — el resultado guardado de una consulta.
func (ctrl *SireController) RheHistoryGetAPI(c fiber.Ctx) error {
	id, _, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	hid, ok := rheHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de consulta inválido"})
	}
	row, res, gerr := ctrl.svc.GetRheHistory(id, hid)
	if gerr != nil {
		return ctrl.fail(c, gerr)
	}
	return c.JSON(fiber.Map{"data": res, "query": row, "estados": services.RheEstados, "motivos": services.RheMotivos})
}

// RheHistoryDeleteAPI DELETE /tools/rh/:companyId/history/:historyId — quita una consulta del historial.
func (ctrl *SireController) RheHistoryDeleteAPI(c fiber.Ctx) error {
	id, _, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	hid, ok := rheHistoryID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de consulta inválido"})
	}
	if derr := ctrl.svc.DeleteRheHistory(id, hid); derr != nil {
		return ctrl.fail(c, derr)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// RheHistoryClearAPI DELETE /tools/rh/:companyId/history — vacía el historial de la empresa.
func (ctrl *SireController) RheHistoryClearAPI(c fiber.Ctx) error {
	id, _, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	n, cerr := ctrl.svc.ClearRheHistory(id)
	if cerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo limpiar el historial."})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"removed": n}})
}
