package models

import "time"

// Estados de la sincronización del buzón SUNAT de una empresa.
const (
	SunatBuzonStatusOK         = "ok"
	SunatBuzonStatusError      = "error"
	SunatBuzonStatusSinClave   = "sin_clave"
	SunatBuzonStatusRechazadas = "credenciales_rechazadas"
)

// SunatBuzonMessage una notificación (tipo 2) o mensaje (tipo 1) del Buzón Electrónico SOL de una empresa,
// tal como SUNAT lo lista. Solo se guarda el listado: el detalle y los adjuntos no se abren (abrir un mensaje lo
// marca como leído en SUNAT).
type SunatBuzonMessage struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	CompanyID  uint   `gorm:"not null;uniqueIndex:ux_buzon_company_msg,priority:1;index:idx_buzon_company_pub,priority:1" json:"company_id"`
	CodMensaje uint64 `gorm:"not null;uniqueIndex:ux_buzon_company_msg,priority:2" json:"cod_mensaje"`
	Tipo       int    `gorm:"not null;index" json:"tipo"` // 1 mensaje, 2 notificación

	Asunto          string     `gorm:"type:text" json:"asunto"`
	FecPublica      *time.Time `gorm:"index:idx_buzon_company_pub,priority:2" json:"fec_publica,omitempty"`
	FecPublicaTexto string     `gorm:"size:30" json:"fec_publica_texto"` // tal como la entrega SUNAT (dd/mm/aaaa hh:mm:ss)
	Remitente       string     `gorm:"size:60" json:"remitente"`
	CodDepen        string     `gorm:"size:20" json:"cod_depen"`
	CodEtiqueta     string     `gorm:"size:4" json:"cod_etiqueta"`
	Adjuntos        int        `gorm:"not null;default:0" json:"adjuntos"`

	Leido     bool `gorm:"not null;default:false" json:"leido"`
	Urgente   bool `gorm:"not null;default:false" json:"urgente"`
	Destacado bool `gorm:"not null;default:false" json:"destacado"`
	// EnBuzon false si SUNAT dejó de listarlo (eliminado o movido a otra carpeta).
	EnBuzon bool `gorm:"not null;default:true" json:"en_buzon"`
	// EsNuevo apareció en una sincronización posterior a la primera y nadie lo ha marcado como visto aún.
	EsNuevo bool `gorm:"not null;default:false;index" json:"es_nuevo"`

	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	Raw         string    `gorm:"type:text" json:"-"` // fila original de SUNAT (JSON), por si hace falta otro campo después

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SunatBuzonMessage) TableName() string { return "sunat_buzon_messages" }

// SunatBuzonSync estado de la última sincronización del buzón de una empresa (una fila por empresa).
type SunatBuzonSync struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	CompanyID uint `gorm:"not null;uniqueIndex" json:"company_id"`

	Status       string `gorm:"size:30;not null" json:"status"`
	ErrorCode    string `gorm:"size:40" json:"error_code,omitempty"`
	ErrorMessage string `gorm:"size:600" json:"error_message,omitempty"`

	LastAttemptAt *time.Time `json:"last_attempt_at,omitempty"`
	LastSuccessAt *time.Time `json:"last_success_at,omitempty"`
	Source        string     `gorm:"size:12" json:"source"` // manual | nocturna
	TriggeredBy   uint       `json:"triggered_by,omitempty"`
	DurationMs    int        `json:"duration_ms"`

	// Huella (hash) del usuario y la clave SOL con que SUNAT las rechazó: mientras no cambien, no se vuelve a intentar.
	CredFingerprint string `gorm:"size:64" json:"-"`
	// BaselineDone ya se hizo la primera sincronización exitosa (lo anterior no se marca como "nuevo").
	BaselineDone bool `gorm:"not null;default:false" json:"baseline_done"`

	// Blocked (no se guarda) las credenciales vigentes son las mismas que SUNAT rechazó: no se reintenta hasta corregirlas.
	Blocked bool `gorm:"-" json:"blocked"`

	Notificaciones int `gorm:"not null;default:0" json:"notificaciones"`
	Mensajes       int `gorm:"not null;default:0" json:"mensajes"`
	NoLeidas       int `gorm:"not null;default:0" json:"no_leidas"`
	Urgentes       int `gorm:"not null;default:0" json:"urgentes"`
	Nuevos         int `gorm:"not null;default:0" json:"nuevos"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SunatBuzonSync) TableName() string { return "sunat_buzon_syncs" }
