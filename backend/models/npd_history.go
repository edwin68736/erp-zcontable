package models

import "time"

// Estados de una consulta del historial de NPD.
const (
	NpdHistoryReady  = "listo"
	NpdHistoryNoData = "sin_datos"
	NpdHistoryFailed = "error"
)

// NpdHistory una consulta de NPD (Herramientas → Consulta de detracciones) y su resultado. Es de la empresa: la ven
// todos los que tengan acceso a ella y permite volver a ver una consulta ya hecha sin consultar otra vez a SUNAT.
type NpdHistory struct {
	ID             uint    `gorm:"primaryKey" json:"id"`
	CompanyID      uint    `gorm:"not null;index:idx_npd_hist_company,priority:1" json:"company_id"`
	Desde          string  `gorm:"size:10;not null" json:"desde"` // AAAA-MM-DD (fecha de generación)
	Hasta          string  `gorm:"size:10;not null" json:"hasta"`
	Status         string  `gorm:"size:12;not null" json:"status"`
	Total          int     `gorm:"not null;default:0" json:"total"` // NPD encontrados
	TotalImporte   float64 `gorm:"not null;default:0" json:"total_importe"`
	Vigentes       int     `gorm:"not null;default:0" json:"vigentes"` // pendientes de pago
	ImporteVigente float64 `gorm:"not null;default:0" json:"importe_vigente"`

	ErrorCode    string `gorm:"size:40" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`
	ErrorDetail  string `gorm:"size:600" json:"error_detail,omitempty"`

	RequestedBy uint      `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time `gorm:"index:idx_npd_hist_company,priority:2" json:"created_at"`

	// Data el resultado (JSON comprimido con gzip). No sale en los listados.
	Data []byte `gorm:"type:longblob" json:"-"`
}

func (NpdHistory) TableName() string { return "npd_history" }
