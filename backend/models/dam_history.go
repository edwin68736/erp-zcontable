package models

import "time"

// Estados de una consulta del historial de DAM.
const (
	DamHistoryRunning = "en_proceso"
	DamHistoryReady   = "listo"
	DamHistoryNoData  = "sin_datos"
	DamHistoryFailed  = "error"
)

// DamHistory una consulta de DAM (Herramientas → Consulta DAM) y su resultado. La búsqueda en Aduanas tarda más de un
// minuto, así que se procesa en segundo plano: la fila nace «en_proceso» y se completa al terminar. Es de la empresa:
// la ven todos los que tengan acceso a ella.
type DamHistory struct {
	ID            uint    `gorm:"primaryKey" json:"id"`
	CompanyID     uint    `gorm:"not null;index:idx_dam_hist_company,priority:1" json:"company_id"`
	Desde         string  `gorm:"size:10;not null" json:"desde"` // AAAA-MM-DD (fecha de numeración)
	Hasta         string  `gorm:"size:10;not null" json:"hasta"`
	Status        string  `gorm:"size:12;not null" json:"status"`
	Total         int     `gorm:"not null;default:0" json:"total"` // DAM encontradas
	TotalValor    float64 `gorm:"not null;default:0" json:"total_valor"`
	TotalClausula float64 `gorm:"not null;default:0" json:"total_clausula"`
	Aviso         string  `gorm:"size:600" json:"aviso,omitempty"` // mensaje de SUNAT que no impide mostrar la lista

	ErrorCode    string `gorm:"size:40" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`
	ErrorDetail  string `gorm:"size:600" json:"error_detail,omitempty"`

	RequestedBy uint       `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time  `gorm:"index:idx_dam_hist_company,priority:2" json:"created_at"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`

	// Data el resultado (JSON comprimido con gzip). No sale en los listados.
	Data []byte `gorm:"type:longblob" json:"-"`
}

func (DamHistory) TableName() string { return "dam_history" }
