package controllers

import (
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
)

const sireDownloadsMaxBatch = 12

// scoped valida el alcance del usuario sobre la empresa (sin pedir credenciales de SUNAT) y devuelve su RUC.
func (ctrl *SireController) scoped(c fiber.Ctx) (uint, string, error) {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		return 0, "", c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "No tiene acceso"})
	}
	id, perr := strconv.ParseUint(c.Params("companyId"), 10, 64)
	if perr != nil || id == 0 {
		return 0, "", c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	ruc, serr := ctrl.svc.CompanyRUC(uint(id), allowed)
	if serr != nil {
		return 0, "", ctrl.fail(c, serr)
	}
	return uint(id), ruc, nil
}

// DownloadsListAPI GET /tools/sire/:companyId/downloads?libro= — historial de consultas de la empresa.
func (ctrl *SireController) DownloadsListAPI(c fiber.Ctx) error {
	id, _, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	rows, lerr := ctrl.svc.ListDownloads(id, c.Query("libro"))
	if lerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer el historial."})
	}
	return c.JSON(fiber.Map{"data": rows})
}

// DownloadsCreateAPI POST /tools/sire/:companyId/downloads — {"libro":"compras","period":"202610"} o {"periods":[...]}.
// Cada período queda como una consulta del historial que se procesa en segundo plano.
func (ctrl *SireController) DownloadsCreateAPI(c fiber.Ctx) error {
	sess, id, err := ctrl.session(c)
	if sess == nil {
		return err
	}
	var body struct {
		Libro   string   `json:"libro"`
		Period  string   `json:"period"`
		Periods []string `json:"periods"`
		Mode    string   `json:"mode"`
	}
	if berr := c.Bind().Body(&body); berr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	periods := body.Periods
	if len(periods) == 0 && strings.TrimSpace(body.Period) != "" {
		periods = []string{body.Period}
	}
	if len(periods) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Indique el período a consultar."})
	}
	if len(periods) > sireDownloadsMaxBatch {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "El máximo es de 12 períodos por vez."})
	}
	uid, _ := getUserID(c)
	out := make([]any, 0, len(periods))
	for _, p := range periods {
		row, serr := ctrl.svc.StartDownload(sess, id, uid, body.Libro, p, body.Mode)
		if serr != nil {
			return ctrl.fail(c, serr)
		}
		out = append(out, row)
	}
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"data": out})
}

func downloadID(c fiber.Ctx) (uint, bool) {
	n, err := strconv.ParseUint(c.Params("downloadId"), 10, 64)
	return uint(n), err == nil && n > 0
}

// DownloadFileAPI GET /tools/sire/:companyId/downloads/:downloadId/file — el Excel ya generado.
func (ctrl *SireController) DownloadFileAPI(c fiber.Ctx) error {
	id, ruc, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	did, ok := downloadID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de descarga inválido"})
	}
	data, name, ferr := ctrl.svc.DownloadFile(id, did, ruc)
	if ferr != nil {
		return ctrl.fail(c, ferr)
	}
	return sendSireFile(c, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data)
}

// DownloadDeleteAPI DELETE /tools/sire/:companyId/downloads/:downloadId — quita una consulta del historial.
func (ctrl *SireController) DownloadDeleteAPI(c fiber.Ctx) error {
	id, _, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	did, ok := downloadID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de descarga inválido"})
	}
	if derr := ctrl.svc.DeleteDownload(id, did); derr != nil {
		return ctrl.fail(c, derr)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// DownloadsClearAPI DELETE /tools/sire/:companyId/downloads?libro= — limpia el historial (menos lo que está en proceso).
func (ctrl *SireController) DownloadsClearAPI(c fiber.Ctx) error {
	id, _, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	n, cerr := ctrl.svc.ClearDownloads(id, c.Query("libro"))
	if cerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo limpiar el historial."})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"removed": n}})
}

// SaveCredentialsAPI PUT /tools/sire/:companyId/credentials — {"client_id":"…","client_secret":"…"}.
// Guarda solo las credenciales de API SIRE de la empresa; no devuelve el secreto.
func (ctrl *SireController) SaveCredentialsAPI(c fiber.Ctx) error {
	id, _, err := ctrl.scoped(c)
	if id == 0 {
		return err
	}
	allowed, aerr := ctrl.allowedCompanyIDs(c)
	if aerr != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "No tiene acceso"})
	}
	var body struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
	}
	if berr := c.Bind().Body(&body); berr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	uid, _ := getUserID(c)
	if serr := ctrl.svc.SaveCredentials(id, uid, allowed, body.ClientID, body.ClientSecret); serr != nil {
		return ctrl.fail(c, serr)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"sire_configurado": true}})
}
