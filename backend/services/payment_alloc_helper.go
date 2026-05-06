package services

import (
	"miappfiber/models"

	"gorm.io/gorm"
)

// DocumentPaidTotal suma imputaciones (pagos no eliminados) + pagos legacy sin filas en payment_allocations.
func DocumentPaidTotal(tx *gorm.DB, documentID uint) float64 {
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

	return fromAlloc + fromLegacy
}
