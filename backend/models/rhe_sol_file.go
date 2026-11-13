package models

import "time"

// RheSolFile un PDF de un recibo por honorarios recibido que ya se bajó de SUNAT (Herramientas → RH). Sirve para marcar en la
// lista qué recibos ya tienen su PDF y proponer solo los pendientes cuando son más de los que caben en una tanda. Es de la empresa.
type RheSolFile struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	CompanyID   uint      `gorm:"not null;uniqueIndex:ux_rhe_sol_file,priority:1" json:"company_id"`
	EmisorDoc   string    `gorm:"size:11;not null;uniqueIndex:ux_rhe_sol_file,priority:2" json:"emisor_doc"`
	Comprobante string    `gorm:"size:20;not null;uniqueIndex:ux_rhe_sol_file,priority:3" json:"comprobante"` // E001-20
	RequestedBy uint      `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time `json:"created_at"`
}

func (RheSolFile) TableName() string { return "rhe_sol_files" }
