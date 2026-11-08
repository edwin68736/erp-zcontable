package models

import "time"

// Modos de los dispositivos de confianza.
const (
	DeviceTrustOff     = "off"     // no se usan
	DeviceTrustLearn   = "learn"   // se aprenden: cada equipo desde el que se entra queda como de confianza, sin pedir nada
	DeviceTrustEnforce = "enforce" // un equipo nuevo pide verificación (código TOTP o aprobación de un administrador)
)

// Cómo llegó un dispositivo a ser de confianza.
const (
	DeviceViaLearn    = "aprendido"
	DeviceViaTOTP     = "codigo"
	DeviceViaRecovery = "recuperacion"
	DeviceViaApproval = "aprobacion"
)

// Estados de una verificación de inicio de sesión.
const (
	ChallengePending  = "pendiente"
	ChallengeApproved = "aprobada"
	ChallengeDenied   = "rechazada"
	ChallengeUsed     = "usada"
)

// SecuritySetting configuración de seguridad del estudio (una sola fila).
type SecuritySetting struct {
	ID uint `gorm:"primaryKey" json:"-"`
	// DeviceTrustMode off | learn | enforce. En «learn» se registran los equipos sin pedir nada (periodo de gracia).
	DeviceTrustMode string `gorm:"size:10;not null;default:'learn'" json:"device_trust_mode"`
	// DeviceTrustDays cuántos días vale la confianza en un equipo (se renueva mientras se use seguido).
	DeviceTrustDays int `gorm:"not null;default:30" json:"device_trust_days"`
	// EnforceFrom si está, el modo «learn» pasa solo a «enforce» desde esa fecha.
	EnforceFrom *time.Time `json:"enforce_from,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (SecuritySetting) TableName() string { return "security_settings" }

// UserDevice un navegador desde el que un usuario inició sesión. La confianza es por usuario: que un equipo sea de
// confianza para una persona no lo es para otra. El identificador del equipo solo se guarda como huella.
type UserDevice struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	UserID       uint       `gorm:"not null;index:idx_user_devices_user,priority:1;uniqueIndex:ux_user_device_hash,priority:1" json:"user_id"`
	TokenHash    string     `gorm:"size:64;not null;uniqueIndex:ux_user_device_hash,priority:2" json:"-"`
	Label        string     `gorm:"size:100" json:"label"` // «Chrome · Windows»
	UserAgent    string     `gorm:"size:255" json:"user_agent"`
	FirstIP      string     `gorm:"size:64" json:"first_ip"`
	LastIP       string     `gorm:"size:64" json:"last_ip"`
	Via          string     `gorm:"size:20" json:"via"`
	CreatedAt    time.Time  `json:"created_at"`
	LastSeenAt   time.Time  `json:"last_seen_at"`
	TrustedUntil *time.Time `json:"trusted_until,omitempty"` // vacío: el equipo se conoce pero no es de confianza
	RevokedAt    *time.Time `gorm:"index:idx_user_devices_user,priority:2" json:"revoked_at,omitempty"`
}

func (UserDevice) TableName() string { return "user_devices" }

// LoginChallenge una verificación pendiente: la contraseña fue correcta pero el equipo es nuevo. Se resuelve con un
// código TOTP / de recuperación, o con la aprobación de un administrador. Todavía NO hay sesión.
type LoginChallenge struct {
	ID          string `gorm:"primaryKey;size:36" json:"id"`
	UserID      uint   `gorm:"not null;index" json:"user_id"`
	DeviceHash  string `gorm:"size:64;not null" json:"-"`
	DeviceLabel string `gorm:"size:100" json:"device_label"`
	IP          string `gorm:"size:64" json:"ip"`
	UserAgent   string `gorm:"size:255" json:"user_agent"`
	Status      string `gorm:"size:12;not null" json:"status"`
	Remember    bool   `gorm:"not null" json:"remember"` // dejar el equipo como de confianza al terminar
	Attempts    int    `gorm:"not null;default:0" json:"attempts"`    // códigos equivocados
	// ApprovalRequestedAt cuándo se pidió la aprobación de un administrador (vacío: no se pidió).
	ApprovalRequestedAt *time.Time `gorm:"index" json:"approval_requested_at,omitempty"`
	DecidedBy           uint       `json:"decided_by,omitempty"` // administrador que aprobó o rechazó
	CreatedAt           time.Time  `json:"created_at"`
	ExpiresAt           time.Time  `gorm:"index" json:"expires_at"`
	UsedAt              *time.Time `json:"used_at,omitempty"`
}

func (LoginChallenge) TableName() string { return "login_challenges" }

// UserTOTP la verificación en dos pasos con app de códigos de un usuario.
type UserTOTP struct {
	ID        uint       `gorm:"primaryKey" json:"-"`
	UserID    uint       `gorm:"not null;uniqueIndex" json:"user_id"`
	SecretEnc string     `gorm:"size:255;not null" json:"-"` // secreto cifrado
	Enabled   bool       `gorm:"not null;default:false" json:"enabled"`
	LastStep  int64      `gorm:"not null;default:0" json:"-"` // último código usado (no se puede repetir)
	Recovery  string     `gorm:"type:text" json:"-"`          // huellas de los códigos de recuperación (JSON)
	CreatedAt time.Time  `json:"created_at"`
	EnabledAt *time.Time `json:"enabled_at,omitempty"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (UserTOTP) TableName() string { return "user_totp" }
