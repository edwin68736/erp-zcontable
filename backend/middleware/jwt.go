package middleware

import (
	"strings"

	"miappfiber/authclaims"
	"miappfiber/config"
	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
)

func JWTProtected() fiber.Handler {
	return func(c fiber.Ctx) error {
		if c.Method() == fiber.MethodOptions {
			return c.SendStatus(fiber.StatusNoContent)
		}
		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Token no proporcionado",
			})
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Formato de token inválido",
			})
		}

		tokenString := parts[1]
		claims := &authclaims.Claims{}

		token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(config.AppConfig.JWTSecret), nil
		})

		if err != nil || !token.Valid {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Token inválido o expirado",
			})
		}

		// La sesión del token debe seguir abierta: no cerrada desde el servidor, no vencida y con actividad reciente
		// de la persona (la pantalla manda X-Client-Active cuando hubo uso real; lo automático no cuenta).
		switch services.Sessions().Check(claims.SessionID, claims.UserID, c.Get("X-Client-Active") == "1") {
		case services.SessionOK:
		case services.SessionIdle:
			services.NewAuthSecurityService().Record(models.AuthEventIdleLogout, claims.UserID, claims.Username,
				services.ClientIP(c.IP(), c.Get("X-Forwarded-For")), c.Get("User-Agent"), "sin actividad por 30 minutos")
			return sessionError(c, "Su sesión se cerró por inactividad. Inicie sesión de nuevo.", "session_idle")
		case services.SessionRevoked:
			return sessionError(c, "Su sesión fue cerrada. Inicie sesión de nuevo.", "session_revoked")
		case services.SessionExpired:
			return sessionError(c, "Su sesión venció. Inicie sesión de nuevo.", "session_expired")
		default: // sin sesión: token anterior al sistema de sesiones
			return sessionError(c, "Inicie sesión de nuevo.", "session_missing")
		}

		// Un usuario desactivado o eliminado pierde el acceso enseguida, aunque su token no haya vencido.
		active, mustChange := services.Authz().UserAccess(claims.UserID)
		if !active {
			return sessionError(c, "Sesión no válida: el usuario está inactivo", "user_inactive")
		}
		// Si otra persona puso su contraseña, solo puede cambiarla (y cerrar sesión) antes de usar el sistema.
		if mustChange && !allowedWhileMustChangePassword(c.Path()) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "Debe cambiar su contraseña antes de continuar.",
				"code":  "password_change_required",
			})
		}

		c.Locals("session_id", claims.SessionID)
		c.Locals("user_id", claims.UserID)
		c.Locals("user_email", claims.Email)
		c.Locals("user_username", claims.Username)
		c.Locals("claims", claims)
		return c.Next()
	}
}

// AuthWeb protege rutas de vistas; redirige al login si no hay cookie de sesión
func AuthWeb() fiber.Handler {
	return func(c fiber.Ctx) error {
		token := c.Cookies("token")
		if token == "" {
			return c.Redirect().To("/login")
		}

		claims := &authclaims.Claims{}
		t, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(config.AppConfig.JWTSecret), nil
		})
		if err != nil || !t.Valid {
			c.ClearCookie("token")
			return c.Redirect().To("/login")
		}

		c.Locals("user_id", claims.UserID)
		c.Locals("user_email", claims.Email)
		c.Locals("user_username", claims.Username)
		if claims.Name != "" {
			c.Locals("user_name", claims.Name)
		} else {
			c.Locals("user_name", claims.Username)
		}
		return c.Next()
	}
}

func sessionError(c fiber.Ctx, msg, code string) error {
	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": msg, "code": code})
}

// allowedWhileMustChangePassword lo único que se puede hacer mientras falta cambiar la contraseña.
func allowedWhileMustChangePassword(path string) bool {
	return path == "/api/logout" || strings.HasPrefix(path, "/api/me/")
}
