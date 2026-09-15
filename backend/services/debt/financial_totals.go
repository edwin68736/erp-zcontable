package debt

import (
	"miappfiber/models"

	"gorm.io/gorm"
)

// Fase 3 del blueprint financiero (docs/blueprint-financiero-definitivo-2026-09-14.md §21-22,
// docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md): 4 funciones únicas de cálculo
// financiero por empresa, que reemplazan las implementaciones ad-hoc dispersas en Dashboard, Estado
// de cuenta, Reporte financiero y Reporte de deudas. Este archivo SOLO define las funciones — la
// migración de esos consumidores es un paso posterior y separado (no forma parte de este cambio).
//
// Resoluciones de contradicciones aprobadas explícitamente por el usuario antes de implementar
// (ver el documento de auditoría/diseño, sección "Contradicciones encontradas"):
//
//   - C1 (Payment activo/anulado): resuelto en Fase 6 — `Payment.VoidedAt` ya existe. "Payment
//     activo" = no soft-deleted (`DeletedAt IS NULL`, sin cambios, GORM lo aplica automáticamente en
//     cualquier consulta que no use `.Unscoped()`) Y no anulado (`VoidedAt IS NULL`, filtro explícito
//     agregado en las 4 funciones — el scope automático de GORM no llega a los JOIN crudos de
//     DineroAplicadoADeudas/PaidTotal). Cambio aditivo, tal como se anticipó aquí antes de Fase 6.
//   - C2 (DineroNoAplicado): aprobada la opción A' — cuenta el remanente de Payments con
//     `Purpose = 'deuda'` O `Purpose IS NULL` (histórico sin clasificar). Un Payment
//     `Purpose = 'servicio'` nunca aparece en este cálculo. `NULL` nunca se interpreta como
//     `servicio` (Blueprint §15, §21: el propósito nunca se infiere).
//   - C3 (SaldoDocumentado): además de `status IN ('pendiente','parcial')`, se aplica
//     `ScopeActiveDocuments` (excluye `legacy_status IN ('legacy_merged','archived')`) para no
//     contar documentos clon de una consolidación histórica de datos.

// SaldoDocumentado — Blueprint §22: SUM(Document.balance_amount) de documentos activos y no
// liquidados de una empresa. Usa el saldo YA PERSISTIDO (mantenido exclusivamente por
// PersistBalanceAndStatus) — nunca recalcula desde Payment ni resta agregados
// (`total_amount - payments`, fórmula prohibida explícitamente por el Blueprint).
func (s *Service) SaldoDocumentado(db *gorm.DB, companyID uint) (float64, error) {
	q := db.Model(&models.Document{}).
		Where("company_id = ? AND status IN ?", companyID, []string{StatusPending, StatusPartial})
	q = ScopeActiveDocuments(q)

	var total float64
	if err := q.Select("COALESCE(SUM(balance_amount),0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	return roundMoney(total), nil
}

// DineroTotalRecibido — Blueprint §22: SUM(Payment.amount) de una empresa, sin filtrar por
// Purpose (es "todo el dinero que entró", deuda + servicio). Los Payments soft-deleted (anulados,
// ver C1) se excluyen automáticamente por el scope por defecto de GORM.
func (s *Service) DineroTotalRecibido(db *gorm.DB, companyID uint) (float64, error) {
	var total float64
	// Fase 6 (Blueprint §19.6, §22): un pago anulado deja de contar — voided_at IS NULL.
	if err := db.Model(&models.Payment{}).
		Where("company_id = ? AND voided_at IS NULL", companyID).
		Select("COALESCE(SUM(amount),0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	return roundMoney(total), nil
}

// SumDineroTotalRecibido — Fase 7 (docs/diseno-fase7-paso2-ui-reportes-2026-09-15.md A.2 categoría 2):
// agrega DineroTotalRecibido sobre varias empresas, mismo patrón ya usado manualmente para
// SaldoDocumentado en report_controller.go (sumSaldoDocumentado) y en los bucles de
// dashboard_controller.go — no es una fórmula nueva, es la función oficial aplicada empresa por
// empresa y sumada, centralizada aquí para no repetir el bucle en cada controller que la necesite.
func (s *Service) SumDineroTotalRecibido(db *gorm.DB, companyIDs []uint) (float64, error) {
	var total float64
	for _, cid := range companyIDs {
		v, err := s.DineroTotalRecibido(db, cid)
		if err != nil {
			return 0, err
		}
		total += v
	}
	return roundMoney(total), nil
}

// DineroAplicadoADeudas — Blueprint §22: SUM(PaymentAllocation.amount) cuyos Payments estén
// activos (no soft-deleted, ver C1). Reutiliza exactamente el mismo patrón de JOIN que ya usa
// PaidTotal (balance.go) — no introduce una fórmula nueva. GORM excluye automáticamente las
// PaymentAllocation soft-deleted (modelo base de la consulta); el JOIN excluye explícitamente los
// Payments soft-deleted, ya que esa exclusión no es automática sobre una tabla unida.
func (s *Service) DineroAplicadoADeudas(db *gorm.DB, companyID uint) (float64, error) {
	var total float64
	// Fase 6 (Blueprint §19.6, §22): "AND p.voided_at IS NULL" agregado junto al ya existente
	// "AND p.deleted_at IS NULL" — el scope automático de GORM no llega a un JOIN crudo.
	if err := db.Model(&models.PaymentAllocation{}).
		Joins("JOIN payments p ON p.id = payment_allocations.payment_id AND p.deleted_at IS NULL AND p.voided_at IS NULL AND p.company_id = ?", companyID).
		Select("COALESCE(SUM(payment_allocations.amount),0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	return roundMoney(total), nil
}

// DineroNoAplicado — Blueprint §22 + resolución C2 (opción A'): SUM(Payment.amount -
// SUM(sus allocations activas)) de Payments con Purpose='deuda' O Purpose IS NULL. Un Payment
// Purpose='servicio' nunca contribuye (por diseño, Blueprint §15, nunca se espera que tenga
// allocations, y aunque las tuviera, queda excluido por el filtro de Purpose). Solo se suman
// remanentes positivos mayores que MoneyEpsilon — el mismo umbral usado en todo el paquete debt.
func (s *Service) DineroNoAplicado(db *gorm.DB, companyID uint) (float64, error) {
	var payments []models.Payment
	// Fase 6 (Blueprint §19.6, §22): voided_at IS NULL agregado — un pago anulado nunca cuenta aquí.
	if err := db.
		Where("company_id = ? AND voided_at IS NULL AND (purpose IS NULL OR purpose = ?)", companyID, models.PaymentPurposeDebt).
		Preload("Allocations").
		Find(&payments).Error; err != nil {
		return 0, err
	}

	var total float64
	for _, p := range payments {
		var applied float64
		for _, a := range p.Allocations {
			applied += a.Amount
		}
		remainder := roundMoney(p.Amount - applied)
		if remainder > MoneyEpsilon {
			total += remainder
		}
	}
	return roundMoney(total), nil
}
