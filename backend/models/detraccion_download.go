package models

import "time"

// Estados de una descarga de constancias de detracciones.
const (
	DetraccionDownloadRunning = "en_proceso"
	DetraccionDownloadReady   = "listo"
	DetraccionDownloadNoData  = "sin_datos"
	DetraccionDownloadFailed  = "error"
)

// DetraccionDownload una descarga de Herramientas → Consulta de Detracciones: los pagos de detracciones (constancias de
// depósito) que SUNAT muestra en «Pagos → Consulta de Pago de Detracciones» para una empresa, con el Excel y las
// constancias en HTML guardados. Nace «en_proceso» (se baja una constancia por pago) y se completa al terminar. Es de la
// empresa: la ven todos los que tengan acceso a ella.
type DetraccionDownload struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	CompanyID uint `gorm:"not null;index:idx_detr_dl_company,priority:1" json:"company_id"`

	// Filtros de la consulta (los mismos que la pantalla de SUNAT).
	TipoCuenta string `gorm:"size:1;not null" json:"tipo_cuenta"`       // 1 convencional, 2 especial IVAP, 3 Ley 30737
	TipoPago   string `gorm:"size:24;not null" json:"tipo_pago"`        // individuales | masivos | pasajeros
	Modo       string `gorm:"size:8;not null" json:"modo"`              // fecha | periodo
	Desde      string `gorm:"size:10;not null;default:''" json:"desde"` // AAAA-MM-DD (modo fecha)
	Hasta      string `gorm:"size:10;not null;default:''" json:"hasta"`
	Periodo    string `gorm:"size:6;not null;default:''" json:"periodo"` // AAAAMM (modo periodo)

	Status  string  `gorm:"size:12;not null" json:"status"`
	Total   int     `gorm:"not null;default:0" json:"total"`   // pagos encontrados
	Monto   float64 `gorm:"not null;default:0" json:"monto"`   // suma de los depósitos
	Bajadas int     `gorm:"not null;default:0" json:"bajadas"` // constancias que se pudieron bajar
	Aviso   string  `gorm:"size:600" json:"aviso,omitempty"`   // constancias que no se pudieron bajar, etc.

	ErrorCode    string `gorm:"size:40" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`
	ErrorDetail  string `gorm:"size:600" json:"error_detail,omitempty"`

	RequestedBy uint       `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time  `gorm:"index:idx_detr_dl_company,priority:2" json:"created_at"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`

	// Zip el Excel del reporte y las constancias (constancias/Constancia_N.html). No sale en los listados.
	Zip []byte `gorm:"type:longblob" json:"-"`
}

func (DetraccionDownload) TableName() string { return "detraccion_downloads" }
