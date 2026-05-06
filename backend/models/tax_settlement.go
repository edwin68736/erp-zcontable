package models

import (
	"time"

	"gorm.io/gorm"
)

const (
	TaxSettlementStatusDraft   = "borrador"
	TaxSettlementStatusIssued  = "emitida"
	TaxSettlementStatusVoid    = "anulada"
	TaxSettlementLineDocRef    = "document_ref"
	TaxSettlementLineTaxManual = "tax_manual"
	TaxSettlementLineAdjust    = "adjustment"
)

// TaxSettlement liquidación de impuestos / presentación al cliente (no sustituye Document).
type TaxSettlement struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	CompanyID        uint           `gorm:"not null;index" json:"company_id"`
	Number           string         `gorm:"size:50" json:"number"`
	IssueDate        time.Time      `gorm:"not null" json:"issue_date"`
	// LiquidationPeriod: periodo de la liquidación YYYY-MM (máx. una borrador/emitida por empresa y periodo).
	LiquidationPeriod string        `gorm:"size:7;index" json:"liquidation_period"`
	PeriodLabel      string         `gorm:"size:255" json:"period_label"`
	PeriodFrom       *time.Time     `json:"period_from,omitempty"`
	PeriodTo         *time.Time     `json:"period_to,omitempty"`
	Status           string         `gorm:"size:20;not null;default:'borrador'" json:"status"`
	Notes            string         `gorm:"type:text" json:"notes"`
	Pdt621JSON       string         `gorm:"type:text" json:"pdt621_json,omitempty"`
	TotalHonorarios  float64        `gorm:"type:decimal(15,2);not null;default:0" json:"total_honorarios"`
	TotalImpuestos   float64        `gorm:"type:decimal(15,2);not null;default:0" json:"total_impuestos"`
	TotalGeneral     float64        `gorm:"type:decimal(15,2);not null;default:0" json:"total_general"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`

	Company *Company            `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
	Lines   []TaxSettlementLine `gorm:"foreignKey:TaxSettlementID" json:"lines,omitempty"`
	// Solo API: hay saldo pendiente en las deudas vinculadas (misma lógica que payment-suggestions).
	CanRegisterPayment bool `json:"can_register_payment" gorm:"-"`
}

func (TaxSettlement) TableName() string {
	return "tax_settlements"
}

type TaxSettlementLine struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	TaxSettlementID uint       `gorm:"not null;index" json:"tax_settlement_id"`
	LineType        string     `gorm:"size:30;not null" json:"line_type"`
	DocumentID      *uint      `gorm:"index" json:"document_id,omitempty"`
	ProductID       *uint      `gorm:"index" json:"product_id,omitempty"`
	Concept         string     `gorm:"size:512;not null" json:"concept"`
	Amount          float64    `gorm:"type:decimal(15,2);not null" json:"amount"`
	SortOrder       int        `gorm:"not null;default:0" json:"sort_order"`
	// PeriodYM: periodo contable de la línea YYYY-MM.
	PeriodYM        string     `gorm:"size:7" json:"period_ym"`
	PeriodDate      *time.Time `gorm:"type:date" json:"period_date,omitempty"` // primer día del mes de period_ym (compatibilidad / informes)
}

func (TaxSettlementLine) TableName() string {
	return "tax_settlement_lines"
}
