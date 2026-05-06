package middleware

import (
	"strings"

	"miappfiber/config"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
)

type JWTClaims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

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
		claims := &JWTClaims{}

		token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(config.AppConfig.JWTSecret), nil
		})

		if err != nil || !token.Valid {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Token inválido o expirado",
			})
		}

		c.Locals("user_id", claims.UserID)
		c.Locals("user_email", claims.Email)
		c.Locals("user_username", claims.Username)
		c.Locals("user_role", claims.Role)
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

		claims := &JWTClaims{}
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
		c.Locals("user_role", claims.Role)
		if claims.Name != "" {
			c.Locals("user_name", claims.Name)
		} else {
			c.Locals("user_name", claims.Username)
		}
		return c.Next()
	}
}

// RequireRole valida que el usuario autenticado tenga uno de los roles permitidos.
func RequireRole(roles ...string) fiber.Handler {
	allowed := make(map[string]struct{}, len(roles))
	for _, r := range roles {
		allowed[r] = struct{}{}
	}

	return func(c fiber.Ctx) error {
		role, _ := c.Locals("user_role").(string)
		if role == "" {
			if claims, ok := c.Locals("claims").(*JWTClaims); ok && claims != nil {
				role = claims.Role
			}
		}
		if role == "" {
			return c.Status(fiber.StatusForbidden).SendString("Acceso restringido")
		}
		if len(allowed) == 0 {
			return c.Next()
		}
		if _, ok := allowed[role]; !ok {
			return c.Status(fiber.StatusForbidden).SendString("No tienes permisos para esta acción")
		}
		return c.Next()
	}
}
