package controllers

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// DeviceController dispositivos de confianza, verificación en dos pasos (TOTP) y aprobaciones del administrador.
// Ver services/device_trust_service.go para el diseño completo.
type DeviceController struct {
	authService *services.AuthService
	devices     *services.DeviceTrustService
	security    *services.AuthSecurityService
}

func NewDeviceController() *DeviceController {
	return &DeviceController{authService: services.NewAuthService(), devices: services.NewDeviceTrustService(), security: services.NewAuthSecurityService()}
}

func fail(c fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

// loginResponse la respuesta de un inicio de sesión completo (igual que la del login normal).
func (ctrl *DeviceController) loginResponse(c fiber.Ctx, user *models.User, dev *models.UserDevice) error {
	var deviceID uint
	if dev != nil {
		deviceID = dev.ID
	}
	ip, ua := clientIP(c), c.Get("User-Agent")
	token, _, err := ctrl.authService.IssueSession(user, deviceID, ip, ua)
	if err != nil {
		return fail(c, fiber.StatusInternalServerError, "Error generando token")
	}
	services.Authz().InvalidateUser(user.ID)
	ctrl.security.Record(models.AuthEventLoginOK, user.ID, user.Username, ip, ua, "")
	return c.JSON(fiber.Map{
		"token":                token,
		"must_change_password": user.MustChangePassword,
		"user":                 fiber.Map{"id": user.ID, "name": user.Name, "username": user.Username, "email": user.EmailString()},
	})
}

// challengeResponse lo que recibe la pantalla cuando el equipo es nuevo y hay que verificar.
func (ctrl *DeviceController) challengeResponse(c fiber.Ctx, ch *models.LoginChallenge) error {
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
		"status":       "verification_required",
		"challenge_id": ch.ID,
		"device_label": ch.DeviceLabel,
		"expires_at":   ch.ExpiresAt,
		"methods":      fiber.Map{"totp": ctrl.devices.TOTPStatus(ch.UserID).Enabled, "approval": true},
	})
}

func (ctrl *DeviceController) userOf(ch *models.LoginChallenge) (*models.User, error) {
	return ctrl.authService.GetUserByID(ch.UserID)
}

// guard bloquea si el usuario o la IP tienen demasiados fallos recientes.
func (ctrl *DeviceController) guard(c fiber.Ctx, ch *models.LoginChallenge, username string) error {
	if wait, locked := ctrl.security.Locked(username, clientIP(c)); locked {
		ctrl.security.Record(models.AuthEventLoginBlocked, ch.UserID, username, clientIP(c), c.Get("User-Agent"), "bloqueo por intentos fallidos (verificación)")
		c.Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		return fail(c, fiber.StatusTooManyRequests, "Demasiados intentos fallidos. Intente de nuevo más tarde.")
	}
	return nil
}

// ───────────────────────────── Públicas: terminar un inicio de sesión ─────────────────────────────

// VerifyAPI POST /login/verify — {"challenge_id","code","device_token"}: el código de la app o uno de recuperación.
func (ctrl *DeviceController) VerifyAPI(c fiber.Ctx) error {
	var body struct {
		ChallengeID string `json:"challenge_id"`
		Code        string `json:"code"`
		DeviceToken string `json:"device_token"`
	}
	if err := c.Bind().Body(&body); err != nil || body.ChallengeID == "" || strings.TrimSpace(body.Code) == "" {
		return fail(c, fiber.StatusBadRequest, "Indique el código")
	}
	ch, err := ctrl.devices.Challenge(body.ChallengeID)
	if err != nil {
		return fail(c, fiber.StatusUnauthorized, err.Error())
	}
	user, err := ctrl.userOf(ch)
	if err != nil || !user.Active {
		return fail(c, fiber.StatusUnauthorized, services.ErrChallengeInvalid.Error())
	}
	if blocked := ctrl.guard(c, ch, user.Username); blocked != nil {
		return blocked
	}
	ch, via, err := ctrl.devices.VerifyCode(body.ChallengeID, body.Code)
	if err != nil {
		var bad *services.ChallengeBadCodeError
		if errors.As(err, &bad) {
			// Cada código equivocado cuenta como intento fallido de inicio de sesión (bloqueo por usuario e IP).
			ctrl.security.Record(models.AuthEventLoginFail, user.ID, user.Username, clientIP(c), c.Get("User-Agent"), "código de verificación incorrecto")
		}
		return fail(c, fiber.StatusUnauthorized, err.Error())
	}
	dev, _ := ctrl.devices.Trust(ch, body.DeviceToken, via)
	ctrl.security.Record(models.AuthEventDeviceVerified, user.ID, user.Username, clientIP(c), c.Get("User-Agent"), "verificado con "+via)
	return ctrl.loginResponse(c, user, dev)
}

// RequestApprovalAPI POST /login/approval — {"challenge_id"}: pide que un administrador apruebe el equipo.
func (ctrl *DeviceController) RequestApprovalAPI(c fiber.Ctx) error {
	var body struct {
		ChallengeID string `json:"challenge_id"`
	}
	if err := c.Bind().Body(&body); err != nil || body.ChallengeID == "" {
		return fail(c, fiber.StatusBadRequest, "Datos inválidos")
	}
	ch, err := ctrl.devices.RequestApproval(body.ChallengeID)
	if err != nil {
		return fail(c, fiber.StatusUnauthorized, err.Error())
	}
	user, err := ctrl.userOf(ch)
	if err == nil {
		ctrl.security.Record(models.AuthEventApprovalRequested, user.ID, user.Username, clientIP(c), c.Get("User-Agent"), "equipo: "+ch.DeviceLabel)
	}
	return c.JSON(fiber.Map{"status": ctrl.devices.ChallengeStatus(ch.ID), "expires_at": ch.ExpiresAt})
}

// ChallengeStatusAPI GET /login/challenge/:id — la pantalla de espera pregunta si ya aprobaron.
func (ctrl *DeviceController) ChallengeStatusAPI(c fiber.Ctx) error {
	return c.JSON(fiber.Map{"status": ctrl.devices.ChallengeStatus(c.Params("id"))})
}

// CompleteAPI POST /login/complete — {"challenge_id","device_token"}: tras la aprobación, la persona termina de entrar.
func (ctrl *DeviceController) CompleteAPI(c fiber.Ctx) error {
	var body struct {
		ChallengeID string `json:"challenge_id"`
		DeviceToken string `json:"device_token"`
	}
	if err := c.Bind().Body(&body); err != nil || body.ChallengeID == "" {
		return fail(c, fiber.StatusBadRequest, "Datos inválidos")
	}
	ch, err := ctrl.devices.Challenge(body.ChallengeID)
	if err != nil {
		return fail(c, fiber.StatusUnauthorized, err.Error())
	}
	user, err := ctrl.userOf(ch)
	if err != nil || !user.Active {
		return fail(c, fiber.StatusUnauthorized, services.ErrChallengeInvalid.Error())
	}
	if blocked := ctrl.guard(c, ch, user.Username); blocked != nil {
		return blocked
	}
	ch, err = ctrl.devices.CompleteApproved(body.ChallengeID)
	if err != nil {
		return fail(c, fiber.StatusConflict, err.Error())
	}
	dev, _ := ctrl.devices.Trust(ch, body.DeviceToken, models.DeviceViaApproval)
	ctrl.security.Record(models.AuthEventDeviceVerified, user.ID, user.Username, clientIP(c), c.Get("User-Agent"), "verificado con aprobación del administrador")
	return ctrl.loginResponse(c, user, dev)
}

// ───────────────────────────── Mi cuenta ─────────────────────────────

func (ctrl *DeviceController) me(c fiber.Ctx) (uint, string, error) {
	uid, err := getUserID(c)
	if err != nil {
		return 0, "", fail(c, fiber.StatusUnauthorized, "No autenticado")
	}
	username, _ := c.Locals("user_username").(string)
	return uid, username, nil
}

// MyDevicesAPI GET /me/devices
func (ctrl *DeviceController) MyDevicesAPI(c fiber.Ctx) error {
	uid, _, err := ctrl.me(c)
	if err != nil {
		return err
	}
	rows, err := ctrl.devices.Devices(uid)
	if err != nil {
		return fail(c, fiber.StatusInternalServerError, "No se pudieron leer los dispositivos")
	}
	cur, _ := c.Locals("device_id").(uint)
	type item struct {
		models.UserDevice
		Current bool `json:"current"`
	}
	out := make([]item, 0, len(rows))
	for _, r := range rows {
		out = append(out, item{UserDevice: r, Current: cur != 0 && r.ID == cur})
	}
	return c.JSON(fiber.Map{"data": out})
}

// RevokeMyDeviceAPI DELETE /me/devices/:id
func (ctrl *DeviceController) RevokeMyDeviceAPI(c fiber.Ctx) error {
	uid, username, err := ctrl.me(c)
	if err != nil {
		return err
	}
	id, _ := strconv.ParseUint(c.Params("id"), 10, 32)
	dev, rerr := ctrl.devices.RevokeDevice(uint(id), uid)
	if rerr != nil {
		return fail(c, fiber.StatusNotFound, rerr.Error())
	}
	ctrl.security.Record(models.AuthEventDeviceRevoked, uid, username, clientIP(c), c.Get("User-Agent"), "equipo: "+dev.Label)
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// MyTOTPAPI GET /me/totp
func (ctrl *DeviceController) MyTOTPAPI(c fiber.Ctx) error {
	uid, _, err := ctrl.me(c)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": ctrl.devices.TOTPStatus(uid)})
}

// TOTPSetupAPI POST /me/totp/setup — genera el secreto y la dirección para el código QR (todavía sin activar).
func (ctrl *DeviceController) TOTPSetupAPI(c fiber.Ctx) error {
	uid, username, err := ctrl.me(c)
	if err != nil {
		return err
	}
	secret, uri, serr := ctrl.devices.TOTPSetup(uid, username)
	if serr != nil {
		return fail(c, fiber.StatusBadRequest, serr.Error())
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"secret": secret, "uri": uri}})
}

// TOTPEnableAPI POST /me/totp/enable — {"code"}: activa con un código de la app y entrega los códigos de recuperación.
func (ctrl *DeviceController) TOTPEnableAPI(c fiber.Ctx) error {
	uid, username, err := ctrl.me(c)
	if err != nil {
		return err
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := c.Bind().Body(&body); err != nil || strings.TrimSpace(body.Code) == "" {
		return fail(c, fiber.StatusBadRequest, "Indique el código de la app")
	}
	codes, eerr := ctrl.devices.TOTPEnable(uid, body.Code)
	if eerr != nil {
		return fail(c, fiber.StatusBadRequest, eerr.Error())
	}
	ctrl.security.Record(models.AuthEventTOTPEnabled, uid, username, clientIP(c), c.Get("User-Agent"), "")
	return c.JSON(fiber.Map{"data": fiber.Map{"recovery_codes": codes}})
}

// TOTPDisableAPI POST /me/totp/disable — {"password"}: pide la contraseña para quitarla.
func (ctrl *DeviceController) TOTPDisableAPI(c fiber.Ctx) error {
	uid, username, err := ctrl.me(c)
	if err != nil {
		return err
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := c.Bind().Body(&body); err != nil || body.Password == "" {
		return fail(c, fiber.StatusBadRequest, "Escriba su contraseña para desactivarla")
	}
	user, gerr := ctrl.authService.GetUserByID(uid)
	if gerr != nil || !user.CheckPassword(body.Password) {
		ctrl.security.Record(models.AuthEventLoginFail, uid, username, clientIP(c), c.Get("User-Agent"), "desactivar verificación: contraseña incorrecta")
		return fail(c, fiber.StatusBadRequest, "La contraseña no es correcta")
	}
	if derr := ctrl.devices.TOTPDisable(uid); derr != nil {
		return fail(c, fiber.StatusInternalServerError, "No se pudo desactivar")
	}
	ctrl.security.Record(models.AuthEventTOTPDisabled, uid, username, clientIP(c), c.Get("User-Agent"), "")
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// ───────────────────────────── Administrador ─────────────────────────────

// PendingApprovalsAPI GET /security/approvals
func (ctrl *DeviceController) PendingApprovalsAPI(c fiber.Ctx) error {
	rows, err := ctrl.devices.PendingApprovals()
	if err != nil {
		return fail(c, fiber.StatusInternalServerError, "No se pudieron leer las solicitudes")
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *DeviceController) decide(c fiber.Ctx, approve bool) error {
	admin, _ := getUserID(c)
	ch, err := ctrl.devices.DecideApproval(c.Params("id"), admin, approve)
	if err != nil {
		return fail(c, fiber.StatusBadRequest, err.Error())
	}
	typ, verb := models.AuthEventDeviceDenied, "rechazó"
	if approve {
		typ, verb = models.AuthEventDeviceApproved, "aprobó"
	}
	if user, uerr := ctrl.userOf(ch); uerr == nil {
		ctrl.security.Record(typ, user.ID, user.Username, clientIP(c), c.Get("User-Agent"), fmt.Sprintf("el usuario #%d %s el equipo %s", admin, verb, ch.DeviceLabel))
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"status": ch.Status}})
}

// ApproveAPI POST /security/approvals/:id/approve
func (ctrl *DeviceController) ApproveAPI(c fiber.Ctx) error { return ctrl.decide(c, true) }

// DenyAPI POST /security/approvals/:id/deny
func (ctrl *DeviceController) DenyAPI(c fiber.Ctx) error { return ctrl.decide(c, false) }

// UserDevicesAPI GET /security/users/:id/devices
func (ctrl *DeviceController) UserDevicesAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return fail(c, fiber.StatusBadRequest, "ID inválido")
	}
	rows, derr := ctrl.devices.Devices(uint(id))
	if derr != nil {
		return fail(c, fiber.StatusInternalServerError, "No se pudieron leer los dispositivos")
	}
	return c.JSON(fiber.Map{"data": rows, "totp": ctrl.devices.TOTPStatus(uint(id))})
}

// RevokeDeviceAPI DELETE /security/devices/:id
func (ctrl *DeviceController) RevokeDeviceAPI(c fiber.Ctx) error {
	id, _ := strconv.ParseUint(c.Params("id"), 10, 32)
	dev, err := ctrl.devices.RevokeDevice(uint(id), 0)
	if err != nil {
		return fail(c, fiber.StatusNotFound, err.Error())
	}
	admin, _ := getUserID(c)
	ctrl.security.Record(models.AuthEventDeviceRevoked, dev.UserID, "", clientIP(c), c.Get("User-Agent"), fmt.Sprintf("el usuario #%d quitó el equipo %s", admin, dev.Label))
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// ResetUserAPI POST /security/users/:id/reset — sin verificación en dos pasos, sin equipos y sin sesiones.
func (ctrl *DeviceController) ResetUserAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || id == 0 {
		return fail(c, fiber.StatusBadRequest, "ID inválido")
	}
	ctrl.devices.ResetUser(uint(id))
	admin, _ := getUserID(c)
	ctrl.security.Record(models.AuthEventTOTPReset, uint(id), "", clientIP(c), c.Get("User-Agent"), fmt.Sprintf("el usuario #%d lo dejó sin verificación en dos pasos, equipos ni sesiones", admin))
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

// SettingsAPI GET /security/settings
func (ctrl *DeviceController) SettingsAPI(c fiber.Ctx) error {
	set, err := ctrl.devices.Settings()
	if err != nil {
		return fail(c, fiber.StatusInternalServerError, "No se pudo leer la configuración")
	}
	return c.JSON(fiber.Map{"data": fiber.Map{
		"device_trust_mode": set.DeviceTrustMode, "device_trust_days": set.DeviceTrustDays, "enforce_from": set.EnforceFrom,
		"effective_mode": ctrl.devices.EffectiveMode(set),
	}})
}

// UpdateSettingsAPI PUT /security/settings — {"device_trust_mode","device_trust_days","enforce_from":"AAAA-MM-DD"|""}.
func (ctrl *DeviceController) UpdateSettingsAPI(c fiber.Ctx) error {
	var body struct {
		Mode        string `json:"device_trust_mode"`
		Days        int    `json:"device_trust_days"`
		EnforceFrom string `json:"enforce_from"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return fail(c, fiber.StatusBadRequest, "Datos inválidos")
	}
	var from *time.Time
	if s := strings.TrimSpace(body.EnforceFrom); s != "" {
		t, err := time.ParseInLocation("2006-01-02", s, time.Local)
		if err != nil {
			return fail(c, fiber.StatusBadRequest, "La fecha debe tener el formato AAAA-MM-DD")
		}
		from = &t
	}
	set, err := ctrl.devices.UpdateSettings(body.Mode, body.Days, from)
	if err != nil {
		return fail(c, fiber.StatusBadRequest, err.Error())
	}
	admin, _ := getUserID(c)
	ctrl.security.Record(models.AuthEventSettingsChanged, admin, "", clientIP(c), c.Get("User-Agent"),
		fmt.Sprintf("modo %s, %d días", set.DeviceTrustMode, set.DeviceTrustDays))
	return ctrl.SettingsAPI(c)
}
