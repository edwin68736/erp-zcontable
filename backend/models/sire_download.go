package models

import "time"

// Estados de una descarga del SIRE.
const (
	SireDownloadProcessing = "en_proceso"
	SireDownloadReady      = "listo"
	SireDownloadNoData     = "sin_datos"
	SireDownloadFailed     = "error"
)

// SireDownload una consulta del SIRE (propuesta de ventas o compras de un período) y su resultado en Excel.
// El historial es de la empresa (lo ven todos los que tengan acceso a ella): permite volver a bajar el Excel de una
// consulta ya hecha sin consultar otra vez a SUNAT.
type SireDownload struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	CompanyID uint   `gorm:"not null;index:idx_sire_dl_company,priority:1" json:"company_id"`
	Libro     string `gorm:"size:10;not null" json:"libro"`   // ventas | compras
	Period    string `gorm:"size:6;not null" json:"period"`   // AAAAMM
	Mode      string `gorm:"size:12;not null" json:"mode"`    // sin_glosas
	Status    string `gorm:"size:12;not null" json:"status"`  // en_proceso | listo | sin_datos | error
	Step      string `gorm:"size:12" json:"step,omitempty"`   // solicitando | esperando | generando (mientras está en proceso)
	Ticket    string `gorm:"size:40" json:"ticket,omitempty"` // ticket de SUNAT

	Rows         int    `gorm:"not null;default:0" json:"rows"`
	Size         int    `gorm:"not null;default:0" json:"size"` // bytes del Excel
	ErrorCode    string `gorm:"size:40" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`
	ErrorDetail  string `gorm:"size:600" json:"error_detail,omitempty"`

	RequestedBy uint       `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time  `gorm:"index:idx_sire_dl_company,priority:2" json:"created_at"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`

	// Data el .xlsx generado (no sale en los listados).
	Data []byte `gorm:"type:longblob" json:"-"`
}

func (SireDownload) TableName() string { return "sire_downloads" }
