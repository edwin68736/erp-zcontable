package controllers

import (
	"strconv"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type PlanCategoryController struct {
	svc *services.PlanCategoryService
}

func NewPlanCategoryController() *PlanCategoryController {
	return &PlanCategoryController{svc: services.NewPlanCategoryService()}
}

func (ctrl *PlanCategoryController) ListAPI(c fiber.Ctx) error {
	list, err := ctrl.svc.ListAll()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": list})
}

func (ctrl *PlanCategoryController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	cat, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Categoría no encontrada"})
	}
	return c.JSON(cat)
}

func (ctrl *PlanCategoryController) CreateAPI(c fiber.Ctx) error {
	var input models.PlanCategory
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.svc.Create(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(input)
}

func (ctrl *PlanCategoryController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var input models.PlanCategory
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.svc.Update(uint(id), &input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	cat, _ := ctrl.svc.GetByID(uint(id))
	return c.JSON(cat)
}

func (ctrl *PlanCategoryController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.svc.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Eliminado"})
}
