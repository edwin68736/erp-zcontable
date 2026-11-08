package controllers

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type AuthController struct {
	authService *services.AuthService
	security    *services.AuthSecurityService
	devices     *services.DeviceTrustService
}

func NewAuthController() *AuthController {
	return &AuthController{authService: services.NewAuthService(), security: services.NewAuthSecurityService(), devices: services.NewDeviceTrustService()}
}

// clientIP la IP real del cliente (detrás de Traefik).
func clientIP(c fiber.Ctx) string {
	return services.ClientIP(c.IP(), c.Get("X-Forwarded-For"))
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	// DeviceToken identificador aleatorio que guarda el navegador (el sistema solo guarda su huella).
	DeviceToken string `json:"device_token"`
	// Remember «confiar en este equipo» (por defecto sí).
	Remember *bool `json:"remember"`
}

func (ctrl *AuthController) LoginAPI(c fiber.Ctx) error {
	var req LoginRequest
	if err := c.Bind().Body(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Usuario y contraseña son requeridos"})
	}
	ip, ua := clientIP(c), c.Get("User-Agent")

	// Demasiados fallos recientes (de ese usuario o de esa IP): no se prueba ni la contraseña.
	if wait, locked := ctrl.security.Locked(req.Username, ip); locked {
		ctrl.security.Record(models.AuthEventLoginBlocked, 0, req.Username, ip, ua, "bloqueo por intentos fallidos")
		mins := int((wait + time.Minute - 1) / time.Minute)
		c.Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"error":       fmt.Sprintf("Demasiados intentos fallidos. Intente de nuevo en %d minuto%s.", mins, map[bool]string{true: "", false: "s"}[mins == 1]),
			"retry_after": int(wait.Seconds()) + 1,
		})
	}

	user, reason, err := ctrl.authService.LoginDetailed(req.Username, req.Password)
	if err != nil {
		var uid uint
		if user != nil {
			uid = user.ID
		}
		if reason == "" {
			// Error interno (no del usuario): no cuenta como intento fallido.
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo iniciar sesión. Intente de nuevo."})
		}
		ctrl.security.Record(models.AuthEventLoginFail, uid, req.Username, ip, ua, reason)
		// La respuesta es siempre la misma: no se revela si el usuario existe, está inactivo o falló la contraseña.
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": services.ErrInvalidCredentials.Error()})
	}
	services.Authz().InvalidateUser(user.ID)

	// ¿Es un equipo conocido? Si es nuevo y el estudio lo exige, falta verificar antes de dar la sesión.
	remember := req.Remember == nil || *req.Remember
	decision, derr := ctrl.devices.Decide(user, req.DeviceToken, ua, ip, remember)
	if derr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo iniciar sesión. Intente de nuevo."})
	}
	if ch := decision.Challenge; ch != nil {
		ctrl.security.Record(models.AuthEventDeviceChallenge, user.ID, user.Username, ip, ua, "equipo nuevo: "+ch.DeviceLabel)
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
			"status":       "verification_required",
			"challenge_id": ch.ID,
			"device_label": ch.DeviceLabel,
			"expires_at":   ch.ExpiresAt,
			"methods":      fiber.Map{"totp": ctrl.devices.TOTPStatus(user.ID).Enabled, "approval": true},
		})
	}
	var deviceID uint
	if decision.Device != nil {
		deviceID = decision.Device.ID
	}
	if decision.NewDevice {
		ctrl.security.Record(models.AuthEventDeviceNew, user.ID, user.Username, ip, ua, "equipo registrado: "+decision.Device.Label)
	}

	token, _, err := ctrl.authService.IssueSession(user, deviceID, ip, ua)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error generando token"})
	}
	ctrl.security.Record(models.AuthEventLoginOK, user.ID, user.Username, ip, ua, "")

	return c.JSON(fiber.Map{
		"token":                token,
		"must_change_password": user.MustChangePassword,
		"user": fiber.Map{
			"id":       user.ID,
			"name":     user.Name,
			"username": user.Username,
			"email":    user.EmailString(),
		},
	})
}

// ChangePasswordAPI POST /me/password — {"current_password":"…","new_password":"…"}
// El usuario cambia su propia contraseña: exige la actual y cumplir la política (mínimo 6 caracteres, no común, no
// filtrada). Los fallos repetidos se registran en la bitácora de seguridad.
func (ctrl *AuthController) ChangePasswordAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	var body struct {
		Current string `json:"current_password"`
		Next    string `json:"new_password"`
	}
	if err := c.Bind().Body(&body); err != nil || body.Current == "" || body.Next == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Indique la contraseña actual y la nueva"})
	}
	username, _ := c.Locals("user_username").(string)
	ip, ua := clientIP(c), c.Get("User-Agent")
	// Quien ya tiene una sesión también puede ser alguien que la tomó prestada: se limita adivinar la contraseña actual.
	if _, locked := ctrl.security.Locked(username, ip); locked {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "Demasiados intentos fallidos. Intente de nuevo más tarde."})
	}
	if err := ctrl.authService.ChangeOwnPassword(uid, body.Current, body.Next); err != nil {
		if strings.Contains(err.Error(), "actual no es correcta") {
			ctrl.security.Record(models.AuthEventPasswordChangeX, uid, username, ip, ua, "contraseña actual incorrecta")
			// Cuenta como intento fallido de inicio de sesión: protege la contraseña actual de ser adivinada.
			ctrl.security.Record(models.AuthEventLoginFail, uid, username, ip, ua, "cambio de contraseña: actual incorrecta")
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	ctrl.security.Record(models.AuthEventPasswordChange, uid, username, ip, ua, "")
	services.Authz().InvalidateUser(uid)
	if sid, _ := c.Locals("session_id").(string); sid != "" {
		services.Sessions().MarkReauth(sid) // acaba de escribir la contraseña
	}
	// Si alguien más tenía la contraseña anterior, sus sesiones dejan de valer; la de quien la cambió sigue.
	current, _ := c.Locals("session_id").(string)
	services.Sessions().RevokeUser(uid, current, services.SessionRevokedPassword)
	return c.JSON(fiber.Map{"message": "Contraseña actualizada"})
}

// ReauthAPI POST /me/reauth — {"password"}: la persona vuelve a escribir su contraseña para poder hacer acciones sensibles
// durante unos minutos. Los errores cuentan como intentos fallidos de inicio de sesión (bloqueo por usuario e IP).
func (ctrl *AuthController) ReauthAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := c.Bind().Body(&body); err != nil || body.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Escriba su contraseña"})
	}
	username, _ := c.Locals("user_username").(string)
	ip, ua := clientIP(c), c.Get("User-Agent")
	if wait, locked := ctrl.security.Locked(username, ip); locked {
		c.Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "Demasiados intentos fallidos. Intente de nuevo más tarde."})
	}
	user, gerr := ctrl.authService.GetUserByID(uid)
	if gerr != nil || !user.Active || !user.CheckPassword(body.Password) {
		ctrl.security.Record(models.AuthEventLoginFail, uid, username, ip, ua, "confirmación de contraseña incorrecta")
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "La contraseña no es correcta"})
	}
	sid, _ := c.Locals("session_id").(string)
	services.Sessions().MarkReauth(sid)
	return c.JSON(fiber.Map{"data": fiber.Map{"valid_seconds": int(services.ReauthWindow.Seconds())}})
}

// SecurityEventsAPI GET /security/events?type=&username=&ip=&from=AAAA-MM-DD&to=AAAA-MM-DD&page=&per_page=
// Bitácora de seguridad (solo con el permiso de verla).
func (ctrl *AuthController) SecurityEventsAPI(c fiber.Ctx) error {
	f := services.AuthEventFilter{Type: c.Query("type"), Username: c.Query("username"), IP: c.Query("ip")}
	f.Page, _ = strconv.Atoi(c.Query("page"))
	f.PerPage, _ = strconv.Atoi(c.Query("per_page"))
	if t, err := time.ParseInLocation("2006-01-02", c.Query("from"), time.Local); err == nil {
		f.From = &t
	}
	if t, err := time.ParseInLocation("2006-01-02", c.Query("to"), time.Local); err == nil {
		end := t.AddDate(0, 0, 1)
		f.To = &end
	}
	page, err := ctrl.security.List(f)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo leer la bitácora"})
	}
	return c.JSON(fiber.Map{"data": page})
}

func (ctrl *AuthController) LogoutAPI(c fiber.Ctx) error {
	// Se cierra la sesión en el servidor: el token deja de servir aunque alguien lo hubiera copiado.
	if sid, _ := c.Locals("session_id").(string); sid != "" {
		services.Sessions().Revoke(sid, services.SessionRevokedLogout)
		uid, _ := getUserID(c)
		username, _ := c.Locals("user_username").(string)
		ctrl.security.Record(models.AuthEventLogout, uid, username, clientIP(c), c.Get("User-Agent"), "")
	}
	return c.JSON(fiber.Map{"message": "Sesión cerrada"})
}

// MySessionsAPI GET /me/sessions — las sesiones abiertas del propio usuario (la actual va marcada).
func (ctrl *AuthController) MySessionsAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	rows, err := services.Sessions().ActiveSessions(uid)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudieron leer las sesiones"})
	}
	current, _ := c.Locals("session_id").(string)
	type item struct {
		ID           string    `json:"id"`
		IP           string    `json:"ip"`
		UserAgent    string    `json:"user_agent"`
		CreatedAt    time.Time `json:"created_at"`
		LastActiveAt time.Time `json:"last_active_at"`
		Current      bool      `json:"current"`
	}
	out := make([]item, 0, len(rows))
	for _, r := range rows {
		out = append(out, item{ID: r.ID, IP: r.IP, UserAgent: r.UserAgent, CreatedAt: r.CreatedAt, LastActiveAt: r.LastActiveAt, Current: r.ID == current})
	}
	return c.JSON(fiber.Map{"data": out})
}

// RevokeOtherSessionsAPI POST /me/sessions/revoke-others — cierra la sesión en todos los demás equipos.
func (ctrl *AuthController) RevokeOtherSessionsAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	current, _ := c.Locals("session_id").(string)
	n := services.Sessions().RevokeUser(uid, current, services.SessionRevokedOthers)
	username, _ := c.Locals("user_username").(string)
	ctrl.security.Record(models.AuthEventSessionRevoked, uid, username, clientIP(c), c.Get("User-Agent"), fmt.Sprintf("cerró %d sesión(es) en otros equipos", n))
	return c.JSON(fiber.Map{"data": fiber.Map{"closed": n}})
}

// RevokeSessionAPI DELETE /me/sessions/:id — cierra una sesión propia concreta.
func (ctrl *AuthController) RevokeSessionAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	id := c.Params("id")
	rows, _ := services.Sessions().ActiveSessions(uid)
	for _, r := range rows {
		if r.ID == id {
			services.Sessions().Revoke(id, services.SessionRevokedOthers)
			return c.JSON(fiber.Map{"data": fiber.Map{"closed": 1}})
		}
	}
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Sesión no encontrada"})
}

// AdminRevokeSessionsAPI POST /users/:id/revoke-sessions — un administrador cierra todas las sesiones de un usuario.
func (ctrl *AuthController) AdminRevokeSessionsAPI(c fiber.Ctx) error {
	target, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil || target == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	n := services.Sessions().RevokeUser(uint(target), "", services.SessionRevokedAdmin)
	actor, _ := getUserID(c)
	ctrl.security.Record(models.AuthEventSessionRevoked, uint(target), "", clientIP(c), c.Get("User-Agent"),
		fmt.Sprintf("el usuario #%d cerró %d sesión(es)", actor, n))
	return c.JSON(fiber.Map{"data": fiber.Map{"closed": n}})
}
