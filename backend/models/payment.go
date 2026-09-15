package models

import (
	"time"

	"gorm.io/gorm"
)

// PaymentPurposeDebt / PaymentPurposeService: valores válidos de Payment.Purpose (Blueprint Fase 2).
const (
	PaymentPurposeDebt    = "deuda"
	PaymentPurposeService = "servicio"
)

// IsValidPaymentPurpose valida un valor no nulo de Payment.Purpose (Fase 4 §2-3, validación
// centralizada y reutilizable: antes de esta función cada flujo comparaba el string a mano). Un
// Purpose NULL no se valida aquí — sigue siendo un estado permitido de compatibilidad/legado
// (pagos históricos sin clasificar), nunca una decisión de negocio de un flujo nuevo.
func IsValidPaymentPurpose(v string) bool {
	switch v {
	case PaymentPurposeDebt, PaymentPurposeService:
		return true
	default:
		return false
	}
}

// Payment representa un pago registrado para una empresa (y opcionalmente asociado a un documento)
type Payment struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	CompanyID  uint   `gorm:"not null;index" json:"company_id"`
	DocumentID *uint  `gorm:"index" json:"document_id"`
	Type       string `gorm:"size:20;not null;default:'applied'" json:"type"`
	// Purpose: naturaleza del dinero recibido — PaymentPurposeDebt (destinado a cancelar una cuenta
	// por cobrar, esté o no ya aplicado) o PaymentPurposeService (ingreso independiente que nunca
	// tuvo como finalidad pagar una deuda). Nullable: nil = sin clasificar (dato histórico sin
	// evidencia suficiente, ver backfill en payment_migrations.go, o pago nuevo creado antes de que
	// Fase 2.6 lo fije explícitamente en la creación). Deliberadamente NO se infiere de Type ni de la
	// ausencia de PaymentAllocation — son dos conceptos distintos (Blueprint Fase 2 §5, §11).
	Purpose *string   `gorm:"size:20;index" json:"purpose,omitempty"`
	Date    time.Time `json:"date"`
	Amount  float64   `gorm:"type:decimal(15,2);not null" json:"amount"`
	// Descuento comercial sobre el total (monto cobrado + descuento = suma de imputaciones).
	DiscountAmount float64 `gorm:"type:decimal(15,2);not null;default:0" json:"discount_amount"`
	Method         string  `gorm:"size:50" json:"method"` // transferencia, efectivo, etc.
	Reference      string  `gorm:"size:100" json:"reference"`
	Attachment     string  `gorm:"size:255" json:"attachment"`   // ruta/URL del comprobante
	Description    string  `gorm:"type:text" json:"description"` // detalle visible al cliente (ej. concepto del servicio)
	Notes          string  `gorm:"type:text" json:"notes"`
	// FiscalStatus: na | pending_receipt | linked (vínculo comprobante Tukifac)
	FiscalStatus string `gorm:"size:30;not null;default:'na'" json:"fiscal_status"`
	// Liquidación emitida a la que se asocia el pago (imputación sugerida desde esa liquidación).
	TaxSettlementID *uint          `gorm:"index" json:"tax_settlement_id,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`

	// Fase 6 (Blueprint §19): cancelación auditable. DeletedAt NO se reemplaza ni se deja de fijar —
	// sigue siendo lo que excluye el pago de todo el resto del sistema vía el scope automático de
	// GORM (docenas de sitios, ninguno usa .Unscoped()). Estos 3 campos son estrictamente aditivos:
	// motivo, actor y una marca de tiempo con semántica de "anulación", que DeletedAt no provee.
	// Nullable: nil = pago nunca anulado (incluye TODOS los pagos históricos, sin backfill — un pago
	// histórico soft-eliminado antes de Fase 6 queda con DeletedAt fijado pero VoidedAt=nil a
	// propósito, decisión explícita, ver docs/diseno-fase6-paso2-cancelaciones-writeoff-2026-09-15.md
	// E.3: no se inventan datos históricos que no existen).
	VoidedAt   *time.Time `json:"voided_at,omitempty"`
	VoidedBy   *uint      `gorm:"index" json:"voided_by,omitempty"`
	VoidReason string     `gorm:"type:text" json:"void_reason,omitempty"`

	Company              *Company              `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
	Document             *Document             `gorm:"foreignKey:DocumentID" json:"document,omitempty"`
	TaxSettlement        *TaxSettlement        `gorm:"foreignKey:TaxSettlementID" json:"tax_settlement,omitempty"`
	Allocations          []PaymentAllocation   `gorm:"foreignKey:PaymentID" json:"allocations,omitempty"`
	TukifacFiscalReceipt *TukifacFiscalReceipt `gorm:"foreignKey:LinkedPaymentID;references:ID" json:"tukifac_fiscal_receipt,omitempty"`
}

func (Payment) TableName() string {
	return "payments"
}
