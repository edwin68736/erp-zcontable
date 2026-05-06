package models

import (
	"time"

	"gorm.io/gorm"
)

// Payment representa un pago registrado para una empresa (y opcionalmente asociado a un documento)
type Payment struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	CompanyID   uint           `gorm:"not null;index" json:"company_id"`
	DocumentID  *uint          `gorm:"index" json:"document_id"`
	Type        string         `gorm:"size:20;not null;default:'applied'" json:"type"`
	Date        time.Time      `json:"date"`
	Amount      float64        `gorm:"type:decimal(15,2);not null" json:"amount"`
	Method      string         `gorm:"size:50" json:"method"`   // transferencia, efectivo, etc.
	Reference   string         `gorm:"size:100" json:"reference"`
	Attachment  string         `gorm:"size:255" json:"attachment"` // ruta/URL del comprobante
	Notes       string         `gorm:"type:text" json:"notes"`
	// FiscalStatus: na | pending_receipt | linked (vínculo comprobante Tukifac)
	FiscalStatus string `gorm:"size:30;not null;default:'na'" json:"fiscal_status"`
	// Liquidación emitida a la que se asocia el pago (imputación sugerida desde esa liquidación).
	TaxSettlementID *uint          `gorm:"index" json:"tax_settlement_id,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Company              *Company              `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
	Document             *Document             `gorm:"foreignKey:DocumentID" json:"document,omitempty"`
	TaxSettlement        *TaxSettlement        `gorm:"foreignKey:TaxSettlementID" json:"tax_settlement,omitempty"`
	Allocations          []PaymentAllocation   `gorm:"foreignKey:PaymentID" json:"allocations,omitempty"`
	TukifacFiscalReceipt *TukifacFiscalReceipt `gorm:"foreignKey:LinkedPaymentID;references:ID" json:"tukifac_fiscal_receipt,omitempty"`
}

func (Payment) TableName() string {
	return "payments"
}
