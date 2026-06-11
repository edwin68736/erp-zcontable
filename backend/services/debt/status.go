package debt

import (
	"strings"
)

const (
	StatusPending   = "pendiente"
	StatusPartial   = "parcial"
	StatusPaid      = "pagado"
	StatusCancelled = "anulado"
)

// ComputeStatusFromAmounts deriva estado interno según total y saldo pendiente.
func ComputeStatusFromAmounts(total, balance float64, currentStatus string) string {
	if strings.TrimSpace(strings.ToLower(currentStatus)) == StatusCancelled {
		return StatusCancelled
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
	if strings.TrimSpace(strings.ToLower(currentStatus)) == StatusCancelled {
		return StatusCancelled
	}
	balance := BalanceFromTotalPaid(total, paid)
	return ComputeStatusFromAmounts(total, balance, currentStatus)
}
