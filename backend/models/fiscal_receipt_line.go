package models

import (
	"time"
)

const (
	FiscalReceiptLineTypeCatalog = "catalog"
	FiscalReceiptLineTypeManual  = "manual"
)

// FiscalReceiptLine detalle inmutable del comprobante (snapshot; no usar Product en PDF ni reimpresión).
type FiscalReceiptLine struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	FiscalReceiptID  uint      `gorm:"not null;index" json:"fiscal_receipt_id"`
	LineType         string    `gorm:"size:20;not null" json:"line_type"`
	ProductID        *uint     `gorm:"index" json:"product_id,omitempty"`
	ProductName      string    `gorm:"size:255;not null" json:"product_name"`
	Description      string    `gorm:"type:text;not null" json:"description"`
	InternalCode     string    `gorm:"size:64" json:"internal_code,omitempty"`
	UnitTypeID       string    `gorm:"size:10" json:"unit_type_id,omitempty"`
	Quantity         float64   `gorm:"type:decimal(15,4);not null;default:1" json:"quantity"`
	UnitPrice        float64   `gorm:"type:decimal(15,2);not null" json:"unit_price"`
	LineSubtotal     float64   `gorm:"type:decimal(15,2);not null" json:"line_subtotal"`
	IGVRate          float64   `gorm:"type:decimal(5,2);not null;default:18" json:"igv_rate"`
	IGVAmount        float64   `gorm:"type:decimal(15,2);not null" json:"igv_amount"`
	LineTotal        float64   `gorm:"type:decimal(15,2);not null" json:"line_total"`
	SortOrder        int       `gorm:"not null;default:0" json:"sort_order"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (FiscalReceiptLine) TableName() string {
	return "fiscal_receipt_lines"
}
