package models

import "time"

// DetraccionConstancia una constancia de depósito de detracciones que ya se bajó de SUNAT (Herramientas → Consulta de
// Detracciones). Permite continuar una consulta con muchos pagos por tandas: cada descarga baja solo las constancias que
// aún no se habían bajado. Es de la empresa. Los pagos masivos se anotan con el prefijo «M» en el número.
type DetraccionConstancia struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	CompanyID   uint      `gorm:"not null;uniqueIndex:ux_detr_const,priority:1" json:"company_id"`
	Numero      string    `gorm:"size:24;not null;uniqueIndex:ux_detr_const,priority:2" json:"numero"`
	RequestedBy uint      `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time `json:"created_at"`
}

func (DetraccionConstancia) TableName() string { return "detraccion_constancias" }
