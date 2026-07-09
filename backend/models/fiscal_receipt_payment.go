package models

import "time"

// FiscalReceiptPayment desglose de pago en una venta POS (puede haber varios métodos).
type FiscalReceiptPayment struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	FiscalReceiptID uint      `gorm:"not null;index" json:"fiscal_receipt_id"`
	SortOrder       int       `gorm:"not null;default:0" json:"sort_order"`
	Method          string    `gorm:"size:50;not null" json:"method"`
	Amount          float64   `gorm:"type:decimal(15,2);not null" json:"amount"`
	OperationNumber string    `gorm:"size:120" json:"operation_number,omitempty"`
	ProofURL        string    `gorm:"size:500" json:"proof_url,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

func (FiscalReceiptPayment) TableName() string {
	return "fiscal_receipt_payments"
}
