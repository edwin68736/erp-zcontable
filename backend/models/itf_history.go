package models

import "time"

// Estados de una consulta del historial de ITF.
const (
	ItfHistoryReady  = "listo"
	ItfHistoryNoData = "sin_datos"
	ItfHistoryFailed = "error"
)

// ItfHistory una consulta de ITF (Herramientas → Consulta ITF) y su resultado. Es de la empresa: la ven todos los que
// tengan acceso a ella y permite volver a ver una consulta ya hecha sin consultar otra vez a SUNAT.
type ItfHistory struct {
	ID               uint    `gorm:"primaryKey" json:"id"`
	CompanyID        uint    `gorm:"not null;index:idx_itf_hist_company,priority:1" json:"company_id"`
	Desde            string  `gorm:"size:6;not null" json:"desde"` // AAAAMM
	Hasta            string  `gorm:"size:6;not null" json:"hasta"` // AAAAMM
	Status           string  `gorm:"size:12;not null" json:"status"`
	Total            int     `gorm:"not null;default:0" json:"total"` // registros de las tres tablas
	TotalImpuesto    float64 `gorm:"not null;default:0" json:"total_impuesto"`
	TotalMovimientos float64 `gorm:"not null;default:0" json:"total_movimientos"`

	ErrorCode    string `gorm:"size:40" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`
	ErrorDetail  string `gorm:"size:600" json:"error_detail,omitempty"`

	RequestedBy uint      `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time `gorm:"index:idx_itf_hist_company,priority:2" json:"created_at"`

	// Data el resultado (JSON comprimido con gzip). No sale en los listados.
	Data []byte `gorm:"type:longblob" json:"-"`
}

func (ItfHistory) TableName() string { return "itf_history" }
