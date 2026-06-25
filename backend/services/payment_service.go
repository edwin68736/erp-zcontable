package services

import (
	"errors"
	"math"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"gorm.io/gorm"
)

type PaymentService struct{}

func NewPaymentService() *PaymentService {
	return &PaymentService{}
}

// PaymentAllocationInput línea de imputación manual o precalculada.
type PaymentAllocationInput struct {
	DocumentID uint    `json:"document_id"`
	Amount     float64 `json:"amount"`
}

// PaymentCreateParams creación de pago con FIFO, manual o un solo documento.
type PaymentCreateParams struct {
	CompanyID      uint
	DocumentID     *uint
	Type           string
	Date           time.Time
	Amount         float64
	DiscountAmount float64
	Method         string
	Reference      string
	Attachment     string
	Description    string
	Notes          string
	AllocationMode string // fifo, manual (implícito si hay allocations), vacío + document_id = un documento
	Allocations    []PaymentAllocationInput
	FiscalStatus   string // na, pending_receipt, linked
	// AllowUnallocatedRemainder: en FIFO, si la deuda es menor que el monto, se imputa solo lo posible y el resto queda
	// como saldo a favor en el mismo pago (monto total del pago sin cambiar). Típico en conciliación Tukifac.
	AllowUnallocatedRemainder bool
	TaxSettlementID           *uint
}

type PaymentListParams struct {
	CompanyID         uint
	DocumentID        uint
	Type              string
	DateFrom          *time.Time
	DateTo            *time.Time
	AllowedCompanyIDs []uint
}

func normalizePaymentType(value string) string {
	v := strings.TrimSpace(strings.ToLower(value))
	switch v {
	case "":
		return ""
	case "applied":
		return "applied"
	case "on_account":
		return "on_account"
	default:
		return v
	}
}

func isValidPaymentType(value string) bool {
	return value == "applied" || value == "on_account"
}

func recalculateDocumentStatusTx(tx *gorm.DB, documentID uint) error {
	return debtsvc.NewService().PersistBalanceAndStatus(tx, documentID)
}

func (s *PaymentService) Create(input *models.Payment) error {
	if input == nil {
		return errors.New("datos inválidos")
	}
	if input.Date.IsZero() {
		input.Date = time.Now()
	}
	fs := strings.TrimSpace(input.FiscalStatus)
	if fs == "" {
		fs = "na"
	}
	p := PaymentCreateParams{
		CompanyID:      input.CompanyID,
		DocumentID:     input.DocumentID,
		Type:           input.Type,
		Date:           input.Date,
		Amount:         input.Amount,
		Method:         input.Method,
		Reference:      input.Reference,
		Attachment:     input.Attachment,
		Description:    strings.TrimSpace(input.Description),
		Notes:          input.Notes,
		FiscalStatus:   fs,
		AllocationMode: "",
		Allocations:    nil,
	}
	_, err := s.CreateFromParams(&p)
	return err
}

// CreateFromParams registra pago con imputación simple, FIFO o manual. Devuelve el id del pago.
func (s *PaymentService) CreateFromParams(p *PaymentCreateParams) (uint, error) {
	if p.CompanyID == 0 {
		return 0, errors.New("la empresa es requerida")
	}
	if p.Amount <= 0 {
		return 0, errors.New("el monto debe ser mayor a 0")
	}
	p.DiscountAmount = math.Round(p.DiscountAmount*100) / 100
	if p.DiscountAmount < 0 {
		return 0, errors.New("el descuento no puede ser negativo")
	}
	if p.Date.IsZero() {
		p.Date = time.Now()
	}

	p.Type = normalizePaymentType(p.Type)
	if p.Type == "" {
		p.Type = "on_account"
	}
	if !isValidPaymentType(p.Type) {
		return 0, errors.New("tipo de pago inválido")
	}

	if p.DocumentID != nil && *p.DocumentID == 0 {
		p.DocumentID = nil
	}

	fs := strings.TrimSpace(p.FiscalStatus)
	if fs == "" {
		fs = "na"
	}
	p.FiscalStatus = fs

	if p.Type == "on_account" {
		p.DocumentID = nil
		p.Allocations = nil
		p.TaxSettlementID = nil
		pay := models.Payment{
			CompanyID:    p.CompanyID,
			DocumentID:   nil,
			Type:         "on_account",
			Date:         p.Date,
			Amount:       p.Amount,
			Method:       p.Method,
			Reference:    p.Reference,
			Attachment:   p.Attachment,
			Description:  p.Description,
			Notes:        p.Notes,
			FiscalStatus: p.FiscalStatus,
		}
		if err := database.DB.Create(&pay).Error; err != nil {
			return 0, err
		}
		return pay.ID, nil
	}

	if p.TaxSettlementID != nil && *p.TaxSettlementID > 0 {
		var ts models.TaxSettlement
		if err := database.DB.First(&ts, *p.TaxSettlementID).Error; err != nil {
			return 0, errors.New("liquidación inválida")
		}
		if ts.CompanyID != p.CompanyID {
			return 0, errors.New("la liquidación no corresponde a la empresa del pago")
		}
		if ts.Status != models.TaxSettlementStatusIssued {
			return 0, errors.New("solo se puede vincular el pago a una liquidación emitida")
		}
	}

	// applied
	mode := strings.ToLower(strings.TrimSpace(p.AllocationMode))
	if p.DiscountAmount > 0.005 && mode == "fifo" {
		return 0, errors.New("el descuento no puede combinarse con imputación FIFO")
	}
	var lines []PaymentAllocationInput

	if len(p.Allocations) > 0 {
		lines = p.Allocations
		mode = "manual"
	} else if mode == "fifo" {
		var err error
		lines, err = s.buildFIFOAllocations(p.CompanyID, p.Amount, p.AllowUnallocatedRemainder, p.TaxSettlementID)
		if err != nil {
			return 0, err
		}
		if len(lines) == 0 && p.AllowUnallocatedRemainder && p.Amount > 0 {
			pay := models.Payment{
				CompanyID:    p.CompanyID,
				DocumentID:   nil,
				Type:         "on_account",
				Date:         p.Date,
				Amount:       p.Amount,
				Method:       p.Method,
				Reference:    p.Reference,
				Attachment:   p.Attachment,
				Description:  p.Description,
				Notes:        p.Notes,
				FiscalStatus: p.FiscalStatus,
			}
			if err := database.DB.Create(&pay).Error; err != nil {
				return 0, err
			}
			return pay.ID, nil
		}
	} else if p.DocumentID != nil {
		debtSvc := debtsvc.NewService()
		var doc models.Document
		if err := database.DB.First(&doc, *p.DocumentID).Error; err != nil {
			return 0, errors.New("documento inválido")
		}
		if doc.CompanyID != p.CompanyID {
			return 0, errors.New("el documento no pertenece a la empresa")
		}
		bal := debtSvc.EffectiveBalance(database.DB, &doc)
		if p.DiscountAmount > 0.005 {
			if math.Abs(p.Amount+p.DiscountAmount-bal) > 0.02 {
				return 0, errors.New("con descuento, el monto pagado más el descuento debe igualar el saldo de la deuda")
			}
			lines = []PaymentAllocationInput{{DocumentID: *p.DocumentID, Amount: bal}}
		} else {
			lines = []PaymentAllocationInput{{DocumentID: *p.DocumentID, Amount: p.Amount}}
		}
		mode = "single"
	} else {
		return 0, errors.New("indique documento, allocation_mode=fifo o lista allocations")
	}

	if mode == "manual" || mode == "single" {
		var sum float64
		for _, ln := range lines {
			if ln.DocumentID == 0 || ln.Amount <= 0 {
				return 0, errors.New("cada imputación requiere documento y monto válido")
			}
			sum += ln.Amount
		}
		debtSvc := debtsvc.NewService()
		if err := debtSvc.ValidatePaymentAmountsAndAllocations(database.DB, p.CompanyID, p.Amount, p.DiscountAmount, toDebtLines(lines), p.TaxSettlementID); err != nil {
			return 0, err
		}
	}

	var paymentID uint
	debtSvc := debtsvc.NewService()
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		applyLines := toDebtLines(lines)
		pid, err := debtSvc.ApplyPaymentTx(tx, debtsvc.ApplyPaymentInput{
			CompanyID:       p.CompanyID,
			Date:            p.Date,
			Amount:          p.Amount,
			DiscountAmount:  p.DiscountAmount,
			Method:          p.Method,
			Reference:       p.Reference,
			Attachment:      p.Attachment,
			Description:     p.Description,
			Notes:           p.Notes,
			FiscalStatus:    p.FiscalStatus,
			TaxSettlementID: p.TaxSettlementID,
			Lines:           applyLines,
		})
		if err != nil {
			return err
		}
		paymentID = pid
		return nil
	})
	return paymentID, err
}

func (s *PaymentService) buildFIFOAllocations(companyID uint, amount float64, allowPartial bool, taxSettlementID *uint) ([]PaymentAllocationInput, error) {
	var docs []models.Document
	q := database.DB.
		Where("company_id = ? AND status IN ?", companyID, []string{"pendiente", "parcial"})
	if taxSettlementID != nil && *taxSettlementID > 0 {
		q = q.Where("tax_settlement_id = ?", *taxSettlementID)
	}
	err := q.Order("issue_date ASC, id ASC").Find(&docs).Error
	if err != nil {
		return nil, err
	}

	debtSvc := debtsvc.NewService()
	remaining := amount
	var lines []PaymentAllocationInput

	for _, d := range docs {
		if remaining < 0.005 {
			break
		}
		bal := debtSvc.EffectiveBalance(database.DB, &d)
		if bal < 0.005 {
			continue
		}
		take := bal
		if take > remaining {
			take = remaining
		}
		if take >= 0.005 {
			lines = append(lines, PaymentAllocationInput{DocumentID: d.ID, Amount: take})
			remaining -= take
		}
	}

	if remaining > 0.005 && !allowPartial {
		return nil, errors.New("no hay deuda pendiente suficiente para aplicar todo el monto (FIFO)")
	}
	if len(lines) == 0 && !allowPartial {
		if taxSettlementID != nil && *taxSettlementID > 0 {
			return nil, errors.New("no hay deudas vinculadas a esta liquidación con saldo pendiente (FIFO)")
		}
		return nil, errors.New("no hay documentos pendientes para aplicar FIFO")
	}
	return lines, nil
}

func (s *PaymentService) Update(id uint, input *models.Payment) error {
	var p models.Payment
	if err := database.DB.First(&p, id).Error; err != nil {
		return err
	}

	var allocCount int64
	database.DB.Model(&models.PaymentAllocation{}).Where("payment_id = ?", p.ID).Count(&allocCount)

	if p.DocumentID != nil || normalizePaymentType(p.Type) == "applied" || allocCount > 0 {
		return errors.New("no se puede editar un pago aplicado o con imputaciones; elimínelo y regístrelo de nuevo")
	}

	oldDocID := p.DocumentID

	if input.Amount > 0 {
		p.Amount = input.Amount
	}
	if !input.Date.IsZero() {
		p.Date = input.Date
	}
	if input.Method != "" {
		p.Method = input.Method
	}
	if input.Reference != "" {
		p.Reference = input.Reference
	}
	if input.Attachment != "" {
		p.Attachment = input.Attachment
	}
	if input.Notes != "" {
		p.Notes = input.Notes
	}
	if input.Description != "" {
		p.Description = input.Description
	}
	if input.DocumentID != nil {
		if *input.DocumentID == 0 {
			p.DocumentID = nil
		} else {
			p.DocumentID = input.DocumentID
		}
	}
	if strings.TrimSpace(input.Type) != "" {
		p.Type = normalizePaymentType(input.Type)
	}

	p.Type = normalizePaymentType(p.Type)
	if strings.TrimSpace(input.Type) != "" {
		if !isValidPaymentType(p.Type) {
			return errors.New("tipo de pago inválido")
		}
		if p.Type == "on_account" {
			p.DocumentID = nil
		}
		if p.Type == "applied" && p.DocumentID == nil {
			return errors.New("el documento es requerido para pagos aplicados")
		}
	} else {
		if p.DocumentID == nil {
			p.Type = "on_account"
		} else {
			p.Type = "applied"
		}
	}

	return database.DB.Transaction(func(tx *gorm.DB) error {
		var newDoc models.Document
		if p.DocumentID != nil {
			if err := tx.First(&newDoc, *p.DocumentID).Error; err != nil {
				return errors.New("documento inválido")
			}
			if newDoc.CompanyID != p.CompanyID {
				return errors.New("el documento no pertenece a la empresa")
			}
			if newDoc.Status == "anulado" {
				return errors.New("no se puede registrar pagos en un documento anulado")
			}

			debtSvc := debtsvc.NewService()
			paidOthers := debtSvc.PaidTotal(tx, *p.DocumentID) - p.Amount
			if paidOthers < 0 {
				paidOthers = 0
			}
			bal := debtsvc.BalanceFromTotalPaid(newDoc.TotalAmount, paidOthers)
			if p.Amount > bal+0.005 {
				return errors.New("el monto excede el saldo del documento")
			}
		}

		if err := tx.Save(&p).Error; err != nil {
			return err
		}

		if oldDocID != nil && (p.DocumentID == nil || *oldDocID != *p.DocumentID) {
			if err := recalculateDocumentStatusTx(tx, *oldDocID); err != nil {
				return err
			}
		}
		if p.DocumentID != nil {
			if err := recalculateDocumentStatusTx(tx, *p.DocumentID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *PaymentService) List(params PaymentListParams) ([]models.Payment, error) {
	var list []models.Payment
	q := database.DB.Preload("Company").Preload("Document").Preload("Allocations").Preload("TaxSettlement").Preload("TukifacFiscalReceipt").Model(&models.Payment{})

	if params.AllowedCompanyIDs != nil {
		if len(params.AllowedCompanyIDs) == 0 {
			return []models.Payment{}, nil
		}
		q = q.Where("company_id IN ?", params.AllowedCompanyIDs)
	}

	if params.CompanyID != 0 {
		q = q.Where("company_id = ?", params.CompanyID)
	}
	if params.DocumentID != 0 {
		q = q.Where("document_id = ?", params.DocumentID)
	}
	if strings.TrimSpace(params.Type) != "" {
		q = q.Where("type = ?", normalizePaymentType(params.Type))
	}
	if params.DateFrom != nil {
		q = q.Where("created_at >= ?", *params.DateFrom)
	}
	if params.DateTo != nil {
		q = q.Where("created_at < ?", *params.DateTo)
	}

	if err := q.Order("created_at DESC, id DESC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (s *PaymentService) ListPaged(params PaymentListParams, page int, perPage int) ([]models.Payment, int64, error) {
	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 20
	}

	base := database.DB.Model(&models.Payment{})

	if params.AllowedCompanyIDs != nil {
		if len(params.AllowedCompanyIDs) == 0 {
			return []models.Payment{}, 0, nil
		}
		base = base.Where("company_id IN ?", params.AllowedCompanyIDs)
	}

	if params.CompanyID != 0 {
		base = base.Where("company_id = ?", params.CompanyID)
	}
	if params.DocumentID != 0 {
		base = base.Where("document_id = ?", params.DocumentID)
	}
	if strings.TrimSpace(params.Type) != "" {
		base = base.Where("type = ?", normalizePaymentType(params.Type))
	}
	if params.DateFrom != nil {
		base = base.Where("created_at >= ?", *params.DateFrom)
	}
	if params.DateTo != nil {
		base = base.Where("created_at < ?", *params.DateTo)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var list []models.Payment
	q := base.Preload("Company").
		Preload("Document").
		Preload("Allocations").
		Preload("TaxSettlement").
		Preload("TukifacFiscalReceipt").
		Order("created_at DESC, id DESC").
		Limit(perPage).
		Offset((page - 1) * perPage)

	if err := q.Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (s *PaymentService) GetByID(id uint) (*models.Payment, error) {
	var p models.Payment
	if err := database.DB.
		Preload("Company").
		Preload("Document").
		Preload("Allocations").
		Preload("Allocations.Document").
		Preload("TaxSettlement").
		Preload("TukifacFiscalReceipt").
		First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// DeletePaymentTx elimina el pago y sus imputaciones dentro de una transacción ya abierta (p. ej. cascada al borrar liquidación).
func (s *PaymentService) DeletePaymentTx(tx *gorm.DB, id uint) error {
	var p models.Payment
	if err := tx.First(&p, id).Error; err != nil {
		return err
	}

	// Comprobantes fiscales Tukifac vinculados: revertir conciliación antes de borrar el pago.
	if err := tx.Model(&models.TukifacFiscalReceipt{}).
		Where("linked_payment_id = ?", id).
		Updates(map[string]interface{}{
			"linked_payment_id":     nil,
			"reconciliation_status": models.TukifacReceiptPending,
		}).Error; err != nil {
		return err
	}

	docIDs := map[uint]struct{}{}
	var allocs []models.PaymentAllocation
	tx.Where("payment_id = ?", id).Find(&allocs)
	for _, a := range allocs {
		docIDs[a.DocumentID] = struct{}{}
	}
	if p.DocumentID != nil {
		docIDs[*p.DocumentID] = struct{}{}
	}

	if err := tx.Where("payment_id = ?", id).Delete(&models.PaymentAllocation{}).Error; err != nil {
		return err
	}

	result := tx.Delete(&models.Payment{}, id)
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	if result.Error != nil {
		return result.Error
	}

	for did := range docIDs {
		if err := recalculateDocumentStatusTx(tx, did); err != nil {
			return err
		}
	}
	return nil
}

func (s *PaymentService) Delete(id uint) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		return s.DeletePaymentTx(tx, id)
	})
}

func toDebtLines(lines []PaymentAllocationInput) []debtsvc.PaymentAllocationLine {
	out := make([]debtsvc.PaymentAllocationLine, 0, len(lines))
	for _, ln := range lines {
		out = append(out, debtsvc.PaymentAllocationLine{
			DocumentID: ln.DocumentID,
			Amount:     ln.Amount,
		})
	}
	return out
}
