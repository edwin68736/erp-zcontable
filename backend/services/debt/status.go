package debt

import (
	"strings"
)

const (
	StatusPending   = "pendiente"
	StatusPartial   = "parcial"
	StatusPaid      = "pagado"
	StatusCancelled = "anulado"
	// StatusExonerado: deuda condonada/incobrable dada de baja con motivo. Estado terminal.
	StatusExonerado = "exonerado"
)

// IsTerminalWriteoffStatus true si la deuda fue dada de baja (anulada o exonerada) y no debe recomputarse.
func IsTerminalWriteoffStatus(status string) bool {
	s := strings.TrimSpace(strings.ToLower(status))
	return s == StatusCancelled || s == StatusExonerado
}

// ComputeStatusFromAmounts deriva estado interno según total y saldo pendiente.
func ComputeStatusFromAmounts(total, balance float64, currentStatus string) string {
	if IsTerminalWriteoffStatus(currentStatus) {
		return strings.TrimSpace(strings.ToLower(currentStatus))
	}
	if balance <= MoneyEpsilon {
		return StatusPaid
	}
	if balance+MoneyEpsilon >= total {
		return StatusPending
	}
	return StatusPartial
}

// ComputeStatusFromPaid deriva estado desde monto pagado acumulado (compat legacy).
func ComputeStatusFromPaid(paid, total float64, currentStatus string) string {
	if IsTerminalWriteoffStatus(currentStatus) {
		return strings.TrimSpace(strings.ToLower(currentStatus))
	}
	balance := BalanceFromTotalPaid(total, paid)
	return ComputeStatusFromAmounts(total, balance, currentStatus)
}
