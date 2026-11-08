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
}

func NewAuthController() *AuthController {
	return &AuthController{authService: services.NewAuthService(), security: services.NewAuthSecurityService()}
}

// clientIP la IP real del cliente (detrás de Traefik).
func clientIP(c fiber.Ctx) string {
	return services.ClientIP(c.IP(), c.Get("X-Forwarded-For"))
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
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

	token, err := ctrl.authService.GenerateToken(user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error generando token"})
	}
	ctrl.security.Record(models.AuthEventLoginOK, user.ID, user.Username, ip, ua, "")

	return c.JSON(fiber.Map{
		"token": token,
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
	return c.JSON(fiber.Map{"message": "Contraseña actualizada"})
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
	// En API stateless el cliente debe eliminar el token
	return c.JSON(fiber.Map{"message": "Sesión cerrada"})
}
