package models

import "time"

// Tipos de evento de la bitácora de seguridad.
const (
	AuthEventLoginOK         = "login_ok"
	AuthEventLoginFail       = "login_fail"
	AuthEventLoginBlocked    = "login_blocked" // intento rechazado por demasiados fallos (no suma fallos)
	AuthEventPasswordChange  = "password_change"
	AuthEventPasswordChangeX = "password_change_fail" // intento fallido de cambiar la contraseña propia
	AuthEventPasswordReset   = "password_reset"       // un administrador cambió la contraseña de otro usuario
	AuthEventLogout          = "logout"
	AuthEventSessionRevoked  = "session_revoked" // se cerró una sesión desde el servidor (otro equipo, admin, cambio de contraseña)
	AuthEventIdleLogout      = "idle_logout"     // sesión cerrada por inactividad

	// Dispositivos de confianza y verificación en dos pasos.
	AuthEventDeviceNew         = "device_new"                // un equipo nuevo quedó registrado (modo aprendizaje)
	AuthEventDeviceChallenge   = "device_challenge"          // equipo nuevo: se pidió verificación
	AuthEventDeviceVerified    = "device_verified"           // equipo nuevo verificado con código o aprobación
	AuthEventApprovalRequested = "device_approval_requested" // la persona pidió aprobación de un administrador
	AuthEventDeviceApproved    = "device_approved"           // un administrador aprobó un equipo
	AuthEventDeviceDenied      = "device_denied"             // un administrador rechazó un equipo
	AuthEventDeviceRevoked     = "device_revoked"            // se quitó un equipo de confianza
	AuthEventTOTPEnabled       = "totp_enabled"
	AuthEventTOTPDisabled      = "totp_disabled"
	AuthEventTOTPReset         = "totp_reset" // un administrador dejó a la persona sin verificación en dos pasos ni equipos
	AuthEventSettingsChanged   = "security_settings_changed"
)

// AuthEvent bitácora de seguridad: quién intentó entrar (o cambiar su contraseña), desde dónde y con qué resultado.
// Sirve para el bloqueo por intentos fallidos y para que el administrador revise accesos sospechosos. Nunca guarda
// contraseñas ni tokens.
type AuthEvent struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Type      string    `gorm:"size:30;not null;index:idx_auth_events_type_time,priority:1" json:"type"`
	UserID    uint      `gorm:"index" json:"user_id,omitempty"`                                      // 0 si el usuario no existe
	Username  string    `gorm:"size:100;index:idx_auth_events_user_time,priority:1" json:"username"` // normalizado (minúsculas)
	IP        string    `gorm:"size:64;index:idx_auth_events_ip_time,priority:1" json:"ip"`          // IP del cliente
	UserAgent string    `gorm:"size:255" json:"user_agent"`
	Detail    string    `gorm:"size:255" json:"detail,omitempty"` // motivo: contraseña incorrecta, usuario inexistente, inactivo…
	CreatedAt time.Time `gorm:"index:idx_auth_events_type_time,priority:2;index:idx_auth_events_user_time,priority:2;index:idx_auth_events_ip_time,priority:2" json:"created_at"`
}

func (AuthEvent) TableName() string { return "auth_events" }
