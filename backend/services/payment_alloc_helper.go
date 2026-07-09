package services

import (
	debtsvc "miappfiber/services/debt"

	"gorm.io/gorm"
)

// DocumentPaidTotal suma imputaciones (pagos no eliminados) + pagos legacy sin filas en payment_allocations.
func DocumentPaidTotal(tx *gorm.DB, documentID uint) float64 {
	return debtsvc.NewService().PaidTotal(tx, documentID)
}
