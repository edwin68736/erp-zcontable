package models

import "time"

// Estados de la descarga de un comprobante electrónico (CPE).
const (
	SireCpeProcessing = "en_proceso"
	SireCpeReady      = "listo"   // se bajó al menos uno de los tres archivos
	SireCpeMissing    = "sin_cpe" // SUNAT no entregó ningún archivo (no es electrónico, no existe o no es de esta empresa)
	SireCpeFailed     = "error"   // no se pudo consultar (SOL, red…); se puede reintentar
)

// SireCpeFile los archivos que SUNAT entrega de un comprobante electrónico (PDF, XML y CDR) consultando como emisor o
// como receptor. Es de la empresa: sirve para tener a mano los comprobantes de una propuesta del SIRE sin volver a SUNAT.
type SireCpeFile struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	CompanyID uint   `gorm:"not null;uniqueIndex:ux_sire_cpe,priority:1" json:"company_id"`
	Ruc       string `gorm:"size:11;not null;uniqueIndex:ux_sire_cpe,priority:2" json:"ruc"`    // RUC del emisor del comprobante
	Tipo      string `gorm:"size:2;not null;uniqueIndex:ux_sire_cpe,priority:3" json:"tipo"`    // 01 factura, 03 boleta, 07 NC, 08 ND
	Serie     string `gorm:"size:10;not null;uniqueIndex:ux_sire_cpe,priority:4" json:"serie"`  // F001, E001, B001…
	Numero    string `gorm:"size:12;not null;uniqueIndex:ux_sire_cpe,priority:5" json:"numero"` // sin ceros a la izquierda
	Lado      string `gorm:"size:10;not null" json:"lado"`                                      // emisor | receptor (de la empresa)
	Libro     string `gorm:"size:10" json:"libro,omitempty"`                                    // ventas | compras, si salió de una propuesta
	Period    string `gorm:"size:6" json:"period,omitempty"`                                    // AAAAMM de esa propuesta

	Status       string `gorm:"size:12;not null;index" json:"status"`
	HasPDF       bool   `gorm:"not null;default:false" json:"has_pdf"`
	HasXML       bool   `gorm:"not null;default:false" json:"has_xml"`
	HasCDR       bool   `gorm:"not null;default:false" json:"has_cdr"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`

	RequestedBy uint       `gorm:"not null;default:0" json:"requested_by"`
	CreatedAt   time.Time  `json:"created_at"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`

	// Los archivos tal como los entrega SUNAT, ya sin el ZIP (no salen en los listados).
	PDF []byte `gorm:"type:longblob" json:"-"`
	XML []byte `gorm:"type:longblob" json:"-"`
	CDR []byte `gorm:"type:longblob" json:"-"`
}

func (SireCpeFile) TableName() string { return "sire_cpe_files" }
