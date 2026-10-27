package controllers

import (
	"bytes"
	"errors"
	"io"
	"path/filepath"
	"strconv"
	"strings"

	"miappfiber/rbac"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type CompanyAccessCredentialController struct {
	svc    *services.CompanyAccessCredentialService
	access *services.AccessService
	sunat  *services.SunatSolAccessService
}

func NewCompanyAccessCredentialController() *CompanyAccessCredentialController {
	return &CompanyAccessCredentialController{
		svc:    services.NewCompanyAccessCredentialService(),
		access: services.NewAccessService(),
		sunat:  services.NewSunatSolAccessService(),
	}
}

func (ctrl *CompanyAccessCredentialController) allowedCompanyIDs(c fiber.Ctx) ([]uint, error) {
	if hasStudioScope(c) {
		return nil, nil
	}
	uid, err := getUserID(c)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "No autenticado")
	}
	return ctrl.access.GetAllowedCompanyIDs(uid)
}

// redactSol vacía usuario y clave SOL si el usuario no tiene permiso de verlos: nunca salen del
// servidor (no basta con ocultar la columna en pantalla). SolConfigurado se mantiene.
func (ctrl *CompanyAccessCredentialController) redactSol(c fiber.Ctx, rows []services.CompanyAccessCredentialRow) {
	uid, err := getUserID(c)
	if err == nil && services.Authz().HasPermission(uid, rbac.CompanyCredentialsSolView) {
		return
	}
	for i := range rows {
		rows[i].SolUsuario = ""
		rows[i].SolClave = ""
	}
}

// inactiveOnlyFromQuery lee ?status=inactivo: ver las claves de empresas inactivas es solo del administrador
// (alcance de estudio); cualquier otro usuario recibe un error en vez de datos que no le corresponden.
func inactiveOnlyFromQuery(c fiber.Ctx) (bool, error) {
	if strings.ToLower(strings.TrimSpace(c.Query("status", ""))) != "inactivo" {
		return false, nil
	}
	if !hasStudioScope(c) {
		return false, errors.New("solo el administrador puede ver las empresas inactivas")
	}
	return true, nil
}

func (ctrl *CompanyAccessCredentialController) ListAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if fe, ok := err.(*fiber.Error); ok {
			return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
	}

	page, _ := strconv.Atoi(c.Query("page", "1"))
	perPage, _ := strconv.Atoi(c.Query("per_page", "20"))

	assistantID, _ := strconv.ParseUint(strings.TrimSpace(c.Query("assistant_user_id", "")), 10, 64)
	supervisorID, _ := strconv.ParseUint(strings.TrimSpace(c.Query("supervisor_user_id", "")), 10, 64)

	inactiveOnly, ferr := inactiveOnlyFromQuery(c)
	if ferr != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": ferr.Error()})
	}

	out, err := ctrl.svc.List(services.CompanyAccessCredentialListParams{
		Q:                 c.Query("q", ""),
		Page:              page,
		PerPage:           perPage,
		AllowedCompanyIDs: allowed,
		AssistantUserID:   uint(assistantID),
		SupervisorUserID:  uint(supervisorID),
		Dig:               c.Query("dig", ""),
		InactiveOnly:      inactiveOnly,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	ctrl.redactSol(c, out.Rows)
	return c.JSON(fiber.Map{
		"data":        out.Rows,
		"total":       out.Total,
		"page":        out.Page,
		"per_page":    out.PerPage,
		"total_pages": out.TotalPages,
	})
}

func (ctrl *CompanyAccessCredentialController) FilterFacetsAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if fe, ok := err.(*fiber.Error); ok {
			return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
	}
	inactiveOnly, ferr := inactiveOnlyFromQuery(c)
	if ferr != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": ferr.Error()})
	}
	out, err := ctrl.svc.FilterFacets(allowed, inactiveOnly)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": out})
}

func (ctrl *CompanyAccessCredentialController) GetAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if fe, ok := err.(*fiber.Error); ok {
			return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
	}
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 64)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	row, err := ctrl.svc.GetByCompanyID(uint(companyID), allowed)
	if err != nil {
		if strings.Contains(err.Error(), "no encontrada") || strings.Contains(err.Error(), "alcance") {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if row != nil {
		rows := []services.CompanyAccessCredentialRow{*row}
		ctrl.redactSol(c, rows)
		row = &rows[0]
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *CompanyAccessCredentialController) UpdateAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if fe, ok := err.(*fiber.Error); ok {
			return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
	}
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 64)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	var body services.CompanyAccessCredentialUpdateInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	// Quien no puede ver usuario/clave SOL los recibe vacíos: al guardar se conservan los guardados
	// (si no, editar otra clave borraría la SOL).
	if uid, uerr := getUserID(c); uerr != nil || !services.Authz().HasPermission(uid, rbac.CompanyCredentialsSolView) {
		if cur, cerr := ctrl.svc.GetByCompanyID(uint(companyID), allowed); cerr == nil && cur != nil {
			body.SolUsuario, body.SolClave = cur.SolUsuario, cur.SolClave
		}
	}
	row, err := ctrl.svc.Upsert(uint(companyID), body, allowed)
	if err != nil {
		if strings.Contains(err.Error(), "no encontrada") || strings.Contains(err.Error(), "alcance") {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if row != nil {
		rows := []services.CompanyAccessCredentialRow{*row}
		ctrl.redactSol(c, rows)
		row = &rows[0]
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *CompanyAccessCredentialController) ImportTemplateAPI(c fiber.Ctx) error {
	buf, err := services.CompanyAccessCredentialImportTemplateXLSX()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Set("Content-Disposition", `attachment; filename="plantilla_claves_acceso_empresas.xlsx"`)
	return c.Send(buf)
}

func (ctrl *CompanyAccessCredentialController) ImportAPI(c fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Adjunte un archivo en el campo file"})
	}
	if fh.Size <= 0 || fh.Size > 8<<20 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Archivo vacío o demasiado grande (máx. 8 MB)"})
	}
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if ext != ".xlsx" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Solo se admite Excel .xlsx (no CSV)"})
	}
	src, err := fh.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No se pudo leer el archivo"})
	}
	raw, err := io.ReadAll(src)
	_ = src.Close()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No se pudo leer el archivo"})
	}

	reader := bytes.NewReader(raw)
	size := int64(len(raw))
	dry := c.Query("dry_run") == "1" || strings.EqualFold(strings.TrimSpace(c.Query("dry_run")), "true")

	if dry {
		rowErrs, n, unmatched, vErr := services.CompanyAccessCredentialImportValidate(reader, size)
		if vErr != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": vErr.Error()})
		}
		ok := len(rowErrs) == 0
		return c.JSON(fiber.Map{
			"ok":              ok,
			"row_count":       n,
			"errors":          rowErrs,
			"unmatched_rucs":  unmatched,
			"unmatched_count": len(unmatched),
		})
	}

	updated, unmatched, valErrs, err := services.CompanyAccessCredentialImportCommit(reader, size)
	if len(valErrs) > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"ok":     false,
			"errors": valErrs,
		})
	}
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{
		"ok":              true,
		"updated":         updated,
		"unmatched_rucs":  unmatched,
		"unmatched_count": len(unmatched),
	})
}

// SunatAccessAPI POST /finance/company-credentials/:companyId/sunat-access
// Genera el enlace de acceso directo a SUNAT, Pagos o SUNAFIL (Clave SOL) de la empresa: el servidor hace el login por
// detrás y devuelve un enlace de un solo uso para abrir en el navegador. Ver services/sunat_sol_access_service.go.
func (ctrl *CompanyAccessCredentialController) SunatAccessAPI(c fiber.Ctx) error {
	allowed, err := ctrl.allowedCompanyIDs(c)
	if err != nil {
		if fe, ok := err.(*fiber.Error); ok {
			return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
	}
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 64)
	if err != nil || companyID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	// Destino opcional en el cuerpo: "sunat" (por defecto), "pagos" o "sunafil".
	var body struct {
		Target string `json:"target"`
	}
	_ = c.Bind().Body(&body)
	res, err := ctrl.sunat.Generate(uint(companyID), allowed, uid, strings.TrimSpace(body.Target))
	if err != nil {
		var ae *services.SunatSolAccessError
		if errors.As(err, &ae) {
			status := fiber.StatusUnprocessableEntity
			switch ae.Code {
			case services.SunatAccessOutOfScope:
				status = fiber.StatusForbidden
			case services.SunatAccessInProgress:
				status = fiber.StatusConflict
			case services.SunatAccessUnavailable:
				status = fiber.StatusBadGateway
			}
			return c.Status(status).JSON(fiber.Map{"error": ae.Message, "code": ae.Code, "detail": ae.Detail})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo generar el acceso"})
	}
	return c.JSON(fiber.Map{"data": res})
}
