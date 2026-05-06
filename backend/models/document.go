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
	ID             uint           `gorm:"primaryKey" json:"id"`
	CompanyID      uint           `gorm:"not null;index" json:"company_id"`
	ExternalID     string         `gorm:"size:100;index" json:"external_id"` // ID de Tukifac u otro sistema
	Type           string         `gorm:"size:50;not null" json:"type"`      // tipo de comprobante
	Number         string         `gorm:"size:50;not null" json:"number"`
	IssueDate      time.Time      `json:"issue_date"`
	DueDate        *time.Time     `gorm:"index" json:"due_date,omitempty"`
	TotalAmount    float64        `gorm:"type:decimal(15,2);not null" json:"total_amount"`
	Description    string         `gorm:"type:text" json:"description"`
	ServiceMonth       string `gorm:"size:7;index" json:"service_month"`       // YYYY-MM mensualidad plan
	AccountingPeriod   string `gorm:"size:7;index" json:"accounting_period"` // YYYY-MM periodo contable del cargo (independiente de issue_date)
	Status         string         `gorm:"size:50;not null" json:"status"`   // emitido, pagado, vencido, etc.
	Source         string         `gorm:"size:50;not null" json:"source"`   // tukifac, manual, recurrente_plan
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`

	Company    *Company             `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
	Payments   []Payment            `gorm:"foreignKey:DocumentID" json:"payments,omitempty"`
	Allocations []PaymentAllocation `gorm:"foreignKey:DocumentID" json:"allocations,omitempty"`
	Items      []DocumentItem       `gorm:"foreignKey:DocumentID" json:"items,omitempty"`
	// Número legible para UI (p. ej. DEU-LI-202603 en deudas de liquidación); no persiste en BD.
	DisplayNumber string `json:"display_number,omitempty" gorm:"-"`
}

func (Document) TableName() string {
	return "documents"
}
