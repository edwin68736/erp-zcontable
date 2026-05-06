package controllers

import (
	"math"
	"strconv"
	"time"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type TaxSettlementController struct {
	svc    *services.TaxSettlementService
	access *services.AccessService
}

func NewTaxSettlementController() *TaxSettlementController {
	return &TaxSettlementController{
		svc:    services.NewTaxSettlementService(),
		access: services.NewAccessService(),
	}
}

func (ctrl *TaxSettlementController) attachCanRegisterPayment(ts *models.TaxSettlement) {
	if ts == nil {
		return
	}
	if ts.Status != models.TaxSettlementStatusIssued {
		ts.CanRegisterPayment = false
		return
	}
	can, err := ctrl.svc.CanRegisterPayment(ts.ID)
	if err != nil {
		ts.CanRegisterPayment = false
		return
	}
	ts.CanRegisterPayment = can
}

func (ctrl *TaxSettlementController) ensureCompanyAccess(c fiber.Ctx, companyID uint) error {
	if companyID == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "empresa inválida")
	}
	if isAdmin(c) {
		return nil
	}
	uid, err := getUserID(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "No autenticado")
	}
	ok, err := ctrl.access.CanAccessCompany(uid, companyID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Error de acceso")
	}
	if !ok {
		return fiber.NewError(fiber.StatusForbidden, "Sin acceso a esta empresa")
	}
	return nil
}

// PreviewSettlementsAPI GET /api/companies/:id/settlements/preview
func (ctrl *TaxSettlementController) PreviewSettlementsAPI(c fiber.Ctx) error {
	cid, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || cid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de empresa inválido"})
	}
	companyID := uint(cid)
	if err := ctrl.ensureCompanyAccess(c, companyID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	var asOf *time.Time
	if raw := c.Query("as_of", ""); raw != "" {
		t, e := time.ParseInLocation("2006-01-02", raw, time.Local)
		if e != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "as_of inválido (use YYYY-MM-DD)"})
		}
		end := time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, time.Local)
		asOf = &end
	}
	lines, err := ctrl.svc.PreviewOpenDocuments(companyID, asOf)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": lines})
}

func (ctrl *TaxSettlementController) ListAPI(c fiber.Ctx) error {
	params := services.TaxSettlementListParams{
		Status: c.Query("status", ""),
		Page:   1,
		PerPage: 20,
	}
	if v := c.Query("company_id", ""); v != "" {
		if id, err := strconv.ParseUint(v, 10, 32); err == nil && id > 0 {
			params.CompanyID = uint(id)
		}
	}
	if v := c.Query("page", "1"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			params.Page = p
		}
	}
	if v := c.Query("per_page", "20"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			params.PerPage = n
		}
	}

	if !isAdmin(c) {
		uid, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		ids, err := ctrl.access.GetAllowedCompanyIDs(uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		params.AllowedCompanyIDs = ids
		if params.CompanyID > 0 {
			if err := ctrl.ensureCompanyAccess(c, params.CompanyID); err != nil {
				if e, ok := err.(*fiber.Error); ok {
					return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
				}
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
			}
		}
	}

	list, total, err := ctrl.svc.ListPaged(params)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	for i := range list {
		ctrl.attachCanRegisterPayment(&list[i])
	}
	perPage := params.PerPage
	if perPage <= 0 {
		perPage = 20
	}
	totalPages := 0
	if perPage > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(perPage)))
	}
	return c.JSON(fiber.Map{
		"data": list,
		"pagination": fiber.Map{
			"page":        params.Page,
			"per_page":    perPage,
			"total":       total,
			"total_pages": totalPages,
		},
	})
}

func (ctrl *TaxSettlementController) CreateAPI(c fiber.Ctx) error {
	var body services.TaxSettlementCreateInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.ensureCompanyAccess(c, body.CompanyID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
	}
	ts, err := ctrl.svc.CreateDraft(body)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	ctrl.attachCanRegisterPayment(ts)
	return c.Status(fiber.StatusCreated).JSON(ts)
}

// PaymentSuggestionsAPI GET /api/tax-settlements/:id/payment-suggestions — imputaciones sugeridas para el pago (deudas de la liquidación con saldo).
func (ctrl *TaxSettlementController) PaymentSuggestionsAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	ts0, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No encontrado"})
	}
	if err := ctrl.ensureCompanyAccess(c, ts0.CompanyID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
	}
	if ts0.Status != models.TaxSettlementStatusIssued {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "solo las liquidaciones emitidas permiten sugerencias de pago"})
	}
	res, err := ctrl.svc.PaymentSuggestions(uint(id))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(res)
}

func (ctrl *TaxSettlementController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	ts, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No encontrado"})
	}
	if err := ctrl.ensureCompanyAccess(c, ts.CompanyID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
	}
	ctrl.attachCanRegisterPayment(ts)
	return c.JSON(ts)
}

func (ctrl *TaxSettlementController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	ts0, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No encontrado"})
	}
	if err := ctrl.ensureCompanyAccess(c, ts0.CompanyID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
	}
	var body services.TaxSettlementUpdateInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	ts, err := ctrl.svc.UpdateDraft(uint(id), body)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	ctrl.attachCanRegisterPayment(ts)
	return c.JSON(ts)
}

func (ctrl *TaxSettlementController) EmitAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	ts0, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No encontrado"})
	}
	if err := ctrl.ensureCompanyAccess(c, ts0.CompanyID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
	}
	ts, err := ctrl.svc.Emit(uint(id))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	ctrl.attachCanRegisterPayment(ts)
	return c.JSON(ts)
}

// DeleteAPI DELETE /api/tax-settlements/:id — elimina la liquidación y revierte pagos y vínculos asociados.
func (ctrl *TaxSettlementController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	ts0, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No encontrado"})
	}
	if err := ctrl.ensureCompanyAccess(c, ts0.CompanyID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
	}
	if err := ctrl.svc.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Liquidación eliminada"})
}
