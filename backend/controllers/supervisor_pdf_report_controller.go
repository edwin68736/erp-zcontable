package controllers

import (
	"bytes"
	"io"
	"strconv"
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// Handlers de los módulos de informe en PDF (Informe detracciones, Siscont balances): misma lógica,
// parametrizada por módulo — ver services/supervisor_pdf_report_service.go.

// pdfReportCompanyAccess valida el alcance del usuario sobre la empresa (mismo criterio que PDT 601).
func (ctrl *SupervisorController) pdfReportCompanyAccess(c fiber.Ctx, companyID uint) error {
	if hasStudioScope(c) {
		return nil
	}
	uid, err := getUserID(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "No autenticado")
	}
	ok, aerr := ctrl.svc.CanAccessCompany(uid, companyID, false)
	if aerr != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Error de acceso")
	}
	if !ok {
		return fiber.NewError(fiber.StatusForbidden, "Sin acceso a esta empresa")
	}
	return nil
}

func fiberErrorJSON(c fiber.Ctx, err error) error {
	if e, ok := err.(*fiber.Error); ok {
		return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
}

func pdfReportListParams(c fiber.Ctx, allowed []uint) services.PdfReportListParams {
	assistantID, _ := strconv.ParseUint(strings.TrimSpace(c.Query("assistant_user_id", "")), 10, 64)
	return services.PdfReportListParams{
		PeriodYM:          c.Query("period_ym", ""),
		Status:            c.Query("status", ""),
		Q:                 c.Query("q", ""),
		Dig:               c.Query("dig", ""),
		AssistantUserID:   uint(assistantID),
		SupervisorUserID:  queryUserID(c, "supervisor_user_id"),
		AllowedCompanyIDs: allowed,
	}
}

// PdfReportListAPI GET /api/supervisors/activity-modules/:slug
func (ctrl *SupervisorController) PdfReportListAPI(mod services.PdfReportModule) fiber.Handler {
	return func(c fiber.Ctx) error {
		allowed, err := ctrl.allowedCompanyIDs(c)
		if err != nil {
			return fiberErrorJSON(c, err)
		}
		params := pdfReportListParams(c, allowed)
		params.Page, params.PerPage = paginationFromQuery(c)
		out, err := ctrl.svc.ListPdfReport(mod, params)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		if out.Rows == nil {
			out.Rows = []services.PdfReportListRow{}
		}
		return c.JSON(fiber.Map{
			"data": out.Rows,
			"pagination": fiber.Map{
				"page": out.Page, "per_page": out.PerPage, "total": out.Total, "total_pages": out.TotalPages,
			},
		})
	}
}

// PdfReportExportAPI GET /api/supervisors/activity-modules/:slug/export — todas las empresas que
// matchean los filtros, sin paginar (reporte Excel).
func (ctrl *SupervisorController) PdfReportExportAPI(mod services.PdfReportModule) fiber.Handler {
	return func(c fiber.Ctx) error {
		allowed, err := ctrl.allowedCompanyIDs(c)
		if err != nil {
			return fiberErrorJSON(c, err)
		}
		rows, err := ctrl.svc.ExportPdfReport(mod, pdfReportListParams(c, allowed))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		if rows == nil {
			rows = []services.PdfReportListRow{}
		}
		return c.JSON(fiber.Map{"data": rows})
	}
}

func pdfReportCompanyAndPeriod(c fiber.Ctx) (uint, string, error) {
	companyID, err := strconv.ParseUint(c.Params("companyId"), 10, 32)
	if err != nil || companyID == 0 {
		return 0, "", fiber.NewError(fiber.StatusBadRequest, "empresa inválida")
	}
	periodYM := strings.TrimSpace(c.Query("period_ym", ""))
	if periodYM == "" {
		return 0, "", fiber.NewError(fiber.StatusBadRequest, "period_ym requerido")
	}
	return uint(companyID), periodYM, nil
}

// PdfReportDetailAPI GET /api/supervisors/activity-modules/:slug/companies/:companyId
func (ctrl *SupervisorController) PdfReportDetailAPI(mod services.PdfReportModule) fiber.Handler {
	return func(c fiber.Ctx) error {
		companyID, periodYM, err := pdfReportCompanyAndPeriod(c)
		if err != nil {
			return fiberErrorJSON(c, err)
		}
		if err := ctrl.pdfReportCompanyAccess(c, companyID); err != nil {
			return fiberErrorJSON(c, err)
		}
		row, err := ctrl.svc.EnsurePdfReport(mod, companyID, periodYM)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"data": row})
	}
}

// PdfReportSubmitAPI POST /api/supervisors/activity-modules/:slug/companies/:companyId/submit
// (multipart: file + fecha_entrega). Guarda el PDF (reemplaza al anterior), registra la fecha de
// cumplimiento y deja la entrega "Por revisar".
func (ctrl *SupervisorController) PdfReportSubmitAPI(mod services.PdfReportModule) fiber.Handler {
	return func(c fiber.Ctx) error {
		companyID, periodYM, err := pdfReportCompanyAndPeriod(c)
		if err != nil {
			return fiberErrorJSON(c, err)
		}
		if err := ctrl.pdfReportCompanyAccess(c, companyID); err != nil {
			return fiberErrorJSON(c, err)
		}
		uid, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		fh, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "archivo requerido"})
		}
		if !strings.HasSuffix(strings.ToLower(fh.Filename), ".pdf") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "solo se permite un archivo PDF"})
		}
		if fh.Size > 10*1024*1024 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "archivo máximo 10 MB"})
		}

		// Se valida el estado ANTES de guardar el archivo en disco, para no dejar huérfanos si la
		// entrega se rechaza (suspendida / ya aprobada).
		detail, err := ctrl.svc.EnsurePdfReport(mod, companyID, periodYM)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		if err := services.CheckPdfReportSubmittable(detail); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}

		if _, err := services.ParsePdfReportFechaEntrega(c.FormValue("fecha_entrega", "")); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}

		f, err := fh.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		defer f.Close()
		data := make([]byte, fh.Size)
		if _, err := io.ReadFull(f, data); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		if !bytes.HasPrefix(data, []byte("%PDF")) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "el archivo no es un PDF válido"})
		}
		url, err := ctrl.svc.StoreSupervisorUpload(fh.Filename, data)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		out, err := ctrl.svc.SubmitPdfReport(mod, detail, uid, fh.Filename, url, c.FormValue("fecha_entrega", ""))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": out})
	}
}
