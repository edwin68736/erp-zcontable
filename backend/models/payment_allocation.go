package models

import (
	"time"

	"gorm.io/gorm"
)

// PaymentAllocation imputa parte de un pago a un documento (cargo).
type PaymentAllocation struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	PaymentID  uint           `gorm:"not null;index" json:"payment_id"`
	DocumentID uint           `gorm:"not null;index" json:"document_id"`
	Amount     float64        `gorm:"type:decimal(15,2);not null" json:"amount"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`

	Payment  *Payment  `gorm:"foreignKey:PaymentID" json:"payment,omitempty"`
	Document *Document `gorm:"foreignKey:DocumentID" json:"document,omitempty"`
}

func (PaymentAllocation) TableName() string {
	return "payment_allocations"
}
