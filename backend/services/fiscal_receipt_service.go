package services

import (
	"errors"
	"math"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// FiscalReceiptService bandeja y conciliación de comprobantes fiscales locales.
type FiscalReceiptService struct{}

func NewFiscalReceiptService() *FiscalReceiptService {
	return &FiscalReceiptService{}
}

// ReceiptPaymentInput opciones al crear pago desde comprobante fiscal.
type ReceiptPaymentInput struct {
	AllocationMode  string                   `json:"allocation_mode"`
	Allocations     []PaymentAllocationInput `json:"allocations"`
	Method          string                   `json:"method"`
	Reference       string                   `json:"reference"`
	Attachment      string                   `json:"attachment"`
	Description     string                   `json:"description"`
	Notes           string                   `json:"notes"`
	TaxSettlementID *uint                    `json:"tax_settlement_id"`
}

// FiscalReceiptListParams filtros y paginación para la bandeja de comprobantes.
type FiscalReceiptListParams struct {
	Status          string
	Origin          string
	CompanyID       *uint
	Ruc             string
	Number          string
	TaxSettlementID *uint
	NeedsSettlement bool
	Page            int
	PerPage         int
}

func buildFiscalReceiptListQuery(params FiscalReceiptListParams) *gorm.DB {
	q := database.DB.Model(&models.TukifacFiscalReceipt{})
	if strings.TrimSpace(params.Status) != "" {
		q = q.Where("reconciliation_status = ?", strings.TrimSpace(params.Status))
	}
	if o := strings.TrimSpace(params.Origin); o != "" {
		q = q.Where("origin = ?", o)
	}
	if params.CompanyID != nil && *params.CompanyID > 0 {
		q = q.Where("company_id = ?", *params.CompanyID)
	}
	if r := strings.TrimSpace(params.Ruc); r != "" {
		like := "%" + r + "%"
		sub := database.DB.Model(&models.Company{}).Select("id").Where("ruc LIKE ?", like)
		q = q.Where("(customer_number LIKE ?) OR (company_id IN (?))", like, sub)
	}
	if n := strings.TrimSpace(params.Number); n != "" {
		q = q.Where("number LIKE ?", "%"+n+"%")
	}
	if params.TaxSettlementID != nil && *params.TaxSettlementID > 0 {
		tid := *params.TaxSettlementID
		q = q.Where(
			"tax_settlement_id = ? OR linked_payment_id IN (SELECT id FROM payments WHERE tax_settlement_id = ? AND deleted_at IS NULL)",
			tid, tid,
		)
	}
	if params.NeedsSettlement {
		q = q.Where(`
			(tax_settlement_id IS NULL OR tax_settlement_id = 0)
			AND (
				linked_payment_id IS NULL OR NOT EXISTS (
					SELECT 1 FROM payments p
					WHERE p.id = tukifac_fiscal_receipts.linked_payment_id
					AND p.deleted_at IS NULL
					AND p.tax_settlement_id IS NOT NULL AND p.tax_settlement_id > 0
				)
			)
		`)
	}
	return q
}

// Orden por fecha de emisión efectiva: registro del pago vinculado, issue_date o created_at del comprobante.
const fiscalReceiptListOrderSQL = `COALESCE(
	(SELECT p.created_at FROM payments p WHERE p.id = tukifac_fiscal_receipts.linked_payment_id AND p.deleted_at IS NULL LIMIT 1),
	tukifac_fiscal_receipts.issue_date,
	tukifac_fiscal_receipts.created_at
) DESC, tukifac_fiscal_receipts.id DESC`

func (s *FiscalReceiptService) ListFiscalReceiptsPaged(params FiscalReceiptListParams) ([]FiscalReceiptEnriched, int64, error) {
	page := params.Page
	if page <= 0 {
		page = 1
	}
	perPage := params.PerPage
	if perPage <= 0 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}

	var total int64
	if err := buildFiscalReceiptListQuery(params).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var list []models.TukifacFiscalReceipt
	err := buildFiscalReceiptListQuery(params).
		Preload("Company").
		Preload("TaxSettlement").
		Preload("LinkedPayment").
		Preload("LinkedPayment.TaxSettlement").
		Order(fiscalReceiptListOrderSQL).
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&list).Error
	if err != nil {
		return nil, 0, err
	}
	out := make([]FiscalReceiptEnriched, 0, len(list))
	for i := range list {
		if list[i].LinkedPayment != nil {
			list[i].LinkedPayment.TukifacFiscalReceipt = nil
		}
		out = append(out, EnrichFiscalReceipt(list[i]))
	}
	return out, total, nil
}

func (s *FiscalReceiptService) GetFiscalReceiptByID(id uint) (*models.TukifacFiscalReceipt, error) {
	var r models.TukifacFiscalReceipt
	if err := database.DB.First(&r, id).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *FiscalReceiptService) CreatePaymentFromReceipt(receiptID uint, in ReceiptPaymentInput) error {
	var rec models.TukifacFiscalReceipt
	if err := database.DB.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.ReconciliationStatus != models.TukifacReceiptPending {
		return errors.New("el comprobante no está pendiente de vincular")
	}

	pay := NewPaymentService()
	params := PaymentCreateParams{
		CompanyID:                 rec.CompanyID,
		Amount:                    rec.Total,
		Date:                      time.Now(),
		Type:                      "applied",
		Method:                    in.Method,
		Reference:                 in.Reference,
		Attachment:                in.Attachment,
		Description:               in.Description,
		Notes:                     in.Notes,
		AllocationMode:            strings.TrimSpace(in.AllocationMode),
		Allocations:               in.Allocations,
		FiscalStatus:              "linked",
		AllowUnallocatedRemainder: true,
		TaxSettlementID:           in.TaxSettlementID,
	}
	payID, err := pay.CreateFromParams(&params)
	if err != nil {
		return err
	}

	rec.ReconciliationStatus = models.TukifacReceiptLinked
	rec.LinkedPaymentID = &payID
	if in.TaxSettlementID != nil && *in.TaxSettlementID > 0 {
		tid := *in.TaxSettlementID
		rec.TaxSettlementID = &tid
	}
	return database.DB.Save(&rec).Error
}

func (s *FiscalReceiptService) LinkReceiptToPayment(receiptID, paymentID uint) error {
	var rec models.TukifacFiscalReceipt
	if err := database.DB.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.ReconciliationStatus != models.TukifacReceiptPending {
		return errors.New("el comprobante no está pendiente de vincular")
	}
	var pay models.Payment
	if err := database.DB.First(&pay, paymentID).Error; err != nil {
		return err
	}
	if pay.CompanyID != rec.CompanyID {
		return errors.New("el pago no pertenece a la misma empresa")
	}
	if math.Abs(pay.Amount-rec.Total) > 0.02 {
		return errors.New("el monto del pago no coincide con el comprobante")
	}
	var linkCount int64
	database.DB.Model(&models.TukifacFiscalReceipt{}).
		Where("linked_payment_id = ? AND id <> ?", paymentID, receiptID).
		Count(&linkCount)
	if linkCount > 0 {
		return errors.New("el pago ya está vinculado a otro comprobante")
	}

	rec.ReconciliationStatus = models.TukifacReceiptLinked
	rec.LinkedPaymentID = &paymentID
	if pay.TaxSettlementID != nil && *pay.TaxSettlementID > 0 {
		tid := *pay.TaxSettlementID
		rec.TaxSettlementID = &tid
	}
	pay.FiscalStatus = "linked"
	if err := database.DB.Save(&pay).Error; err != nil {
		return err
	}
	return database.DB.Save(&rec).Error
}

func (s *FiscalReceiptService) LinkReceiptToTaxSettlement(receiptID uint, settlementID *uint) error {
	var rec models.TukifacFiscalReceipt
	if err := database.DB.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.ReconciliationStatus == models.TukifacReceiptDiscarded {
		return errors.New("no se puede modificar un comprobante descartado")
	}
	if settlementID == nil || *settlementID == 0 {
		return database.DB.Model(&rec).Updates(map[string]interface{}{"tax_settlement_id": nil}).Error
	}
	var ts models.TaxSettlement
	if err := database.DB.First(&ts, *settlementID).Error; err != nil {
		return errors.New("liquidación inválida")
	}
	if ts.CompanyID != rec.CompanyID {
		return errors.New("la liquidación no corresponde a la empresa del comprobante")
	}
	if ts.Status != models.TaxSettlementStatusIssued {
		return errors.New("solo se puede vincular a liquidaciones emitidas")
	}
	return database.DB.Model(&rec).Update("tax_settlement_id", *settlementID).Error
}

func (s *FiscalReceiptService) DiscardFiscalReceipt(receiptID uint) error {
	var rec models.TukifacFiscalReceipt
	if err := database.DB.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.ReconciliationStatus == models.TukifacReceiptLinked {
		return errors.New("no se puede descartar un comprobante ya vinculado")
	}
	rec.ReconciliationStatus = models.TukifacReceiptDiscarded
	rec.LinkedPaymentID = nil
	return database.DB.Save(&rec).Error
}

func (s *FiscalReceiptService) LinkIssuedReceiptToPayment(rec *models.TukifacFiscalReceipt, pay *models.Payment) error {
	if rec == nil || pay == nil {
		return errors.New("datos inválidos")
	}
	pid := pay.ID
	rec.LinkedPaymentID = &pid
	rec.ReconciliationStatus = models.TukifacReceiptLinked
	if pay.TaxSettlementID != nil && *pay.TaxSettlementID > 0 {
		tid := *pay.TaxSettlementID
		rec.TaxSettlementID = &tid
	}
	if err := database.DB.Save(rec).Error; err != nil {
		return err
	}
	return database.DB.Model(&models.Payment{}).Where("id = ?", pay.ID).Update("fiscal_status", "linked").Error
}
