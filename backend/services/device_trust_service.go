package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"crypto/sha256"
	"encoding/hex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Dispositivos de confianza y verificación en dos pasos del inicio de sesión.
//
// Idea: la contraseña sola no basta cuando se entra desde un equipo que el sistema no conoce. El equipo se reconoce por
// un identificador aleatorio que guarda el navegador (nunca se guarda en claro: solo su huella) y la confianza es POR
// USUARIO, de modo que un equipo compartido no le sirve a otra persona que sepa la contraseña de un compañero.
//
// Modos (se cambian en la Central de seguridad):
//   - off:     no se usan.
//   - learn:   periodo de gracia: se registran los equipos sin pedir nada, para que nadie se quede fuera al activarlo.
//   - enforce: un equipo nuevo pide un código de la app (TOTP), un código de recuperación o la aprobación de un
//     administrador. «enforce_from» permite programar el paso automático de learn a enforce.
//
// Un equipo de confianza deja de serlo a los N días sin usarse (30 por defecto; se renueva con cada uso, hasta 180
// días desde que se registró).

const (
	challengeTTL        = 10 * time.Minute
	approvalTTL         = 30 * time.Minute
	maxChallengeTries   = 5
	deviceTrustMaxLife  = 180 * 24 * time.Hour
	defaultTrustDays    = 30
	maxTrustDays        = 180
	deviceTokenMinChars = 32
	deviceTokenMaxChars = 128
)

var (
	ErrChallengeInvalid = errors.New("la verificación venció o ya no es válida: inicie sesión de nuevo")
	ErrChallengeNoTOTP  = errors.New("este usuario no tiene la verificación en dos pasos activada: pida la aprobación de un administrador")
	reDeviceToken       = regexp.MustCompile(`^[A-Za-z0-9_-]{32,128}$`)
)

// ChallengeBadCodeError código equivocado: dice cuántos intentos quedan.
type ChallengeBadCodeError struct{ Left int }

func (e *ChallengeBadCodeError) Error() string {
	if e.Left <= 0 {
		return "código incorrecto: se agotaron los intentos, inicie sesión de nuevo"
	}
	return fmt.Sprintf("código incorrecto (%d intento%s más)", e.Left, map[bool]string{true: "", false: "s"}[e.Left == 1])
}

type DeviceTrustService struct {
	now    func() time.Time
	events *AuthSecurityService
}

func NewDeviceTrustService() *DeviceTrustService {
	return &DeviceTrustService{now: time.Now, events: NewAuthSecurityService()}
}

// ───────────────────────────── Configuración ─────────────────────────────

// Settings la configuración vigente (se crea con valores por defecto la primera vez: modo «learn», 30 días).
func (s *DeviceTrustService) Settings() (*models.SecuritySetting, error) {
	var set models.SecuritySetting
	err := database.DB.First(&set).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		set = models.SecuritySetting{DeviceTrustMode: models.DeviceTrustLearn, DeviceTrustDays: defaultTrustDays}
		if err := database.DB.Create(&set).Error; err != nil {
			return nil, err
		}
		return &set, nil
	}
	if err != nil {
		return nil, err
	}
	if set.DeviceTrustDays <= 0 {
		set.DeviceTrustDays = defaultTrustDays
	}
	return &set, nil
}

// EffectiveMode el modo que rige ahora (si «learn» tiene fecha programada y ya llegó, rige «enforce»).
func (s *DeviceTrustService) EffectiveMode(set *models.SecuritySetting) string {
	if set.DeviceTrustMode == models.DeviceTrustLearn && set.EnforceFrom != nil && !s.now().Before(*set.EnforceFrom) {
		return models.DeviceTrustEnforce
	}
	return set.DeviceTrustMode
}

// UpdateSettings cambia la configuración.
func (s *DeviceTrustService) UpdateSettings(mode string, days int, enforceFrom *time.Time) (*models.SecuritySetting, error) {
	switch mode {
	case models.DeviceTrustOff, models.DeviceTrustLearn, models.DeviceTrustEnforce:
	default:
		return nil, errors.New("modo no válido")
	}
	if days < 1 || days > maxTrustDays {
		return nil, fmt.Errorf("los días de confianza deben estar entre 1 y %d", maxTrustDays)
	}
	set, err := s.Settings()
	if err != nil {
		return nil, err
	}
	set.DeviceTrustMode, set.DeviceTrustDays = mode, days
	if mode == models.DeviceTrustLearn {
		set.EnforceFrom = enforceFrom
	} else {
		set.EnforceFrom = nil
	}
	return set, database.DB.Save(set).Error
}

// ───────────────────────────── Identificador del equipo ─────────────────────────────

// ValidDeviceToken el identificador que genera el navegador: 32 a 128 caracteres seguros.
func ValidDeviceToken(t string) bool { return reDeviceToken.MatchString(t) }

// HashDeviceToken huella del identificador (lo único que se guarda).
func HashDeviceToken(t string) string {
	h := sha256.Sum256([]byte("zcontable-device-v1|" + t))
	return hex.EncodeToString(h[:])
}

// DescribeUserAgent «Chrome · Windows» para mostrar en pantalla.
func DescribeUserAgent(ua string) string {
	if strings.TrimSpace(ua) == "" {
		return "Navegador desconocido"
	}
	browser := "Navegador"
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	os := ""
	switch {
	case strings.Contains(ua, "Windows"):
		os = "Windows"
	case strings.Contains(ua, "Android"):
		os = "Android"
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"), strings.Contains(ua, "iOS"):
		os = "iOS"
	case strings.Contains(ua, "Mac OS"):
		os = "macOS"
	case strings.Contains(ua, "Linux"):
		os = "Linux"
	}
	if os == "" {
		return browser
	}
	return browser + " · " + os
}

// ───────────────────────────── Decisión al iniciar sesión ─────────────────────────────

// LoginDecision qué hacer después de una contraseña correcta.
type LoginDecision struct {
	Mode      string                 // modo vigente
	Device    *models.UserDevice     // equipo reconocido o registrado (nil si no hay)
	Challenge *models.LoginChallenge // si no es nil: hay que verificar antes de dar la sesión
	NewDevice bool                   // el equipo se registró ahora (modo learn)
}

// Decide decide si el equipo entra directo o necesita verificación. `remember` es la casilla «confiar en este equipo».
func (s *DeviceTrustService) Decide(user *models.User, deviceToken, userAgent, ip string, remember bool) (*LoginDecision, error) {
	set, err := s.Settings()
	if err != nil {
		return nil, err
	}
	mode := s.EffectiveMode(set)
	d := &LoginDecision{Mode: mode}
	if mode == models.DeviceTrustOff {
		return d, nil
	}
	now := s.now()
	hash := ""
	if ValidDeviceToken(deviceToken) {
		hash = HashDeviceToken(deviceToken)
	}

	var dev models.UserDevice
	found := hash != "" && database.DB.Where("user_id = ? AND token_hash = ? AND revoked_at IS NULL", user.ID, hash).First(&dev).Error == nil
	if found && dev.TrustedUntil != nil && dev.TrustedUntil.After(now) {
		s.touch(&dev, ip, set)
		d.Device = &dev
		return d, nil
	}

	if mode == models.DeviceTrustLearn {
		if hash == "" || !remember {
			return d, nil // sin identificador o sin pedir recordar: entra, pero no queda registrado
		}
		if found {
			dev.TrustedUntil = ptrTime(s.trustUntil(&dev, set))
			dev.LastSeenAt, dev.LastIP, dev.Via = now, truncateStr(ip, 64), models.DeviceViaLearn
			if err := database.DB.Save(&dev).Error; err != nil {
				return nil, err
			}
		} else {
			nd, err := s.register(user.ID, hash, userAgent, ip, models.DeviceViaLearn, set)
			if err != nil {
				return nil, err
			}
			dev, d.NewDevice = *nd, true
		}
		d.Device = &dev
		return d, nil
	}

	// enforce: equipo nuevo (o con la confianza vencida) → verificación.
	ch := &models.LoginChallenge{
		ID: uuid.NewString(), UserID: user.ID, DeviceHash: hash, DeviceLabel: DescribeUserAgent(userAgent), IP: truncateStr(ip, 64),
		UserAgent: truncateStr(userAgent, 255), Status: models.ChallengePending, Remember: remember, CreatedAt: now, ExpiresAt: now.Add(challengeTTL),
	}
	if err := database.DB.Create(ch).Error; err != nil {
		return nil, err
	}
	d.Challenge = ch
	return d, nil
}

func ptrTime(t time.Time) *time.Time { return &t }

// trustUntil hasta cuándo vale la confianza si se usa ahora: N días, sin pasar de 180 desde que se registró.
func (s *DeviceTrustService) trustUntil(dev *models.UserDevice, set *models.SecuritySetting) time.Time {
	until := s.now().Add(time.Duration(set.DeviceTrustDays) * 24 * time.Hour)
	if limit := dev.CreatedAt.Add(deviceTrustMaxLife); !dev.CreatedAt.IsZero() && until.After(limit) {
		return limit
	}
	return until
}

func (s *DeviceTrustService) register(userID uint, hash, userAgent, ip, via string, set *models.SecuritySetting) (*models.UserDevice, error) {
	now := s.now()
	dev := &models.UserDevice{
		UserID: userID, TokenHash: hash, Label: DescribeUserAgent(userAgent), UserAgent: truncateStr(userAgent, 255),
		FirstIP: truncateStr(ip, 64), LastIP: truncateStr(ip, 64), Via: via, CreatedAt: now, LastSeenAt: now,
	}
	dev.TrustedUntil = ptrTime(s.trustUntil(dev, set))
	if err := database.DB.Create(dev).Error; err != nil {
		return nil, err
	}
	return dev, nil
}

// touch anota el uso y renueva la confianza (a «ahora + N días»).
func (s *DeviceTrustService) touch(dev *models.UserDevice, ip string, set *models.SecuritySetting) {
	dev.LastSeenAt, dev.LastIP = s.now(), truncateStr(ip, 64)
	dev.TrustedUntil = ptrTime(s.trustUntil(dev, set))
	database.DB.Model(dev).Updates(map[string]any{"last_seen_at": dev.LastSeenAt, "last_ip": dev.LastIP, "trusted_until": dev.TrustedUntil})
}

// ───────────────────────────── Verificación del inicio de sesión ─────────────────────────────

func (s *DeviceTrustService) loadChallenge(id string) (*models.LoginChallenge, error) {
	var ch models.LoginChallenge
	if err := database.DB.First(&ch, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return nil, ErrChallengeInvalid
	}
	if ch.UsedAt != nil || ch.Status == models.ChallengeUsed || ch.Status == models.ChallengeDenied || !s.now().Before(ch.ExpiresAt) {
		return &ch, ErrChallengeInvalid
	}
	return &ch, nil
}

// Challenge la verificación pendiente (para mostrar el estado), validando que siga vigente.
func (s *DeviceTrustService) Challenge(id string) (*models.LoginChallenge, error) {
	return s.loadChallenge(id)
}

// ChallengeStatus estado visible para la pantalla de espera: «pendiente», «aprobada», «rechazada» o «vencida».
func (s *DeviceTrustService) ChallengeStatus(id string) string {
	var ch models.LoginChallenge
	if err := database.DB.First(&ch, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return "vencida"
	}
	switch {
	case ch.Status == models.ChallengeDenied:
		return models.ChallengeDenied
	case ch.UsedAt != nil || ch.Status == models.ChallengeUsed || !s.now().Before(ch.ExpiresAt):
		return "vencida"
	}
	return ch.Status
}

// VerifyCode comprueba el código de la app (o un código de recuperación). Si es correcto, la verificación queda usada
// y devuelve cómo se verificó. Los códigos equivocados se cuentan: a los 5 la verificación se anula.
func (s *DeviceTrustService) VerifyCode(challengeID, code string) (*models.LoginChallenge, string, error) {
	ch, err := s.loadChallenge(challengeID)
	if err != nil {
		return nil, "", err
	}
	if ch.Attempts >= maxChallengeTries {
		return nil, "", &ChallengeBadCodeError{Left: 0}
	}
	var t models.UserTOTP
	if err := database.DB.Where("user_id = ? AND enabled = ?", ch.UserID, true).First(&t).Error; err != nil {
		return nil, "", ErrChallengeNoTOTP
	}
	via := ""
	if secret, derr := openSecret(t.SecretEnc); derr == nil {
		if step, ok := TOTPVerify(secret, code, s.now(), t.LastStep); ok {
			database.DB.Model(&t).Update("last_step", step)
			via = models.DeviceViaTOTP
		}
	}
	if via == "" && s.consumeRecoveryCode(&t, code) {
		via = models.DeviceViaRecovery
	}
	if via == "" {
		ch.Attempts++
		database.DB.Model(ch).Update("attempts", ch.Attempts)
		return nil, "", &ChallengeBadCodeError{Left: maxChallengeTries - ch.Attempts}
	}
	now := s.now()
	database.DB.Model(ch).Updates(map[string]any{"status": models.ChallengeUsed, "used_at": now})
	return ch, via, nil
}

func (s *DeviceTrustService) consumeRecoveryCode(t *models.UserTOTP, code string) bool {
	c := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	if len(c) != 10 {
		return false
	}
	var hashes []string
	if json.Unmarshal([]byte(t.Recovery), &hashes) != nil {
		return false
	}
	want := hashRecoveryCode(code)
	for i, h := range hashes {
		if h == want {
			hashes = append(hashes[:i], hashes[i+1:]...)
			b, _ := json.Marshal(hashes)
			database.DB.Model(t).Update("recovery", string(b))
			return true
		}
	}
	return false
}

// RequestApproval la persona pide que un administrador apruebe el equipo (queda a la espera hasta 30 minutos).
func (s *DeviceTrustService) RequestApproval(challengeID string) (*models.LoginChallenge, error) {
	ch, err := s.loadChallenge(challengeID)
	if err != nil {
		return nil, err
	}
	if ch.ApprovalRequestedAt != nil {
		return ch, nil // ya estaba pedida
	}
	now := s.now()
	ch.ApprovalRequestedAt, ch.ExpiresAt = &now, now.Add(approvalTTL)
	return ch, database.DB.Model(ch).Updates(map[string]any{"approval_requested_at": now, "expires_at": ch.ExpiresAt}).Error
}

// PendingApproval una solicitud de aprobación a la espera, con los datos de la persona.
type PendingApproval struct {
	ID          string    `json:"id"`
	UserID      uint      `json:"user_id"`
	Username    string    `json:"username"`
	Name        string    `json:"name"`
	DeviceLabel string    `json:"device_label"`
	IP          string    `json:"ip"`
	RequestedAt time.Time `json:"requested_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// PendingApprovals solicitudes de aprobación vigentes (la más reciente primero).
func (s *DeviceTrustService) PendingApprovals() ([]PendingApproval, error) {
	var chs []models.LoginChallenge
	if err := database.DB.Where("status = ? AND approval_requested_at IS NOT NULL AND used_at IS NULL AND expires_at > ?", models.ChallengePending, s.now()).
		Order("approval_requested_at DESC").Find(&chs).Error; err != nil {
		return nil, err
	}
	out := make([]PendingApproval, 0, len(chs))
	for _, ch := range chs {
		var u models.User
		database.DB.Select("id", "name", "username").First(&u, ch.UserID)
		out = append(out, PendingApproval{ID: ch.ID, UserID: ch.UserID, Username: u.Username, Name: u.Name, DeviceLabel: ch.DeviceLabel, IP: ch.IP, RequestedAt: *ch.ApprovalRequestedAt, ExpiresAt: ch.ExpiresAt})
	}
	return out, nil
}

// DecideApproval un administrador aprueba o rechaza una solicitud.
func (s *DeviceTrustService) DecideApproval(challengeID string, adminID uint, approve bool) (*models.LoginChallenge, error) {
	ch, err := s.loadChallenge(challengeID)
	if err != nil {
		return nil, err
	}
	if ch.ApprovalRequestedAt == nil {
		return nil, errors.New("esa persona no pidió aprobación")
	}
	if ch.UserID == adminID {
		return nil, errors.New("no puede aprobar su propio equipo: lo debe hacer otro administrador")
	}
	status := models.ChallengeDenied
	if approve {
		status = models.ChallengeApproved
	}
	ch.Status, ch.DecidedBy = status, adminID
	return ch, database.DB.Model(ch).Updates(map[string]any{"status": status, "decided_by": adminID}).Error
}

// CompleteApproved la persona, tras la aprobación, termina de entrar: la verificación queda usada.
func (s *DeviceTrustService) CompleteApproved(challengeID string) (*models.LoginChallenge, error) {
	ch, err := s.loadChallenge(challengeID)
	if err != nil {
		return nil, err
	}
	if ch.Status != models.ChallengeApproved {
		return nil, errors.New("todavía no está aprobada")
	}
	database.DB.Model(ch).Updates(map[string]any{"status": models.ChallengeUsed, "used_at": s.now()})
	return ch, nil
}

// Trust deja el equipo de la verificación como de confianza (si la persona lo pidió y el identificador coincide).
// `deviceToken` es el que reenvía el navegador al terminar: debe ser el mismo con el que empezó.
func (s *DeviceTrustService) Trust(ch *models.LoginChallenge, deviceToken, via string) (*models.UserDevice, error) {
	if !ch.Remember || ch.DeviceHash == "" || !ValidDeviceToken(deviceToken) || HashDeviceToken(deviceToken) != ch.DeviceHash {
		return nil, nil
	}
	set, err := s.Settings()
	if err != nil {
		return nil, err
	}
	var dev models.UserDevice
	if database.DB.Where("user_id = ? AND token_hash = ?", ch.UserID, ch.DeviceHash).First(&dev).Error == nil {
		dev.RevokedAt, dev.Via, dev.LastSeenAt, dev.LastIP = nil, via, s.now(), ch.IP
		dev.TrustedUntil = ptrTime(s.trustUntil(&dev, set))
		return &dev, database.DB.Save(&dev).Error
	}
	return s.register(ch.UserID, ch.DeviceHash, ch.UserAgent, ch.IP, via, set)
}

// ───────────────────────────── Dispositivos ─────────────────────────────

// Devices equipos de un usuario que siguen registrados (el más reciente primero).
func (s *DeviceTrustService) Devices(userID uint) ([]models.UserDevice, error) {
	var rows []models.UserDevice
	err := database.DB.Where("user_id = ? AND revoked_at IS NULL", userID).Order("last_seen_at DESC").Find(&rows).Error
	return rows, err
}

// RevokeDevice quita un equipo (y cierra las sesiones abiertas desde él). Si `userID` no es 0, solo si es de ese usuario.
func (s *DeviceTrustService) RevokeDevice(deviceID, userID uint) (*models.UserDevice, error) {
	var dev models.UserDevice
	q := database.DB.Where("id = ? AND revoked_at IS NULL", deviceID)
	if userID != 0 {
		q = q.Where("user_id = ?", userID)
	}
	if err := q.First(&dev).Error; err != nil {
		return nil, errors.New("dispositivo no encontrado")
	}
	now := s.now()
	database.DB.Model(&dev).Updates(map[string]any{"revoked_at": now, "trusted_until": nil})
	var sids []string
	database.DB.Model(&models.UserSession{}).Where("device_id = ? AND revoked_at IS NULL", dev.ID).Pluck("id", &sids)
	for _, sid := range sids {
		Sessions().Revoke(sid, SessionRevokedAdmin)
	}
	return &dev, nil
}

// RevokeAllDevices quita todos los equipos de un usuario y cierra sus sesiones.
func (s *DeviceTrustService) RevokeAllDevices(userID uint) int64 {
	var ids []uint
	database.DB.Model(&models.UserDevice{}).Where("user_id = ? AND revoked_at IS NULL", userID).Pluck("id", &ids)
	for _, id := range ids {
		_, _ = s.RevokeDevice(id, userID)
	}
	return int64(len(ids))
}

// ───────────────────────────── Verificación en dos pasos (TOTP) ─────────────────────────────

// TOTPInfo estado de la verificación en dos pasos de un usuario.
type TOTPInfo struct {
	Enabled           bool       `json:"enabled"`
	EnabledAt         *time.Time `json:"enabled_at,omitempty"`
	RecoveryCodesLeft int        `json:"recovery_codes_left"`
}

func (s *DeviceTrustService) TOTPStatus(userID uint) TOTPInfo {
	var t models.UserTOTP
	if database.DB.Where("user_id = ? AND enabled = ?", userID, true).First(&t).Error != nil {
		return TOTPInfo{}
	}
	var hashes []string
	_ = json.Unmarshal([]byte(t.Recovery), &hashes)
	return TOTPInfo{Enabled: true, EnabledAt: t.EnabledAt, RecoveryCodesLeft: len(hashes)}
}

// TOTPSetup empieza la configuración: genera un secreto nuevo (todavía sin activar) para mostrar en el QR.
func (s *DeviceTrustService) TOTPSetup(userID uint, account string) (secret, uri string, err error) {
	if s.TOTPStatus(userID).Enabled {
		return "", "", errors.New("la verificación en dos pasos ya está activada: desactívela primero para configurarla de nuevo")
	}
	secret = NewTOTPSecret()
	sealed, err := sealSecret(secret)
	if err != nil {
		return "", "", err
	}
	var t models.UserTOTP
	if database.DB.Where("user_id = ?", userID).First(&t).Error == nil {
		err = database.DB.Model(&t).Updates(map[string]any{"secret_enc": sealed, "enabled": false, "last_step": 0}).Error
	} else {
		err = database.DB.Create(&models.UserTOTP{UserID: userID, SecretEnc: sealed}).Error
	}
	if err != nil {
		return "", "", err
	}
	return secret, TOTPURI("ZContable", account, secret), nil
}

// TOTPEnable activa la verificación con un código válido de la app y devuelve los códigos de recuperación (en claro,
// una sola vez).
func (s *DeviceTrustService) TOTPEnable(userID uint, code string) ([]string, error) {
	var t models.UserTOTP
	if err := database.DB.Where("user_id = ? AND enabled = ?", userID, false).First(&t).Error; err != nil {
		return nil, errors.New("primero genere el código QR")
	}
	secret, err := openSecret(t.SecretEnc)
	if err != nil {
		return nil, err
	}
	step, ok := TOTPVerify(secret, code, s.now(), 0)
	if !ok {
		return nil, errors.New("el código no es correcto: revise la hora del celular e intente con el siguiente")
	}
	plain, hashes := NewRecoveryCodes()
	b, _ := json.Marshal(hashes)
	now := s.now()
	err = database.DB.Model(&t).Updates(map[string]any{"enabled": true, "enabled_at": now, "last_step": step, "recovery": string(b)}).Error
	return plain, err
}

// TOTPDisable desactiva la verificación en dos pasos de un usuario.
func (s *DeviceTrustService) TOTPDisable(userID uint) error {
	return database.DB.Where("user_id = ?", userID).Delete(&models.UserTOTP{}).Error
}

// ResetUser un administrador deja a la persona «como nueva»: sin verificación en dos pasos, sin equipos de confianza y
// sin sesiones abiertas (por ejemplo, si perdió el celular).
func (s *DeviceTrustService) ResetUser(userID uint) {
	_ = s.TOTPDisable(userID)
	s.RevokeAllDevices(userID)
	Sessions().RevokeUser(userID, "", SessionRevokedAdmin)
}

// PurgeOld borra verificaciones y equipos viejos.
func (s *DeviceTrustService) PurgeOld() {
	database.DB.Where("expires_at < ?", s.now().Add(-24*time.Hour)).Delete(&models.LoginChallenge{})
	database.DB.Where("revoked_at IS NOT NULL AND revoked_at < ?", s.now().Add(-90*24*time.Hour)).Delete(&models.UserDevice{})
}
