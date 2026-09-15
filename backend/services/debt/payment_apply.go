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
//
// Fase 2.3 (Blueprint financiero): sin descuento, ya NO se exige que la suma de imputaciones iguale
// exactamente el monto del pago — solo que no lo exceda. La diferencia (amount - sum(lines)) es un
// remanente legítimo que queda sin aplicar dentro del mismo Payment (sobrepago). Con descuento, la
// regla NO cambia: sigue exigiendo igualdad exacta (amount+discount == sum), porque el descuento solo
// tiene sentido cuando cubre el saldo completo de cada deuda imputada — no hay remanente que
// contemplar en ese caso.
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
		if sum > amount+MoneyEpsilon {
			return errors.New("la suma de imputaciones no puede exceder el monto del pago")
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

// AllocateExistingInput datos para aplicar dinero ya recibido (Payment existente) a una o varias
// deudas, sin crear un Payment nuevo. Blueprint Fase 2.4.
type AllocateExistingInput struct {
	PaymentID uint
	CompanyID uint
	Lines     []PaymentAllocationLine
}

// AllocateExistingPaymentTx aplica allocations nuevas a un Payment YA EXISTENTE (Fase 2.4). Nunca
// modifica Payment.amount/date/method/reference/description/Purpose/DocumentID, nunca crea un
// Payment ni un Document nuevo, y nunca toca TukifacFiscalReceipt. Reutiliza exactamente las mismas
// validaciones por línea que ApplyPaymentTx (ValidateAllocationsTx) y el mismo mecanismo de saldo
// (PersistBalanceAndStatus) — sin fórmulas nuevas. Ver docs/diseno-fase2-4-allocate-existing-2026-09-14.md.
//
// TODO Fase 2.5: esta operación necesita locking (SELECT ... FOR UPDATE) sobre el Payment y sobre
// cada Document afectado antes de considerarse segura frente a solicitudes concurrentes sobre el
// mismo Payment — deliberadamente NO implementado aquí.
func (s *Service) AllocateExistingPaymentTx(tx *gorm.DB, in AllocateExistingInput) error {
	if in.PaymentID == 0 {
		return errors.New("payment_id requerido")
	}
	if len(in.Lines) == 0 {
		return errors.New("indique al menos una imputación")
	}

	var pay models.Payment
	if err := tx.First(&pay, in.PaymentID).Error; err != nil {
		return errors.New("pago no encontrado")
	}
	if pay.CompanyID != in.CompanyID {
		return errors.New("el pago no pertenece a la empresa")
	}

	// Payment.Purpose: solo los pagos ya clasificados como "deuda" pueden aplicarse a una deuda.
	// Un pago "servicio" es un ingreso independiente por diseño (Fase 2.1/2.2) y nunca debe aplicarse
	// a una deuda solo porque tiene dinero disponible. Un Purpose NULL (sin clasificar) tampoco se
	// adivina — se rechaza hasta que exista una clasificación explícita (Fase 2.6).
	if pay.Purpose == nil {
		return errors.New("el pago no tiene un propósito (purpose) clasificado; no se puede aplicar a una deuda")
	}
	if *pay.Purpose != models.PaymentPurposeDebt {
		return errors.New("solo los pagos con propósito 'deuda' pueden aplicarse a una deuda")
	}

	var appliedCount int64
	if err := tx.Model(&models.PaymentAllocation{}).Where("payment_id = ?", pay.ID).Count(&appliedCount).Error; err != nil {
		return err
	}

	// Estado B legacy: Payment.DocumentID apunta a un documento pero todavía no existe ninguna
	// PaymentAllocation — el backfill de arranque (database.BackfillPaymentAllocations) aún no
	// sincronizó ese vínculo. Calcular el disponible solo desde PaymentAllocation en este estado
	// sobreestimaría el remanente real (el monto ya está comprometido con ese documento legacy).
	if pay.DocumentID != nil && appliedCount == 0 {
		return errors.New("el pago tiene una relación legacy (document_id) pendiente de sincronizar; intente nuevamente tras el próximo reinicio del sistema")
	}

	var appliedSum float64
	if err := tx.Model(&models.PaymentAllocation{}).Where("payment_id = ?", pay.ID).
		Select("COALESCE(SUM(amount),0)").Scan(&appliedSum).Error; err != nil {
		return err
	}
	appliedSum = roundMoney(appliedSum)
	available := roundMoney(pay.Amount - appliedSum)

	var newSum float64
	for _, ln := range in.Lines {
		newSum += ln.Amount
	}
	newSum = roundMoney(newSum)
	if newSum > available+MoneyEpsilon {
		return fmt.Errorf("la suma de las nuevas imputaciones (%.2f) excede el disponible del pago (%.2f)", newSum, available)
	}

	// Mismas validaciones por línea que ApplyPaymentTx: documento existe, misma empresa, no anulado,
	// monto positivo, no excede el saldo del documento, sin documentos repetidos entre sí.
	if err := s.ValidateAllocationsTx(tx, in.CompanyID, in.Lines, nil); err != nil {
		return err
	}

	for _, ln := range in.Lines {
		a := models.PaymentAllocation{PaymentID: pay.ID, DocumentID: ln.DocumentID, Amount: roundMoney(ln.Amount)}
		if err := tx.Create(&a).Error; err != nil {
			return err
		}
		if err := s.PersistBalanceAndStatus(tx, ln.DocumentID); err != nil {
			return fmt.Errorf("actualizar saldo documento %d: %w", ln.DocumentID, err)
		}
	}

	if strings.ToLower(strings.TrimSpace(pay.Type)) != "applied" {
		if err := tx.Model(&models.Payment{}).Where("id = ?", pay.ID).Update("type", "applied").Error; err != nil {
			return err
		}
	}

	return nil
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
