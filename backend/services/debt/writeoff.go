package debt

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"miappfiber/models"
)

// Acciones de baja de una deuda que no se cobrará.
const (
	// WriteoffActionExonerar condona la deuda (estado 'exonerado'). Conserva historial.
	WriteoffActionExonerar = "exonerar"
	// WriteoffActionEliminar anula lógicamente la deuda (estado 'anulado'). Conserva historial.
	WriteoffActionEliminar = "eliminar"
)

// WriteOffUnlinkedDebt da de baja (exonera/anula) una deuda abierta NO vinculada, con motivo y
// auditoría. Acción definitiva: fija saldo 0 y estado terminal; no borra el registro (historial).
func (s *Service) WriteOffUnlinkedDebt(tx *gorm.DB, documentID uint, action, reason string, userID uint) (*models.Document, error) {
	var newStatus string
	switch strings.TrimSpace(strings.ToLower(action)) {
	case WriteoffActionExonerar:
		newStatus = StatusExonerado
	case WriteoffActionEliminar:
		newStatus = StatusCancelled
	default:
		return nil, errors.New("acción inválida: use 'exonerar' o 'eliminar'")
	}

	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, errors.New("el motivo es obligatorio")
	}

	var d models.Document
	if err := tx.First(&d, documentID).Error; err != nil {
		return nil, errors.New("deuda no encontrada")
	}
	if d.TaxSettlementID != nil && *d.TaxSettlementID > 0 {
		return nil, errors.New("la deuda está vinculada a una liquidación; quítela primero")
	}
	if IsTerminalWriteoffStatus(d.Status) {
		return nil, errors.New("la deuda ya fue dada de baja")
	}
	if strings.TrimSpace(strings.ToLower(d.Status)) == StatusPaid {
		return nil, errors.New("la deuda ya está pagada")
	}
	if s.EffectiveBalance(tx, &d) <= MoneyEpsilon {
		return nil, errors.New("la deuda no tiene saldo pendiente")
	}

	// Fase 6, Blueprint §20 (docs/diseno-fase6-paso2-cancelaciones-writeoff-2026-09-15.md C.3,
	// decisión E.4): bloquear (no solo advertir) cuando ya existe dinero real aplicado a la deuda y
	// aún queda saldo pendiente — reutiliza hasPaymentAllocations/hasLegacyPayments/PaidTotal, ya
	// existentes en este mismo paquete (settlement.go), sin duplicar lógica. E.4 aprobado: cubre
	// ambos esquemas, no solo PaymentAllocation (letra literal del Blueprint), por consistencia con
	// la protección ya existente de borrado de Document en settlement.go.
	hasAlloc, err := s.hasPaymentAllocations(tx, d.ID)
	if err != nil {
		return nil, err
	}
	hasLegacyPay, err := s.hasLegacyPayments(tx, d.ID)
	if err != nil {
		return nil, err
	}
	if hasAlloc || hasLegacyPay {
		return nil, fmt.Errorf("la deuda %s tiene dinero ya aplicado (S/ %.2f) y aún saldo pendiente; "+
			"reasigne o gestione ese pago antes de exonerar/anular", d.Number, s.PaidTotal(tx, d.ID))
	}

	now := time.Now()
	updates := map[string]interface{}{
		"status":          newStatus,
		"balance_amount":  0,
		"writeoff_reason": reason,
		"writeoff_at":     now,
	}
	if userID > 0 {
		updates["writeoff_by"] = userID
	}
	if err := tx.Model(&models.Document{}).Where("id = ?", d.ID).Updates(updates).Error; err != nil {
		return nil, err
	}

	d.Status = newStatus
	d.BalanceAmount = 0
	d.WriteoffReason = reason
	d.WriteoffAt = &now
	if userID > 0 {
		d.WriteoffBy = &userID
	}
	return &d, nil
}
