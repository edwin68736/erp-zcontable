package controllers

import (
	"math"
	"strconv"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type ProductController struct {
	svc    *services.ProductService
	tukifac *services.TukifacService
}

func NewProductController() *ProductController {
	return &ProductController{
		svc:     services.NewProductService(),
		tukifac: services.NewTukifacService(),
	}
}

func (ctrl *ProductController) ListAPI(c fiber.Ctx) error {
	q := c.Query("q", "")
	kind := c.Query("kind", "")
	active := c.Query("active", "")

	page := 1
	if v := c.Query("page", "1"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			page = p
		}
	}
	perPage := 20
	if v := c.Query("per_page", "20"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			perPage = n
			if perPage > 200 {
				perPage = 200
			}
		}
	}

	params := services.ProductListParams{
		Query:  q,
		Kind:   kind,
		Active: active,
	}

	list, total, err := ctrl.svc.ListPaged(params, page, perPage)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	totalPages := 0
	if perPage > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(perPage)))
	}

	return c.JSON(fiber.Map{
		"data": list,
		"pagination": fiber.Map{
			"page":        page,
			"per_page":    perPage,
			"total":       total,
			"total_pages": totalPages,
		},
	})
}

func (ctrl *ProductController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	p, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Producto no encontrado"})
	}
	return c.JSON(p)
}

func (ctrl *ProductController) CreateAPI(c fiber.Ctx) error {
	var input models.Product
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.svc.Create(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	p, err := ctrl.svc.GetByID(input.ID)
	if err != nil {
		return c.Status(fiber.StatusCreated).JSON(input)
	}
	return c.Status(fiber.StatusCreated).JSON(p)
}

func (ctrl *ProductController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var input models.Product
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.svc.Update(uint(id), &input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	p, _ := ctrl.svc.GetByID(uint(id))
	return c.JSON(p)
}

func (ctrl *ProductController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.svc.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No se pudo eliminar"})
	}
	return c.JSON(fiber.Map{"message": "Eliminado"})
}

// SyncTukifacAPI importa o actualiza ítems desde Tukifac (solo lectura remota).
func (ctrl *ProductController) SyncTukifacAPI(c fiber.Ctx) error {
	created, updated, err := ctrl.svc.SyncFromTukifac(ctrl.tukifac)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{
		"success": true,
		"message": "Sincronización de productos completada",
		"data": fiber.Map{
			"created": created,
			"updated": updated,
		},
	})
}
