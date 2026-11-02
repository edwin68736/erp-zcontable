package controllers

import (
	"mime"
	"net/http"
	"strconv"
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// SireController consulta y descarga del SIRE (RVIE/RCE) de cada empresa, usando las credenciales de API
// guardadas en Claves SOL. Fase 1: solo lectura (ver services/sire_service.go).
type SireController struct {
	svc    *services.SireService
	access *services.AccessService
}

func NewSireController() *SireController {
	return &SireController{svc: services.NewSireService(), access: services.NewAccessService()}
}

func (ctrl *SireController) allowedCompanyIDs(c fiber.Ctx) ([]uint, error) {
	if hasStudioScope(c) {
		return nil, nil
	}
	uid, err := getUserID(c)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "No autenticado")
	}
	return ctrl.access.GetAllowedCompanyIDs(uid)
}

// session valida la empresa/alcance y arma la sesión SIRE; si falla ya respondió el error.
func (ctrl *SireController) session(c fiber.Ctx) (*services.SireSession, uint, error) {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if fe, ok := err.(*fiber.Error); ok {
			return nil, 0, c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
		}
		return nil, 0, c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
	}
	id, err := strconv.ParseUint(c.Params("companyId"), 10, 64)
	if err != nil || id == 0 {
		return nil, 0, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	sess, err := ctrl.svc.Session(uint(id), allowed)
	if err != nil {
		return nil, uint(id), ctrl.fail(c, err)
	}
	return sess, uint(id), nil
}

// fail responde un error del SIRE con un estado HTTP acorde y el motivo de SUNAT.
func (ctrl *SireController) fail(c fiber.Ctx, err error) error {
	var se *services.SireError
	if errorsAs(err, &se) {
		status := fiber.StatusUnprocessableEntity
		switch se.Code {
		case services.SireErrOutOfScope:
			status = fiber.StatusForbidden
		case services.SireErrUnavailable:
			status = fiber.StatusBadGateway
		case services.SireErrInvalidParams:
			status = fiber.StatusBadRequest
		}
		return c.Status(status).JSON(fiber.Map{"error": se.Message, "code": se.Code, "detail": se.Detail})
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo completar la consulta al SIRE"})
}

func errorsAs(err error, target **services.SireError) bool {
	se, ok := err.(*services.SireError)
	if ok {
		*target = se
	}
	return ok
}

func (ctrl *SireController) logAccess(c fiber.Ctx, companyID uint, err error) {
	if uid, uerr := getUserID(c); uerr == nil {
		ctrl.svc.LogAccess(companyID, uid, err)
	}
}

func sendSireFile(c fiber.Ctx, name, contentType string, data []byte) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Set("Content-Type", contentType)
	c.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	c.Set("Cache-Control", "no-store")
	return c.Send(data)
}

func queryInt(c fiber.Ctx, key string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(c.Query(key, ""))); err == nil {
		return n
	}
	return def
}

// CatalogAPI GET /tools/sire/catalog?libro=ventas|compras
func (ctrl *SireController) CatalogAPI(c fiber.Ctx) error {
	libro := strings.ToLower(strings.TrimSpace(c.Query("libro", "ventas")))
	if services.SireCodLibro(libro) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Libro no válido (use ventas o compras)"})
	}
	return c.JSON(fiber.Map{"data": services.SireCatalog(libro)})
}

// TestAPI POST /tools/sire/:companyId/test — comprueba las credenciales de API de la empresa.
func (ctrl *SireController) TestAPI(c fiber.Ctx) error {
	sess, id, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	terr := sess.TestConnection()
	ctrl.logAccess(c, id, terr)
	if terr != nil {
		return ctrl.fail(c, terr)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

func libroFrom(c fiber.Ctx) string { return strings.ToLower(strings.TrimSpace(c.Query("libro", "ventas"))) }

// PeriodsAPI GET /tools/sire/:companyId/periods?libro=
func (ctrl *SireController) PeriodsAPI(c fiber.Ctx) error {
	sess, _, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	data, perr := sess.Periods(libroFrom(c))
	if perr != nil {
		return ctrl.fail(c, perr)
	}
	return c.JSON(fiber.Map{"data": data})
}

// TicketsAPI GET /tools/sire/:companyId/tickets?libro=&per_ini=&per_fin=&page=&per_page=&ticket=
func (ctrl *SireController) TicketsAPI(c fiber.Ctx) error {
	sess, _, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	data, terr := sess.Tickets(libroFrom(c), strings.TrimSpace(c.Query("per_ini")), strings.TrimSpace(c.Query("per_fin")),
		queryInt(c, "page", 1), queryInt(c, "per_page", 20), c.Query("ticket"))
	if terr != nil {
		return ctrl.fail(c, terr)
	}
	return c.JSON(fiber.Map{"data": data})
}

// RequestReportAPI POST /tools/sire/:companyId/reports/request — pide un reporte por ticket.
// Cuerpo: {"libro":"ventas","report":"propuesta","period":"202609","params":{"tipo_archivo":"0"}}
func (ctrl *SireController) RequestReportAPI(c fiber.Ctx) error {
	sess, id, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	var body struct {
		Libro  string            `json:"libro"`
		Report string            `json:"report"`
		Period string            `json:"period"`
		Params map[string]string `json:"params"`
	}
	if berr := c.Bind().Body(&body); berr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	ticket, rerr := sess.RequestTicket(strings.ToLower(strings.TrimSpace(body.Libro)), strings.TrimSpace(body.Report), strings.TrimSpace(body.Period), body.Params)
	ctrl.logAccess(c, id, rerr)
	if rerr != nil {
		return ctrl.fail(c, rerr)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ticket": ticket}})
}

// DirectReportAPI GET /tools/sire/:companyId/reports/direct?libro=&report=&period=&<campos del reporte>
// Descarga un reporte de respuesta inmediata (casillas, estadístico, cumplimiento).
func (ctrl *SireController) DirectReportAPI(c fiber.Ctx) error {
	sess, id, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	params := map[string]string{}
	for k, v := range c.Queries() {
		params[k] = v
	}
	f, ferr := sess.DirectFile(libroFrom(c), strings.TrimSpace(c.Query("report")), strings.TrimSpace(c.Query("period")), params)
	ctrl.logAccess(c, id, ferr)
	if ferr != nil {
		return ctrl.fail(c, ferr)
	}
	return sendSireFile(c, f.Name, f.ContentType, f.Data)
}

// SummaryAPI GET /tools/sire/:companyId/summary?libro=&period=&tipo=1..7&format=0|1&mode=preview|download
func (ctrl *SireController) SummaryAPI(c fiber.Ctx) error {
	sess, _, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	format := c.Query("format", "1")
	f, serr := sess.Summary(libroFrom(c), strings.TrimSpace(c.Query("period")), c.Query("tipo", "1"), format)
	if serr != nil {
		return ctrl.fail(c, serr)
	}
	if c.Query("mode") == "download" {
		return sendSireFile(c, f.Name, f.ContentType, f.Data)
	}
	return ctrl.previewTables(c, f.Data, f.Name)
}

// previewTables arma la respuesta de vista previa: lista de tablas y la página pedida de una de ellas.
func (ctrl *SireController) previewTables(c fiber.Ctx, data []byte, name string) error {
	tables, perr := services.ParseSireArchive(data, name)
	if perr != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "No se pudo leer el archivo descargado de SUNAT", "code": services.SireErrUnexpected})
	}
	list := make([]fiber.Map, 0, len(tables))
	for _, t := range tables {
		list = append(list, fiber.Map{"name": t.Name, "total": t.Total})
	}
	resp := fiber.Map{"tables": list}
	if len(tables) > 0 {
		idx := queryInt(c, "table", 0)
		if idx < 0 || idx >= len(tables) {
			idx = 0
		}
		resp["table"] = tables[idx].Page(queryInt(c, "page", 1), queryInt(c, "per_page", 100), c.Query("q"))
		resp["table_index"] = idx
	}
	return c.JSON(fiber.Map{"data": resp})
}

// InconsistenciesAPI GET /tools/sire/:companyId/inconsistencies?libro=&period=&tipo=1..6
func (ctrl *SireController) InconsistenciesAPI(c fiber.Ctx) error {
	sess, _, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	data, ierr := sess.Inconsistencies(libroFrom(c), strings.TrimSpace(c.Query("period")), c.Query("tipo", "1"))
	if ierr != nil {
		return ctrl.fail(c, ierr)
	}
	return c.JSON(fiber.Map{"data": data})
}

// PreliminaresAPI GET /tools/sire/:companyId/preliminares?per_ini=&per_fin=&page=&per_page=
func (ctrl *SireController) PreliminaresAPI(c fiber.Ctx) error {
	sess, _, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	data, perr := sess.Preliminares(strings.TrimSpace(c.Query("per_ini")), strings.TrimSpace(c.Query("per_fin")), queryInt(c, "page", 1), queryInt(c, "per_page", 20))
	if perr != nil {
		return ctrl.fail(c, perr)
	}
	return c.JSON(fiber.Map{"data": data})
}

// FV0621API GET /tools/sire/:companyId/fv0621?period=
func (ctrl *SireController) FV0621API(c fiber.Ctx) error {
	sess, _, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	data, ferr := sess.FV0621(strings.TrimSpace(c.Query("period")))
	if ferr != nil {
		return ctrl.fail(c, ferr)
	}
	return c.JSON(fiber.Map{"data": data})
}

// AjustesAPI GET /tools/sire/:companyId/ajustes?period=&page=&per_page=
func (ctrl *SireController) AjustesAPI(c fiber.Ctx) error {
	sess, _, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	data, aerr := sess.AjustesRCE(strings.TrimSpace(c.Query("period")), queryInt(c, "page", 1), queryInt(c, "per_page", 20))
	if aerr != nil {
		return ctrl.fail(c, aerr)
	}
	return c.JSON(fiber.Map{"data": data})
}

// ConstanciaAPI GET /tools/sire/:companyId/constancia?libro=&name=
func (ctrl *SireController) ConstanciaAPI(c fiber.Ctx) error {
	sess, id, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	f, cerr := sess.Constancia(libroFrom(c), c.Query("name"))
	ctrl.logAccess(c, id, cerr)
	if cerr != nil {
		return ctrl.fail(c, cerr)
	}
	return sendSireFile(c, f.Name, f.ContentType, f.Data)
}

// TicketFileAPI GET /tools/sire/:companyId/tickets/file?libro=&name=&type=&period=&proceso=&ticket=&mode=preview|download
// Archivo generado por un ticket terminado: se descarga tal cual (ZIP) o se muestra como tabla.
func (ctrl *SireController) TicketFileAPI(c fiber.Ctx) error {
	sess, id, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	name := strings.TrimSpace(c.Query("name"))
	data, ferr := sess.TicketFile(services.TicketFileParams{
		Libro:    libroFrom(c),
		Name:     name,
		TypeCode: c.Query("type"),
		Period:   strings.TrimSpace(c.Query("period")),
		Proceso:  c.Query("proceso"),
		Ticket:   c.Query("ticket"),
	})
	if m := c.Query("mode"); m == "download" || m == "excel" {
		ctrl.logAccess(c, id, ferr)
	}
	if ferr != nil {
		return ctrl.fail(c, ferr)
	}
	if c.Query("mode") == "excel" {
		return ctrl.sendExcel(c, sess, data, name)
	}
	if c.Query("mode") == "download" {
		ct := http.DetectContentType(data)
		if len(data) > 2 && data[0] == 'P' && data[1] == 'K' {
			ct = "application/zip"
		}
		return sendSireFile(c, name, ct, data)
	}
	return ctrl.previewTables(c, data, name)
}

// sendExcel convierte el archivo del ticket (TXT/CSV de SUNAT) en un Excel válido y lo envía.
func (ctrl *SireController) sendExcel(c fiber.Ctx, sess *services.SireSession, data []byte, name string) error {
	tables, err := services.ParseSireArchive(data, name)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "No se pudo leer el archivo que entregó SUNAT.", "code": services.SireErrUnexpected, "detail": err.Error()})
	}
	libro, period := libroFrom(c), strings.TrimSpace(c.Query("period"))
	xlsx, rows, err := services.SireExcelFromTables(tables, libro)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "No se pudo generar el Excel con lo que entregó SUNAT.", "code": services.SireErrUnexpected, "detail": err.Error()})
	}
	if rows == 0 {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "SUNAT no tiene comprobantes en la propuesta de este período.", "code": "sin_datos"})
	}
	return sendSireFile(c, services.SireExcelFileName(sess.RUC(), period, libro), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx)
}
