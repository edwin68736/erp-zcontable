package controllers

import (
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type SunatDueDateController struct {
	svc *services.SunatDueDateService
}

func NewSunatDueDateController() *SunatDueDateController {
	return &SunatDueDateController{svc: services.NewSunatDueDateService()}
}

// ListAPI GET /api/finance/sunat-due-dates
func (ctrl *SunatDueDateController) ListAPI(c fiber.Ctx) error {
	rows, err := ctrl.svc.List()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

// UpdateAPI PUT /api/finance/sunat-due-dates — edita fechas de los meses indicados (no crea filas).
func (ctrl *SunatDueDateController) UpdateAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	var body struct {
		Rows []services.SunatDueDateUpdateInput `json:"rows"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	rows, err := ctrl.svc.Update(uid, body.Rows)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}
