package models

import "time"

// UserSession una sesión iniciada (un token). Permite cerrarla desde el servidor (cerrar sesión en otros equipos,
// desactivar a un usuario, cambio de contraseña) y cerrarla sola por inactividad. El token lleva el id de la sesión.
type UserSession struct {
	ID           string    `gorm:"primaryKey;size:36" json:"id"`
	UserID       uint      `gorm:"not null;index:idx_user_sessions_user,priority:1" json:"user_id"`
	DeviceID     uint      `gorm:"not null;default:0" json:"device_id"` // dispositivo de confianza con el que entró (0 = ninguno)
	IP           string    `gorm:"size:64" json:"ip"`
	UserAgent    string    `gorm:"size:255" json:"user_agent"`
	CreatedAt    time.Time `json:"created_at"`
	LastActiveAt time.Time `json:"last_active_at"` // última actividad real de la persona (no cuenta lo que hace el sistema solo)
	ExpiresAt    time.Time `gorm:"index" json:"expires_at"`
	// ReauthAt última vez que la persona volvió a escribir su contraseña (acciones sensibles piden hacerlo hace poco).
	ReauthAt      *time.Time `json:"reauth_at,omitempty"`
	RevokedAt     *time.Time `gorm:"index:idx_user_sessions_user,priority:2" json:"revoked_at,omitempty"`
	RevokedReason string     `gorm:"size:60" json:"revoked_reason,omitempty"`
}

func (UserSession) TableName() string { return "user_sessions" }
