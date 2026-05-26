package controllers

import (
	"math"
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type FiscalReceiptController struct {
	svc    *services.FiscalReceiptService
	access *services.AccessService
}

func NewFiscalReceiptController() *FiscalReceiptController {
	return &FiscalReceiptController{
		svc:    services.NewFiscalReceiptService(),
		access: services.NewAccessService(),
	}
}

func (ctrl *FiscalReceiptController) ensureCompanyAccess(c fiber.Ctx, companyID uint) error {
	if companyID == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "empresa inválida")
	}
	if hasStudioScope(c) {
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

func (ctrl *FiscalReceiptController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	rec, err := ctrl.svc.GetFiscalReceiptDetail(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Comprobante no encontrado"})
	}
	if err := ctrl.ensureCompanyAccess(c, rec.CompanyID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": rec})
}

func (ctrl *FiscalReceiptController) ListFiscalReceiptsAPI(c fiber.Ctx) error {
	status := c.Query("status", "")
	ruc := c.Query("ruc", "")
	number := c.Query("number", "")
	companyIDStr := c.Query("company_id", "")

	page := 1
	if v := c.Query("page", "1"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			page = p
		}
	}
	perPage := 20
	if v := c.Query("per_page", "20"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			perPage = n
			if perPage > 200 {
				perPage = 200
			}
		}
	}

	var companyID *uint
	if companyIDStr != "" {
		if id64, err := strconv.ParseUint(companyIDStr, 10, 32); err == nil && id64 > 0 {
			v := uint(id64)
			companyID = &v
		}
	}

	var taxSettlementID *uint
	if ts := c.Query("tax_settlement_id", ""); ts != "" {
		if id64, err := strconv.ParseUint(ts, 10, 32); err == nil && id64 > 0 {
			v := uint(id64)
			taxSettlementID = &v
		}
	}

	needsSettlement := c.Query("needs_settlement", "") == "1" || c.Query("needs_settlement", "") == "true"

	params := services.FiscalReceiptListParams{
		Status:          status,
		Origin:          c.Query("origin", ""),
		CompanyID:       companyID,
		Ruc:             ruc,
		Number:          number,
		TaxSettlementID: taxSettlementID,
		NeedsSettlement: needsSettlement,
		Page:            page,
		PerPage:         perPage,
	}

	list, total, err := ctrl.svc.ListFiscalReceiptsPaged(params)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	totalPages := 0
	if perPage > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(perPage)))
	}

	return c.JSON(fiber.Map{
		"data": list,
		"pagination": fiber.Map{
			"page":        page,
			"per_page":    perPage,
			"total":       total,
			"total_pages": totalPages,
		},
	})
}

func (ctrl *FiscalReceiptController) CreatePaymentFromReceiptAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body services.ReceiptPaymentInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.svc.CreatePaymentFromReceipt(uint(id), body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Pago creado y comprobante vinculado"})
}

func (ctrl *FiscalReceiptController) LinkReceiptAPI(c fiber.Ctx) error {
	rid, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		PaymentID uint `json:"payment_id"`
	}
	if err := c.Bind().Body(&body); err != nil || body.PaymentID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "payment_id requerido"})
	}
	if err := ctrl.svc.LinkReceiptToPayment(uint(rid), body.PaymentID); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Comprobante vinculado al pago"})
}

func (ctrl *FiscalReceiptController) PatchReceiptTaxSettlementAPI(c fiber.Ctx) error {
	rid, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || rid == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		TaxSettlementID *uint `json:"tax_settlement_id"`
		Unlink          bool  `json:"unlink"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	rec, err := ctrl.svc.GetFiscalReceiptByID(uint(rid))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Comprobante no encontrado"})
	}
	if err := ctrl.ensureCompanyAccess(c, rec.CompanyID); err != nil {
		if e, ok := err.(*fiber.Error); ok {
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
	}
	var linkErr error
	if body.Unlink {
		linkErr = ctrl.svc.LinkReceiptToTaxSettlement(uint(rid), nil)
	} else if body.TaxSettlementID != nil && *body.TaxSettlementID > 0 {
		tid := *body.TaxSettlementID
		linkErr = ctrl.svc.LinkReceiptToTaxSettlement(uint(rid), &tid)
	} else {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Indique tax_settlement_id o unlink: true"})
	}
	if linkErr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": linkErr.Error()})
	}
	return c.JSON(fiber.Map{"message": "Vínculo con liquidación actualizado"})
}

func (ctrl *FiscalReceiptController) DiscardReceiptAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.svc.DiscardFiscalReceipt(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Comprobante descartado"})
}
