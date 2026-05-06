package controllers

import (
	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type ProductCategoryController struct {
	svc *services.ProductCategoryService
}

func NewProductCategoryController() *ProductCategoryController {
	return &ProductCategoryController{svc: services.NewProductCategoryService()}
}

func (ctrl *ProductCategoryController) ListAPI(c fiber.Ctx) error {
	list, err := ctrl.svc.ListActive()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": list})
}

func (ctrl *ProductCategoryController) CreateAPI(c fiber.Ctx) error {
	var body struct {
		Name      string `json:"name"`
		SortOrder int    `json:"sort_order"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	cat := models.ProductCategory{
		Name:      body.Name,
		SortOrder: body.SortOrder,
		Active:    true,
	}
	if err := ctrl.svc.Create(&cat); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(cat)
}
