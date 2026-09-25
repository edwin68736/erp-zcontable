package models

import (
	"time"

	"gorm.io/gorm"
)

// SupervisorPreliminarVentasRecord resumen de ventas del mes (una por empresa+período, colgado del
// mismo SupervisorMonthlyControl que PDT 601/621/Detracciones/Buzón SOL) que el asistente registra
// para generar el PDF "Preliminar de Ventas" que se envía al cliente antes del cierre de mes.
//
// Es un módulo independiente: NO es una liquidación, no se convierte en una ni la reemplaza — el
// IGV/Renta resultante se calculan acá con las mismas reglas SUNAT (tasa IGV y régimen de renta de
// la empresa) pero a partir de estos campos, nunca leyendo supervisor_tax_liquidations.
//
// Solo Ventas (y opcionalmente Compras) se registran a mano; el resto (IGV por fila, IGV
// resultante, crédito arrastrado del período anterior, IGV/Renta aproximados a pagar) se calcula —
// ver services/supervisor_preliminar_ventas_service.go.
type SupervisorPreliminarVentasRecord struct {
	ID               uint `gorm:"primaryKey" json:"id"`
	MonthlyControlID uint `gorm:"not null;uniqueIndex" json:"monthly_control_id"`
	// Ventas — Base Imponible y No Gravadas de cada concepto (misma forma que el detalle de IGV
	// de Liquidación, pero registrado directamente acá, sin depender de ella).
	FacturasBase           float64 `gorm:"type:decimal(15,2);not null;default:0" json:"facturas_base"`
	FacturasNoGravadas     float64 `gorm:"type:decimal(15,2);not null;default:0" json:"facturas_no_gravadas"`
	BoletasBase            float64 `gorm:"type:decimal(15,2);not null;default:0" json:"boletas_base"`
	BoletasNoGravadas      float64 `gorm:"type:decimal(15,2);not null;default:0" json:"boletas_no_gravadas"`
	NotasCreditoBase       float64 `gorm:"type:decimal(15,2);not null;default:0" json:"notas_credito_base"`
	NotasCreditoNoGravadas float64 `gorm:"type:decimal(15,2);not null;default:0" json:"notas_credito_no_gravadas"`
	// Compras — importe aproximado, opcional (el cliente muchas veces no lo tiene a esta altura del
	// mes). En 0 el PDF lo deja en blanco, igual que la plantilla del estudio.
	ComprasBase float64        `gorm:"type:decimal(15,2);not null;default:0" json:"compras_base"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	MonthlyControl *SupervisorMonthlyControl `gorm:"foreignKey:MonthlyControlID" json:"monthly_control,omitempty"`
}

func (SupervisorPreliminarVentasRecord) TableName() string {
	return "supervisor_preliminar_ventas_records"
}
