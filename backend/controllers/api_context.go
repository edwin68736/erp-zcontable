package controllers

import (
	"errors"

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

func getUserRole(c fiber.Ctx) string {
	role, _ := c.Locals("user_role").(string)
	return role
}

func isAdmin(c fiber.Ctx) bool {
	return getUserRole(c) == "Administrador"
}
