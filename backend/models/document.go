package models

import (
	"time"

	"gorm.io/gorm"
)

// DocumentTypeLiquidacion es el tipo guardado en `documents.type` para cargos creados al emitir
// una liquidación (líneas ajuste / impuesto manual, número DEU-LIQ-*).
const DocumentTypeLiquidacion = "LI"

// Document representa un comprobante financiero (sincronizado o manual)
type Document struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	CompanyID        uint           `gorm:"not null;index" json:"company_id"`
	TaxSettlementID  *uint          `gorm:"index" json:"tax_settlement_id,omitempty"`
	ExternalID       string         `gorm:"size:100;index" json:"external_id"` // ID de Tukifac u otro sistema
	Type             string         `gorm:"size:50;not null" json:"type"`      // tipo de comprobante
	Number           string         `gorm:"size:50;not null" json:"number"`
	IssueDate        time.Time      `json:"issue_date"`
	DueDate          *time.Time     `gorm:"index" json:"due_date,omitempty"`
	TotalAmount      float64        `gorm:"type:decimal(15,2);not null" json:"total_amount"`
	BalanceAmount    float64        `gorm:"type:decimal(18,6);not null;default:0" json:"balance_amount"`
	HasPeriod        bool           `gorm:"not null;default:0" json:"has_period"`
	PeriodMonth      *int16         `json:"period_month,omitempty"`
	PeriodYear       *int16         `json:"period_year,omitempty"`
	Description      string         `gorm:"type:text" json:"description"`
	ServiceMonth     string         `gorm:"size:64;index" json:"service_month"`       // YYYY-MM o etiqueta corta (legacy)
	AccountingPeriod string         `gorm:"size:64;index" json:"accounting_period"` // periodo contable (legacy + display)
	Status           string         `gorm:"size:50;not null" json:"status"`           // pendiente, parcial, pagado, anulado
	Source           string         `gorm:"size:50;not null" json:"source"`           // tukifac, manual, recurrente_plan, liquidacion
	LegacyStatus     string         `gorm:"size:32;index;default:''" json:"legacy_status,omitempty"` // vacío=activo; legacy_merged, legacy_promoted, archived
	MergedIntoDocumentID *uint      `gorm:"index" json:"merged_into_document_id,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`

	Company       *Company             `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
	TaxSettlement *TaxSettlement       `gorm:"foreignKey:TaxSettlementID" json:"tax_settlement,omitempty"`
	Payments      []Payment            `gorm:"foreignKey:DocumentID" json:"payments,omitempty"`
	Allocations   []PaymentAllocation  `gorm:"foreignKey:DocumentID" json:"allocations,omitempty"`
	Items         []DocumentItem       `gorm:"foreignKey:DocumentID" json:"items,omitempty"`
	// DisplayNumber legible para UI (p. ej. DEU-LI-202603 en deudas de liquidación); no persiste en BD.
	DisplayNumber string `json:"display_number,omitempty" gorm:"-"`
	// HasItems indica si existen filas en document_items (relleno en API, no columna en BD).
	HasItems bool `json:"has_items,omitempty" gorm:"-"`
	// PaidAmount calculado en API (no persiste).
	PaidAmount    float64                       `json:"paid_amount,omitempty" gorm:"-"`
	IsOverdue     bool                          `json:"is_overdue,omitempty" gorm:"-"`
	PaymentHistory []DocumentPaymentHistoryEntry `json:"payment_history,omitempty" gorm:"-"`
}

// DocumentPaymentHistoryEntry línea del historial de pagos aplicados a la deuda.
type DocumentPaymentHistoryEntry struct {
	PaymentID   uint      `json:"payment_id"`
	Date        time.Time `json:"date"`
	Amount      float64   `json:"amount"`
	Method      string    `json:"method"`
	Reference   string    `json:"reference"`
	Notes       string    `json:"notes"`
	Description string    `json:"description"`
}

func (Document) TableName() string {
	return "documents"
}
