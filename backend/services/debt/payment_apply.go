package debt

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

// PaymentAllocationLine imputación a una deuda (equivale conceptualmente a payment_item).
type PaymentAllocationLine struct {
	DocumentID uint
	Amount     float64
}

// ApplyPaymentInput datos para registrar un pago aplicado con allocations.
type ApplyPaymentInput struct {
	CompanyID       uint
	Date            time.Time
	Amount          float64
	DiscountAmount  float64
	Method          string
	Reference       string
	Attachment      string
	Description     string
	Notes           string
	FiscalStatus    string
	TaxSettlementID *uint
	Lines           []PaymentAllocationLine
}

// DocumentOpenBalance saldo pendiente efectivo de una deuda.
func (s *Service) DocumentOpenBalance(tx *gorm.DB, documentID uint) (float64, error) {
	var d models.Document
	if err := tx.First(&d, documentID).Error; err != nil {
		return 0, err
	}
	return s.EffectiveBalance(tx, &d), nil
}

// ValidateAllocationsTx valida imputaciones antes de persistir (sin escribir).
func (s *Service) ValidateAllocationsTx(tx *gorm.DB, companyID uint, lines []PaymentAllocationLine, taxSettlementID *uint) error {
	if len(lines) == 0 {
		return errors.New("indique al menos una imputación")
	}
	seen := map[uint]struct{}{}
	for _, ln := range lines {
		if ln.DocumentID == 0 || ln.Amount <= 0 {
			return errors.New("cada imputación requiere documento y monto válido")
		}
		if _, dup := seen[ln.DocumentID]; dup {
			return errors.New("documento repetido en imputación; una sola línea por documento")
		}
		seen[ln.DocumentID] = struct{}{}

		var d models.Document
		if err := tx.First(&d, ln.DocumentID).Error; err != nil {
			return errors.New("documento inválido")
		}
		if d.CompanyID != companyID {
			return errors.New("el documento no pertenece a la empresa")
		}
		if stringsTrimLower(d.Status) == StatusCancelled {
			return errors.New("no se puede imputar a un documento anulado")
		}
		bal := s.EffectiveBalance(tx, &d)
		if ln.Amount > bal+MoneyEpsilon {
			return errors.New("el monto excede el saldo de un documento imputado")
		}
		if taxSettlementID != nil && *taxSettlementID > 0 {
			if d.TaxSettlementID != nil && *d.TaxSettlementID != 0 && *d.TaxSettlementID != *taxSettlementID {
				return fmt.Errorf("la deuda %s ya está vinculada a otra liquidación", strings.TrimSpace(d.Number))
			}
		}
	}
	return nil
}

// ValidatePaymentAmountsAndAllocations valida monto, descuento e imputaciones antes de persistir.
func (s *Service) ValidatePaymentAmountsAndAllocations(tx *gorm.DB, companyID uint, amount, discount float64, lines []PaymentAllocationLine, taxSettlementID *uint) error {
	discount = roundMoney(discount)
	if discount < 0 {
		return errors.New("el descuento no puede ser negativo")
	}
	var sum float64
	for _, ln := range lines {
		sum += ln.Amount
	}
	sum = roundMoney(sum)
	amount = roundMoney(amount)
	if discount > MoneyEpsilon {
		if math.Abs(amount+discount-sum) > MoneyEpsilon {
			return errors.New("el monto pagado más el descuento debe igualar la suma de imputaciones")
		}
		for _, ln := range lines {
			bal, err := s.DocumentOpenBalance(tx, ln.DocumentID)
			if err != nil {
				return err
			}
			if math.Abs(ln.Amount-bal) > MoneyEpsilon {
				return errors.New("el descuento solo puede aplicarse cuando cada imputación cubre el saldo completo de la deuda")
			}
		}
	} else {
		if math.Abs(sum-amount) > MoneyEpsilon {
			return errors.New("la suma de imputaciones debe igualar el monto del pago")
		}
	}
	return s.ValidateAllocationsTx(tx, companyID, lines, taxSettlementID)
}

// ApplyPaymentTx crea payment + allocations y actualiza balance_amount/status (transaccional).
func (s *Service) ApplyPaymentTx(tx *gorm.DB, in ApplyPaymentInput) (uint, error) {
	if in.CompanyID == 0 {
		return 0, errors.New("la empresa es requerida")
	}
	if in.Amount <= 0 {
		return 0, errors.New("el monto debe ser mayor a 0")
	}
	if err := s.ValidatePaymentAmountsAndAllocations(tx, in.CompanyID, in.Amount, in.DiscountAmount, in.Lines, in.TaxSettlementID); err != nil {
		return 0, err
	}

	fs := strings.TrimSpace(in.FiscalStatus)
	if fs == "" {
		fs = "na"
	}
	if in.Date.IsZero() {
		in.Date = time.Now()
	}
	pay := models.Payment{
		CompanyID:       in.CompanyID,
		DocumentID:      nil,
		Type:            "applied",
		Date:            in.Date,
		Amount:          in.Amount,
		DiscountAmount:  roundMoney(in.DiscountAmount),
		Method:          in.Method,
		Reference:       in.Reference,
		Attachment:      in.Attachment,
		Description:     in.Description,
		Notes:           in.Notes,
		FiscalStatus:    fs,
		TaxSettlementID: in.TaxSettlementID,
	}
	if err := tx.Create(&pay).Error; err != nil {
		return 0, err
	}
	for _, ln := range in.Lines {
		a := models.PaymentAllocation{
			PaymentID:  pay.ID,
			DocumentID: ln.DocumentID,
			Amount:     roundMoney(ln.Amount),
		}
		if err := tx.Create(&a).Error; err != nil {
			return 0, err
		}
		if err := s.PersistBalanceAndStatus(tx, ln.DocumentID); err != nil {
			return 0, fmt.Errorf("actualizar saldo documento %d: %w", ln.DocumentID, err)
		}
	}
	if in.TaxSettlementID != nil && *in.TaxSettlementID > 0 {
		if err := s.linkPaymentDebtsToSettlement(tx, *in.TaxSettlementID, in.CompanyID, in.Lines); err != nil {
			return 0, err
		}
	}
	return pay.ID, nil
}

// RevertPaymentAllocationsTx elimina allocations de un pago y restaura saldos (sin borrar el payment).
// TODO: remove legacy after migration stable — solo usado si se migra Update de pagos aplicados.
func (s *Service) RevertPaymentAllocationsTx(tx *gorm.DB, paymentID uint) ([]uint, error) {
	var allocs []models.PaymentAllocation
	if err := tx.Where("payment_id = ?", paymentID).Find(&allocs).Error; err != nil {
		return nil, err
	}
	docIDs := make([]uint, 0, len(allocs))
	seen := map[uint]struct{}{}
	for _, a := range allocs {
		if _, ok := seen[a.DocumentID]; !ok {
			docIDs = append(docIDs, a.DocumentID)
			seen[a.DocumentID] = struct{}{}
		}
	}
	if err := tx.Where("payment_id = ?", paymentID).Delete(&models.PaymentAllocation{}).Error; err != nil {
		return nil, err
	}
	for _, did := range docIDs {
		if err := s.PersistBalanceAndStatus(tx, did); err != nil {
			return nil, err
		}
	}
	return docIDs, nil
}

// linkPaymentDebtsToSettlement vincula deudas independientes pagadas desde una liquidación emitida.
func (s *Service) linkPaymentDebtsToSettlement(tx *gorm.DB, settlementID, companyID uint, lines []PaymentAllocationLine) error {
	var ts models.TaxSettlement
	if err := tx.First(&ts, settlementID).Error; err != nil {
		return fmt.Errorf("liquidación inválida")
	}
	if ts.CompanyID != companyID {
		return errors.New("la liquidación no corresponde a la empresa")
	}
	for _, ln := range lines {
		if ln.DocumentID == 0 {
			continue
		}
		if _, err := s.linkDocumentToSettlement(tx, ln.DocumentID, companyID, settlementID); err != nil {
			return err
		}
		if err := s.ensureSettlementLineForDocument(tx, &ts, ln.DocumentID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ensureSettlementLineForDocument(tx *gorm.DB, ts *models.TaxSettlement, documentID uint) error {
	if ts == nil || documentID == 0 {
		return nil
	}
	var count int64
	if err := tx.Model(&models.TaxSettlementLine{}).
		Where("tax_settlement_id = ? AND document_id = ?", ts.ID, documentID).
		Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	var d models.Document
	if err := tx.First(&d, documentID).Error; err != nil {
		return err
	}
	var maxOrder int
	if err := tx.Model(&models.TaxSettlementLine{}).Where("tax_settlement_id = ?", ts.ID).
		Select("COALESCE(MAX(sort_order),0)").Scan(&maxOrder).Error; err != nil {
		return err
	}
	concept := SanitizeDocumentDescription(d.Description)
	if concept == "" {
		concept = "Deuda " + strings.TrimSpace(d.Number)
	}
	if len(concept) > 512 {
		concept = concept[:509] + "…"
	}
	periodYM := strings.TrimSpace(d.AccountingPeriod)
	if periodYM == "" {
		periodYM = strings.TrimSpace(d.ServiceMonth)
	}
	if periodYM == "" {
		periodYM = strings.TrimSpace(ts.LiquidationPeriod)
	}
	if len(periodYM) > 64 {
		periodYM = periodYM[:64]
	}
	docID := documentID
	line := models.TaxSettlementLine{
		TaxSettlementID: ts.ID,
		LineType:        models.TaxSettlementLineDocRef,
		DocumentID:      &docID,
		Concept:         concept,
		Amount:          d.TotalAmount,
		SortOrder:       maxOrder + 1,
		PeriodYM:        periodYM,
	}
	return tx.Create(&line).Error
}
