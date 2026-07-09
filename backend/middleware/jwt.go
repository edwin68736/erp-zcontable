package middleware

import (
	"strings"

	"miappfiber/authclaims"
	"miappfiber/config"

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
