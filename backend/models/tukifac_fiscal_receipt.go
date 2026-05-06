package models

import (
	"time"

	"gorm.io/gorm"
)

// Estados de conciliación con pagos locales.
const (
	TukifacReceiptPending   = "pendiente_vincular"
	TukifacReceiptLinked    = "vinculado"
	TukifacReceiptDiscarded = "descartado"
)

// Origen del registro en bandeja: sincronizado desde Tukifac o emitido desde este sistema.
const (
	TukifacReceiptOriginSync        = "tukifac_sync"
	TukifacReceiptOriginIssuedLocal = "issued_local"
)

// TukifacFiscalReceipt comprobante fiscal listado desde Tukifac (honorarios del estudio al cliente).
type TukifacFiscalReceipt struct {
	ID                     uint           `gorm:"primaryKey" json:"id"`
	ExternalID             string         `gorm:"size:100;not null;uniqueIndex" json:"external_id"`
	CompanyID              uint           `gorm:"not null;index" json:"company_id"`
	DocumentTypeID         string         `gorm:"size:50" json:"document_type_id"`
	Number                 string         `gorm:"size:50;not null" json:"number"`
	Total                  float64        `gorm:"type:decimal(15,2);not null" json:"total"`
	IssueDate              time.Time      `json:"issue_date"`
	CustomerNumber         string         `gorm:"size:20" json:"customer_number"`
	CustomerName           string         `gorm:"size:255" json:"customer_name"`
	ReconciliationStatus   string         `gorm:"size:30;not null;default:'pendiente_vincular'" json:"reconciliation_status"`
	LinkedPaymentID        *uint          `gorm:"index" json:"linked_payment_id,omitempty"`
	// Liquidación emitida asociada (directa o propagada desde el pago vinculado).
	TaxSettlementID *uint `gorm:"index" json:"tax_settlement_id,omitempty"`
	StateTypeDescription   string         `gorm:"size:100" json:"state_type_description,omitempty"`
	Origin                 string         `gorm:"size:30;not null;default:'tukifac_sync'" json:"origin"`
	// URLs de impresión/descarga devueltas por Tukifac al emitir (ticket térmico y PDF A4).
	PrintTicketURL string `gorm:"size:2000" json:"print_ticket_url,omitempty"`
	PdfURL         string `gorm:"size:2000" json:"pdf_url,omitempty"`
	CreatedAt              time.Time      `json:"created_at"`
	UpdatedAt              time.Time      `json:"updated_at"`
	DeletedAt              gorm.DeletedAt `gorm:"index" json:"-"`

	Company        *Company        `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
	LinkedPayment  *Payment        `gorm:"foreignKey:LinkedPaymentID" json:"linked_payment,omitempty"`
	TaxSettlement  *TaxSettlement  `gorm:"foreignKey:TaxSettlementID" json:"tax_settlement,omitempty"`
}

func (TukifacFiscalReceipt) TableName() string {
	return "tukifac_fiscal_receipts"
}
