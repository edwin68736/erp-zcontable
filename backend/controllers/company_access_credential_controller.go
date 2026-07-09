package controllers

import (
	"bytes"
	"io"
	"path/filepath"
	"strconv"
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type CompanyAccessCredentialController struct {
	svc    *services.CompanyAccessCredentialService
	access *services.AccessService
}

func NewCompanyAccessCredentialController() *CompanyAccessCredentialController {
	return &CompanyAccessCredentialController{
		svc:    services.NewCompanyAccessCredentialService(),
		access: services.NewAccessService(),
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

	out, err := ctrl.svc.List(services.CompanyAccessCredentialListParams{
		Q:                 c.Query("q", ""),
		Page:              page,
		PerPage:           perPage,
		AllowedCompanyIDs: allowed,
		AssistantUserID:   uint(assistantID),
		SupervisorUserID:  uint(supervisorID),
		Dig:               c.Query("dig", ""),
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
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
	out, err := ctrl.svc.FilterFacets(allowed)
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
	row, err := ctrl.svc.Upsert(uint(companyID), body, allowed)
	if err != nil {
		if strings.Contains(err.Error(), "no encontrada") || strings.Contains(err.Error(), "alcance") {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
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
