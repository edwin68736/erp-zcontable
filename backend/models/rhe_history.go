package models

import "time"

// Estados de una consulta del historial de RH.
const (
	RheHistoryReady  = "listo"
	RheHistoryNoData = "sin_datos"
	RheHistoryFailed = "error"
)

// RheHistory una consulta de la plataforma de confirmación del RHE y de la FE (Herramientas → RH) y su resultado.
// El historial es de la empresa (lo ven todos los que tengan acceso a ella): permite volver a ver una consulta ya
// hecha sin consultar otra vez a SUNAT.
type RheHistory struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	CompanyID uint   `gorm:"not null;index:idx_rhe_hist_company,priority:1" json:"company_id"`
	Tipo      string `gorm:"size:1;not null" json:"tipo"`     // C (recibidos) | V (emitidos)
	CodCpe    string `gorm:"size:2;not null" json:"cod_cpe"`  // 02 recibo por honorarios | 01 factura
	Desde     string `gorm:"size:10;not null" json:"desde"`   // AAAA-MM-DD (fecha de emisión)
	Hasta     string `gorm:"size:10;not null" json:"hasta"`   // AAAA-MM-DD
	Estados   string `gorm:"size:60" json:"estados"`          // estados consultados, separados por coma
	Status    string `gorm:"size:12;not null" json:"status"`  // listo | sin_datos | error
	Total     int    `gorm:"not null;default:0" json:"total"` // comprobantes encontrados
	Consultas int    `gorm:"not null;default:0" json:"consultas"`
	Truncado  bool   `gorm:"not null;default:false" json:"truncado"`

	ErrorCode    string `gorm:"size:40" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`
	ErrorDetail  string `gorm:"size:600" json:"error_detail,omitempty"`

	RequestedBy uint      `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time `gorm:"index:idx_rhe_hist_company,priority:2" json:"created_at"`

	// Data el resultado (JSON comprimido con gzip). No sale en los listados.
	Data []byte `gorm:"type:longblob" json:"-"`
}

func (RheHistory) TableName() string { return "rhe_history" }
