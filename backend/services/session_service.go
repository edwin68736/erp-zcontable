package services

import (
	"sort"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/google/uuid"
)

// Sesiones del servidor: cada inicio de sesión crea una sesión y el token lleva su id (claim «sid»). Así se puede:
//   - cerrarla desde el servidor (cerrar sesión en otros equipos, desactivar a un usuario, cambio de contraseña);
//   - cerrarla sola tras 30 minutos SIN ACTIVIDAD de la persona. Solo cuenta lo que la persona hace de verdad (la
//     pantalla manda la cabecera X-Client-Active cuando hubo uso reciente); las consultas automáticas de la pantalla
//     (notificaciones, etc.) no mantienen viva la sesión;
//   - cerrarla a las 12 horas, pase lo que pase.

const (
	SessionIdleTimeout  = 30 * time.Minute
	SessionMaxLifetime  = 12 * time.Hour
	sessionCacheTTL     = 15 * time.Second
	sessionTouchEvery   = 30 * time.Second
	sessionDefaultReuse = 5 * time.Minute
	// ReauthWindow cuánto vale haber escrito la contraseña para las acciones sensibles (usuarios, roles, seguridad).
	ReauthWindow = sessionDefaultReuse
)

// Motivos con los que se cierra una sesión.
const (
	SessionRevokedLogout     = "cierre"
	SessionRevokedOthers     = "otros_equipos"
	SessionRevokedAdmin      = "administrador"
	SessionRevokedPassword   = "cambio_clave"
	SessionRevokedIdle       = "inactividad"
	SessionRevokedDeactivate = "usuario_desactivado"
)

// SessionState resultado de validar una sesión.
type SessionState int

const (
	SessionOK SessionState = iota
	SessionMissing
	SessionRevoked
	SessionExpired
	SessionIdle
)

type sessionEntry struct {
	userID       uint
	deviceID     uint
	expires      time.Time
	lastActive   time.Time
	dbLastActive time.Time // lo que hay guardado en la base (se escribe cada 30 s como máximo)
	revoked      bool
	reauthAt     *time.Time
	loadedAt     time.Time
}

type SessionService struct {
	mu    sync.Mutex
	cache map[string]*sessionEntry
	now   func() time.Time
}

func NewSessionService() *SessionService {
	return &SessionService{cache: map[string]*sessionEntry{}, now: time.Now}
}

var globalSessions = NewSessionService()

// Sessions instancia global.
func Sessions() *SessionService { return globalSessions }

// Create abre una sesión nueva para el usuario.
func (s *SessionService) Create(userID, deviceID uint, ip, userAgent string) (*models.UserSession, error) {
	now := s.now()
	sess := &models.UserSession{
		ID: uuid.NewString(), UserID: userID, DeviceID: deviceID, IP: truncateStr(ip, 64), UserAgent: truncateStr(userAgent, 255),
		CreatedAt: now, LastActiveAt: now, ExpiresAt: now.Add(SessionMaxLifetime), ReauthAt: &now,
	}
	if err := database.DB.Create(sess).Error; err != nil {
		return nil, err
	}
	return sess, nil
}

// load lee la sesión (de la memoria si es reciente; si no, de la base).
func (s *SessionService) load(sid string) *sessionEntry {
	now := s.now()
	s.mu.Lock()
	e, ok := s.cache[sid]
	s.mu.Unlock()
	if ok && now.Sub(e.loadedAt) < sessionCacheTTL {
		return e
	}
	var row models.UserSession
	if err := database.DB.First(&row, "id = ?", sid).Error; err != nil {
		s.mu.Lock()
		delete(s.cache, sid)
		s.mu.Unlock()
		return nil
	}
	ne := &sessionEntry{
		userID: row.UserID, deviceID: row.DeviceID, expires: row.ExpiresAt, lastActive: row.LastActiveAt, dbLastActive: row.LastActiveAt,
		revoked: row.RevokedAt != nil, reauthAt: row.ReauthAt, loadedAt: now,
	}
	if ok && e.lastActive.After(ne.lastActive) { // lo de la memoria puede ser más nuevo que lo guardado
		ne.lastActive = e.lastActive
	}
	s.mu.Lock()
	s.cache[sid] = ne
	s.mu.Unlock()
	return ne
}

// Check valida la sesión de un token. Si `active` es true la persona acaba de hacer algo: se renueva su inactividad.
func (s *SessionService) Check(sid string, userID uint, active bool) SessionState {
	if sid == "" {
		return SessionMissing
	}
	e := s.load(sid)
	if e == nil || e.userID != userID {
		return SessionMissing
	}
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case e.revoked:
		return SessionRevoked
	case now.After(e.expires):
		return SessionExpired
	case now.Sub(e.lastActive) > SessionIdleTimeout:
		e.revoked = true
		go s.persistRevoke(sid, SessionRevokedIdle)
		return SessionIdle
	}
	if active {
		e.lastActive = now
		if now.Sub(e.dbLastActive) >= sessionTouchEvery {
			e.dbLastActive = now
			go func(t time.Time) {
				database.DB.Model(&models.UserSession{}).Where("id = ?", sid).Update("last_active_at", t)
			}(now)
		}
	}
	return SessionOK
}

func (s *SessionService) persistRevoke(sid, reason string) {
	now := s.now()
	database.DB.Model(&models.UserSession{}).Where("id = ? AND revoked_at IS NULL", sid).
		Updates(map[string]any{"revoked_at": now, "revoked_reason": reason})
}

func (s *SessionService) forget(sid string) {
	s.mu.Lock()
	delete(s.cache, sid)
	s.mu.Unlock()
}

// Revoke cierra una sesión.
func (s *SessionService) Revoke(sid, reason string) {
	s.persistRevoke(sid, reason)
	s.forget(sid)
}

// RevokeUser cierra todas las sesiones abiertas de un usuario (menos `exceptSID`, si se indica) y devuelve cuántas.
func (s *SessionService) RevokeUser(userID uint, exceptSID, reason string) int64 {
	q := database.DB.Model(&models.UserSession{}).Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", userID, s.now())
	if exceptSID != "" {
		q = q.Where("id <> ?", exceptSID)
	}
	var ids []string
	q.Pluck("id", &ids)
	if len(ids) == 0 {
		return 0
	}
	now := s.now()
	database.DB.Model(&models.UserSession{}).Where("id IN ?", ids).Updates(map[string]any{"revoked_at": now, "revoked_reason": reason})
	for _, id := range ids {
		s.forget(id)
	}
	return int64(len(ids))
}

// ActiveSessions sesiones abiertas de un usuario (las que siguen vigentes), la más reciente primero.
func (s *SessionService) ActiveSessions(userID uint) ([]models.UserSession, error) {
	now := s.now()
	var rows []models.UserSession
	err := database.DB.Where("user_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_active_at > ?", userID, now, now.Add(-SessionIdleTimeout)).
		Find(&rows).Error
	sort.Slice(rows, func(i, j int) bool { return rows[i].LastActiveAt.After(rows[j].LastActiveAt) })
	return rows, err
}

// MarkReauth registra que la persona volvió a escribir su contraseña ahora.
func (s *SessionService) MarkReauth(sid string) {
	now := s.now()
	database.DB.Model(&models.UserSession{}).Where("id = ?", sid).Update("reauth_at", now)
	s.mu.Lock()
	if e, ok := s.cache[sid]; ok {
		e.reauthAt = &now
	}
	s.mu.Unlock()
}

// ReauthRecent true si la persona escribió su contraseña hace menos de `within` (o sesionDefaultReuse si es 0).
func (s *SessionService) ReauthRecent(sid string, within time.Duration) bool {
	if within <= 0 {
		within = sessionDefaultReuse
	}
	e := s.load(sid)
	if e == nil || e.reauthAt == nil {
		return false
	}
	return s.now().Sub(*e.reauthAt) <= within
}

// PurgeExpired borra sesiones viejas (vencidas o cerradas hace más de 30 días).
func (s *SessionService) PurgeExpired() int64 {
	cut := s.now().Add(-30 * 24 * time.Hour)
	res := database.DB.Where("expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)", cut, cut).Delete(&models.UserSession{})
	return res.RowsAffected
}

// ResetCache descarta lo recordado en memoria (se vuelve a leer de la base). Lo usan las pruebas.
func (s *SessionService) ResetCache() {
	s.mu.Lock()
	s.cache = map[string]*sessionEntry{}
	s.mu.Unlock()
}

// DeviceID dispositivo de confianza con el que se abrió la sesión (0 = ninguno).
func (s *SessionService) DeviceID(sid string) uint {
	if e := s.load(sid); e != nil {
		return e.deviceID
	}
	return 0
}
