package services

import (
	"net"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Seguridad del inicio de sesión: bitácora de eventos y bloqueo temporal por intentos fallidos.
//
// Reglas (se cuentan solo los intentos FALLIDOS de los últimos 15 minutos, y los del usuario se reinician con cada
// acceso correcto):
//   - 5 fallos para un mismo usuario  → ese usuario queda bloqueado hasta que el 5.º fallo cumpla 15 minutos.
//   - 30 fallos desde una misma IP    → esa IP queda bloqueada (cubre pruebas con muchos usuarios).
//
// Un intento bloqueado se registra, pero no suma fallos (no se puede alargar el bloqueo a propósito). El bloqueo
// vale también para usuarios que no existen: así no se puede averiguar quién existe por cómo responde el sistema.

const (
	authLockWindow  = 15 * time.Minute
	authMaxFailUser = 5
	authMaxFailIP   = 30
)

type AuthSecurityService struct {
	now func() time.Time
}

func NewAuthSecurityService() *AuthSecurityService {
	return &AuthSecurityService{now: time.Now}
}

// NormalizeLoginUsername minúsculas y sin espacios, igual que usa el login para buscar al usuario.
func NormalizeLoginUsername(u string) string {
	return truncateStr(strings.ToLower(strings.TrimSpace(u)), 100)
}

// Record guarda un evento de la bitácora (nunca interrumpe el flujo: si no se puede guardar, solo se omite).
func (s *AuthSecurityService) Record(typ string, userID uint, username, ip, userAgent, detail string) {
	_ = database.DB.Create(&models.AuthEvent{
		Type: typ, UserID: userID, Username: NormalizeLoginUsername(username), IP: truncateStr(strings.TrimSpace(ip), 64),
		UserAgent: truncateStr(strings.TrimSpace(userAgent), 255), Detail: truncateStr(detail, 255), CreatedAt: s.now(),
	}).Error
}

// Locked indica si el usuario o la IP están bloqueados y cuánto falta para que se levante.
func (s *AuthSecurityService) Locked(username, ip string) (time.Duration, bool) {
	now := s.now()
	since := now.Add(-authLockWindow)
	var wait time.Duration

	if u := NormalizeLoginUsername(username); u != "" {
		// Solo cuentan los fallos posteriores al último acceso correcto.
		var lastOK models.AuthEvent
		from := since
		if err := database.DB.Where("username = ? AND type = ? AND created_at > ?", u, models.AuthEventLoginOK, since).
			Order("created_at DESC").First(&lastOK).Error; err == nil && lastOK.CreatedAt.After(from) {
			from = lastOK.CreatedAt
		}
		var fails []models.AuthEvent
		database.DB.Where("username = ? AND type = ? AND created_at > ?", u, models.AuthEventLoginFail, from).
			Order("created_at DESC").Limit(authMaxFailUser).Find(&fails)
		if len(fails) >= authMaxFailUser {
			if w := fails[authMaxFailUser-1].CreatedAt.Add(authLockWindow).Sub(now); w > wait {
				wait = w
			}
		}
	}
	if ip = strings.TrimSpace(ip); ip != "" {
		var fails []models.AuthEvent
		database.DB.Where("ip = ? AND type = ? AND created_at > ?", ip, models.AuthEventLoginFail, since).
			Order("created_at DESC").Limit(authMaxFailIP).Find(&fails)
		if len(fails) >= authMaxFailIP {
			if w := fails[authMaxFailIP-1].CreatedAt.Add(authLockWindow).Sub(now); w > wait {
				wait = w
			}
		}
	}
	return wait, wait > 0
}

// AuthEventFilter filtros de la bitácora.
type AuthEventFilter struct {
	Type     string
	Username string
	IP       string
	From, To *time.Time
	Page     int
	PerPage  int
}

type AuthEventPage struct {
	Rows       []models.AuthEvent `json:"rows"`
	Total      int64              `json:"total"`
	Page       int                `json:"page"`
	PerPage    int                `json:"per_page"`
	TotalPages int                `json:"total_pages"`
}

// List la bitácora, lo más reciente primero.
func (s *AuthSecurityService) List(f AuthEventFilter) (*AuthEventPage, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PerPage < 1 || f.PerPage > 200 {
		f.PerPage = 50
	}
	q := database.DB.Model(&models.AuthEvent{})
	if t := strings.TrimSpace(f.Type); t != "" {
		q = q.Where("type = ?", t)
	}
	if u := NormalizeLoginUsername(f.Username); u != "" {
		q = q.Where("username LIKE ?", "%"+u+"%")
	}
	if ip := strings.TrimSpace(f.IP); ip != "" {
		q = q.Where("ip = ?", ip)
	}
	if f.From != nil {
		q = q.Where("created_at >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("created_at < ?", *f.To)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}
	var rows []models.AuthEvent
	if err := q.Order("created_at DESC, id DESC").Offset((f.Page - 1) * f.PerPage).Limit(f.PerPage).Find(&rows).Error; err != nil {
		return nil, err
	}
	pages := int((total + int64(f.PerPage) - 1) / int64(f.PerPage))
	return &AuthEventPage{Rows: rows, Total: total, Page: f.Page, PerPage: f.PerPage, TotalPages: pages}, nil
}

// PurgeOlderThan borra eventos viejos (la bitácora no crece sin límite).
func (s *AuthSecurityService) PurgeOlderThan(d time.Duration) int64 {
	res := database.DB.Where("created_at < ?", s.now().Add(-d)).Delete(&models.AuthEvent{})
	return res.RowsAffected
}

// ClientIP la IP real del cliente detrás de un proxy de confianza (Traefik): si la conexión viene de una red privada
// se toma la última IP de X-Forwarded-For (la que agregó el proxy; la primera la puede escribir el propio cliente).
func ClientIP(remote, xForwardedFor string) string {
	remote = strings.TrimSpace(remote)
	ip := net.ParseIP(remote)
	if ip != nil && (ip.IsPrivate() || ip.IsLoopback()) && strings.TrimSpace(xForwardedFor) != "" {
		parts := strings.Split(xForwardedFor, ",")
		if last := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(last) != nil {
			return last
		}
	}
	return remote
}

// authEventsRetention cuánto se conserva la bitácora de seguridad.
const authEventsRetention = 180 * 24 * time.Hour

// StartAuthEventsPurgeLoop borra cada día los eventos de la bitácora de más de 180 días.
func StartAuthEventsPurgeLoop() {
	go func() {
		svc := NewAuthSecurityService()
		for {
			svc.PurgeOlderThan(authEventsRetention)
			Sessions().PurgeExpired()
			NewDeviceTrustService().PurgeOld()
			time.Sleep(24 * time.Hour)
		}
	}()
}
