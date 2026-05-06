package database

import (
	"miappfiber/models"

	"gorm.io/gorm"
)

// BackfillPaymentAllocations crea filas de imputación a partir de pagos legacy con document_id.
func BackfillPaymentAllocations() error {
	var payments []models.Payment
	if err := DB.Where("document_id IS NOT NULL").Find(&payments).Error; err != nil {
		return err
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		for _, p := range payments {
			if p.DocumentID == nil {
				continue
			}
			var cnt int64
			tx.Model(&models.PaymentAllocation{}).Where("payment_id = ?", p.ID).Count(&cnt)
			if cnt > 0 {
				continue
			}
			a := models.PaymentAllocation{
				PaymentID:  p.ID,
				DocumentID: *p.DocumentID,
				Amount:     p.Amount,
			}
			if err := tx.Create(&a).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
