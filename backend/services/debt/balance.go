package debt

import (
	"math"
	"strings"

	"miappfiber/models"

	"gorm.io/gorm"
)

// Service única fuente de verdad para saldo y estado persistido de deudas (documents).
type Service struct{}

func NewService() *Service {
	return &Service{}
}

// PaidTotal suma imputaciones + pagos legacy sin allocations.
func (s *Service) PaidTotal(tx *gorm.DB, documentID uint) float64 {
	var fromAlloc float64
	tx.Model(&models.PaymentAllocation{}).
		Joins("JOIN payments p ON p.id = payment_allocations.payment_id AND p.deleted_at IS NULL").
		Where("payment_allocations.document_id = ?", documentID).
		Select("COALESCE(SUM(payment_allocations.amount),0)").
		Scan(&fromAlloc)

	var fromLegacy float64
	tx.Model(&models.Payment{}).
		Where("document_id = ? AND deleted_at IS NULL", documentID).
		Where("NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = payments.id AND pa.deleted_at IS NULL)").
		Select("COALESCE(SUM(amount),0)").
		Scan(&fromLegacy)

	return roundMoney(fromAlloc + fromLegacy)
}

// BalanceFromTotalPaid calcula saldo pendiente (≥ 0).
func BalanceFromTotalPaid(total, paid float64) float64 {
	b := total - paid
	if b < 0 || b < MoneyEpsilon {
		return 0
	}
	return roundMoney(b)
}

func roundMoney(v float64) float64 {
	return math.Round(v*100) / 100
}

// PersistBalanceAndStatus recalcula pagado, persiste balance_amount y status.
func (s *Service) PersistBalanceAndStatus(tx *gorm.DB, documentID uint) error {
	var d models.Document
	if err := tx.First(&d, documentID).Error; err != nil {
		return err
	}
	return s.PersistBalanceAndStatusForDoc(tx, &d)
}

// PersistBalanceAndStatusForDoc persiste saldo y estado para un documento cargado.
func (s *Service) PersistBalanceAndStatusForDoc(tx *gorm.DB, d *models.Document) error {
	if d == nil {
		return nil
	}
	if IsTerminalWriteoffStatus(d.Status) {
		return nil
	}
	paid := s.PaidTotal(tx, d.ID)
	balance := BalanceFromTotalPaid(d.TotalAmount, paid)
	next := ComputeStatusFromPaid(paid, d.TotalAmount, d.Status)
	updates := map[string]interface{}{
		"balance_amount": balance,
		"status":         next,
	}
	return tx.Model(&models.Document{}).Where("id = ?", d.ID).Updates(updates).Error
}

// InitBalanceOnCreate establece balance inicial al crear una deuda sin pagos.
func (s *Service) InitBalanceOnCreate(doc *models.Document) {
	if doc == nil {
		return
	}
	if doc.Status == StatusCancelled {
		doc.BalanceAmount = 0
		return
	}
	doc.BalanceAmount = roundMoney(doc.TotalAmount)
	if doc.Status == "" {
		doc.Status = StatusPending
	}
}

// EffectiveBalance lee saldo persistido; si es inconsistente con pagos, recalcula (dual read).
func (s *Service) EffectiveBalance(tx *gorm.DB, d *models.Document) float64 {
	if d == nil {
		return 0
	}
	// Deudas dadas de baja (anuladas/exoneradas) no tienen saldo cobrable, aunque no tengan pagos.
	if IsTerminalWriteoffStatus(d.Status) {
		return 0
	}
	calc := BalanceFromTotalPaid(d.TotalAmount, s.PaidTotal(tx, d.ID))
	if d.BalanceAmount <= MoneyEpsilon && calc > MoneyEpsilon {
		return calc
	}
	if math.Abs(d.BalanceAmount-calc) > 0.02 {
		return calc
	}
	return d.BalanceAmount
}

func stringsTrimLower(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}