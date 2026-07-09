package controllers

import (
	"errors"

	"miappfiber/rbac"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

func getUserID(c fiber.Ctx) (uint, error) {
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

// GetUserID devuelve el ID del usuario autenticado (JWT).
func GetUserID(c fiber.Ctx) (uint, error) {
	return getUserID(c)
}

// hasStudioScope true si el usuario tiene permiso de alcance global del estudio (todas las empresas).
func hasStudioScope(c fiber.Ctx) bool {
	uid, err := getUserID(c)
	if err != nil {
		return false
	}
	return services.Authz().HasPermission(uid, rbac.AccessStudio)
}
