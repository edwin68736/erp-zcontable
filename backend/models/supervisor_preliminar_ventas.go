package models

import (
	"time"

	"gorm.io/gorm"
)

// Estados de una entrega de Preliminar de Ventas (SupervisorPreliminarVentasRecord.Status).
// "Suspendida" NO es un valor de acá — es el overlay global de SupervisorMonthlyControl.Suspendida
// (§5.9.7), igual que ya lo leen PDT 601/621/Buzón SOL sin guardarlo por su cuenta.
const (
	PreliminarVentasPendiente  = "pendiente"
	PreliminarVentasRegistrado = "registrado"
	PreliminarVentasEnviado    = "enviado"
)

// SupervisorPreliminarVentasRecord resumen de ventas de UNA entrega del mes (el estudio envía el
// Preliminar de Ventas dos veces por mes — "slot" 1 y 2, cada uno su propio registro con sus
// propios datos, porque reflejan ventas acumuladas a fechas distintas) — colgado del mismo
// SupervisorMonthlyControl que PDT 601/621/Detracciones/Buzón SOL, para el mismo control de fechas
// de entrega (calendario, tipo "preliminar_ventas": la fecha más temprana del período es el slot 1,
// la siguiente el slot 2 — ver services/supervisor_preliminar_ventas_service.go).
//
// Es un módulo independiente: NO es una liquidación, no se convierte en una ni la reemplaza — el
// IGV/Renta resultante se calculan acá con las mismas reglas SUNAT (tasa IGV y régimen de renta de
// la empresa) pero a partir de estos campos, nunca leyendo supervisor_tax_liquidations.
//
// Solo Ventas (y opcionalmente Compras) se registran a mano; el resto (IGV por fila, IGV
// resultante, crédito arrastrado de la entrega anterior, IGV/Renta aproximados a pagar) se calcula —
// ver services/supervisor_preliminar_ventas_service.go.
type SupervisorPreliminarVentasRecord struct {
	ID               uint `gorm:"primaryKey" json:"id"`
	MonthlyControlID uint `gorm:"not null;uniqueIndex:idx_sup_prelim_ventas_ctrl_slot,priority:1" json:"monthly_control_id"`
	// SlotIndex 1 = primera entrega del mes, 2 = segunda. Cuál fecha del calendario es "1" y cuál
	// "2" lo decide el orden cronológico de las actividades tipo "preliminar_ventas" configuradas
	// para el período, no un campo propio acá.
	SlotIndex int `gorm:"not null;default:1;uniqueIndex:idx_sup_prelim_ventas_ctrl_slot,priority:2" json:"slot_index"`

	// IgvAplicable18/105: qué tasa(s) de IGV aplican a esta entrega — al menos una debe quedar en
	// true (si ambas llegan en false se cae a la tasa configurada de la empresa, nunca se guarda
	// sin ninguna). Por defecto sigue companies.igv_rate; el usuario puede activar también la otra
	// si la empresa emitió a ambas tasas en el período — mismo patrón que igv_aplicable_ventas en
	// Liquidación (ver frontend/src/utils/companyIgv.ts, TaxSectionPdt621.igv_aplicable_ventas).
	IgvAplicable18  bool `gorm:"not null;default:true" json:"igv_aplicable_18"`
	IgvAplicable105 bool `gorm:"not null;default:false" json:"igv_aplicable_105"`

	// Ventas — Base Imponible y No Gravadas de cada concepto, separadas por tasa IGV (18%/10.5%) —
	// misma forma que el detalle de IGV de Liquidación (ventas_netas_18/_105), pero registrado
	// directamente acá, sin depender de ella.
	FacturasBase18            float64 `gorm:"type:decimal(15,2);not null;default:0" json:"facturas_base_18"`
	FacturasNoGravadas18      float64 `gorm:"type:decimal(15,2);not null;default:0" json:"facturas_no_gravadas_18"`
	FacturasBase105           float64 `gorm:"type:decimal(15,2);not null;default:0" json:"facturas_base_105"`
	FacturasNoGravadas105     float64 `gorm:"type:decimal(15,2);not null;default:0" json:"facturas_no_gravadas_105"`
	BoletasBase18             float64 `gorm:"type:decimal(15,2);not null;default:0" json:"boletas_base_18"`
	BoletasNoGravadas18       float64 `gorm:"type:decimal(15,2);not null;default:0" json:"boletas_no_gravadas_18"`
	BoletasBase105            float64 `gorm:"type:decimal(15,2);not null;default:0" json:"boletas_base_105"`
	BoletasNoGravadas105      float64 `gorm:"type:decimal(15,2);not null;default:0" json:"boletas_no_gravadas_105"`
	NotasCreditoBase18        float64 `gorm:"type:decimal(15,2);not null;default:0" json:"notas_credito_base_18"`
	NotasCreditoNoGravadas18  float64 `gorm:"type:decimal(15,2);not null;default:0" json:"notas_credito_no_gravadas_18"`
	NotasCreditoBase105       float64 `gorm:"type:decimal(15,2);not null;default:0" json:"notas_credito_base_105"`
	NotasCreditoNoGravadas105 float64 `gorm:"type:decimal(15,2);not null;default:0" json:"notas_credito_no_gravadas_105"`
	// ReduccionIgvPct: % del I.G.V. a pagar (después de crédito, retención y percepción) que se
	// busca bajar con facturas de compra — de ahí sale el "importe aproximado a traer en facturas de
	// compra", que ya NO se digita: se calcula (ver computePreliminarVentasSummary). El estudio
	// trabaja normalmente al 95% (no se busca dejar el IGV en 0); es libre de cambiar, hasta 100%.
	ReduccionIgvPct float64 `gorm:"type:decimal(5,2);not null;default:95" json:"reduccion_igv_pct"`

	// CreditoPeriodoAnteriorOverride: por defecto el crédito de IGV se arrastra solo desde el I.G.V.
	// A PAGAR de la entrega anterior si salió negativo (ver computePreliminarVentasSummary /
	// preliminarVentasCreditoAnterior) — nil usa ese cálculo automático; si no es nil, lo reemplaza
	// (el usuario lo puede corregir a mano).
	CreditoPeriodoAnteriorOverride *float64 `gorm:"type:decimal(15,2)" json:"credito_periodo_anterior_override,omitempty"`
	// RetencionMonto/PercepcionMonto: montos aproximados a mano (sin arrastre automático ni
	// separación periodo/anterior, a diferencia del crédito de IGV — el usuario pidió explícitamente
	// mantenerlo simple, acorde al resto de este módulo) que también restan del I.G.V. resultante
	// para llegar al I.G.V. A PAGAR.
	RetencionMonto  float64 `gorm:"type:decimal(15,2);not null;default:0" json:"retencion_monto"`
	PercepcionMonto float64 `gorm:"type:decimal(15,2);not null;default:0" json:"percepcion_monto"`

	// Status: pendiente (default, sin datos) → registrado (automático al guardar Ventas/Compras) →
	// enviado (acción explícita del asistente — "Marcar como enviado" — separada de guardar).
	Status       string     `gorm:"size:20;not null;default:'pendiente'" json:"status"`
	SentAt       *time.Time `json:"sent_at,omitempty"`
	SentByUserID *uint      `gorm:"index" json:"sent_by_user_id,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	MonthlyControl *SupervisorMonthlyControl `gorm:"foreignKey:MonthlyControlID" json:"monthly_control,omitempty"`
	SentByUser     *User                     `gorm:"foreignKey:SentByUserID" json:"sent_by_user,omitempty"`
}

func (SupervisorPreliminarVentasRecord) TableName() string {
	return "supervisor_preliminar_ventas_records"
}
