package models

import "time"

// Estados de una consulta del historial de recibos por honorarios (SOL).
const (
	RheSolHistoryReady  = "listo"
	RheSolHistoryNoData = "sin_datos"
	RheSolHistoryFailed = "error"
)

// RheSolHistory una consulta de recibos por honorarios recibidos (Herramientas → RH, lectura en SOL) y su resultado.
// Es de la empresa: la ven todos los que tengan acceso a ella y permite volver a ver una consulta ya hecha sin
// consultar otra vez a SUNAT.
type RheSolHistory struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	CompanyID uint   `gorm:"not null;index:idx_rhe_sol_hist_company,priority:1" json:"company_id"`
	Desde     string `gorm:"size:10;not null" json:"desde"` // AAAA-MM-DD (fecha de emisión)
	Hasta     string `gorm:"size:10;not null" json:"hasta"`
	Status    string `gorm:"size:12;not null" json:"status"`
	Total     int    `gorm:"not null;default:0" json:"total"`
	Consultas int    `gorm:"not null;default:0" json:"consultas"`
	Truncado  bool   `gorm:"not null;default:false" json:"truncado"`

	ErrorCode    string `gorm:"size:40" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`
	ErrorDetail  string `gorm:"size:600" json:"error_detail,omitempty"`

	RequestedBy uint      `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time `gorm:"index:idx_rhe_sol_hist_company,priority:2" json:"created_at"`

	// Data el resultado (JSON comprimido con gzip). No sale en los listados.
	Data []byte `gorm:"type:longblob" json:"-"`
}

func (RheSolHistory) TableName() string { return "rhe_sol_history" }
