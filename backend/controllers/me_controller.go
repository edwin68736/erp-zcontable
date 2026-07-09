package controllers

import (
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type MeController struct{}

func NewMeController() *MeController {
	return &MeController{}
}

// PermissionsAPI devuelve los códigos de permiso efectivos del usuario autenticado.
func (ctrl *MeController) PermissionsAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "code": "UNAUTHORIZED", "message": "No autenticado"})
	}
	codes, err := services.Authz().PermissionCodesForUser(uid)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "data": codes})
}
