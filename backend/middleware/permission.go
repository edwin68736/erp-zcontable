package middleware

import (
	"errors"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

func userIDFromCtx(c fiber.Ctx) (uint, error) {
	v := c.Locals("user_id")
	switch t := v.(type) {
	case uint:
		return t, nil
	case int:
		if t < 0 {
			return 0, errors.New("user_id inválido")
		}
		return uint(t), nil
	case int64:
		if t < 0 {
			return 0, errors.New("user_id inválido")
		}
		return uint(t), nil
	case float64:
		if t < 0 {
			return 0, errors.New("user_id inválido")
		}
		return uint(t), nil
	default:
		return 0, errors.New("user_id no encontrado")
	}
}

// RequirePermission exige al menos uno de los códigos module.action (OR).
func RequirePermission(permissionCodes ...string) fiber.Handler {
	return RequireAnyPermission(permissionCodes...)
}

// RequireAnyPermission alias de RequirePermission: al menos uno de los permisos.
func RequireAnyPermission(permissionCodes ...string) fiber.Handler {
	return func(c fiber.Ctx) error {
		uid, err := userIDFromCtx(c)
		if err != nil || uid == 0 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"code":    "UNAUTHORIZED",
				"message": "No autenticado",
			})
		}
		if services.Authz().HasAnyPermission(uid, permissionCodes...) {
			return c.Next()
		}
		return forbiddenPermissionJSON(c)
	}
}

// RequireAllPermissions exige todos los códigos indicados (AND).
func RequireAllPermissions(permissionCodes ...string) fiber.Handler {
	return func(c fiber.Ctx) error {
		uid, err := userIDFromCtx(c)
		if err != nil || uid == 0 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"code":    "UNAUTHORIZED",
				"message": "No autenticado",
			})
		}
		if services.Authz().HasAllPermissions(uid, permissionCodes...) {
			return c.Next()
		}
		return forbiddenPermissionJSON(c)
	}
}

func forbiddenPermissionJSON(c fiber.Ctx) error {
	return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
		"success": false,
		"code":    "INSUFFICIENT_PERMISSIONS",
		"message": "No tienes permisos para realizar esta acción",
	})
}
