package controllers

import (
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type FiscalDocumentSeriesController struct {
	svc *services.FiscalDocumentSeriesService
}

func NewFiscalDocumentSeriesController() *FiscalDocumentSeriesController {
	return &FiscalDocumentSeriesController{svc: services.NewFiscalDocumentSeriesService()}
}

func (ctrl *FiscalDocumentSeriesController) ListAPI(c fiber.Ctx) error {
	activeOnly := c.Query("active_only", "") == "1" || c.Query("active_only", "") == "true"
	sunat := c.Query("sunat_code", "")
	list, err := ctrl.svc.List(activeOnly, sunat)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	out := make([]fiber.Map, 0, len(list))
	for _, s := range list {
		out = append(out, fiber.Map{
			"id":              s.ID,
			"name":            s.Name,
			"sunat_code":      s.SunatCode,
			"series":          s.Series,
			"current_number":  s.CurrentNumber,
			"next_number":     services.NextCorrelativePreview(&s),
			"active":          s.Active,
			"description":     s.Description,
			"created_at":      s.CreatedAt,
			"updated_at":      s.UpdatedAt,
		})
	}
	return c.JSON(fiber.Map{"data": out})
}

func (ctrl *FiscalDocumentSeriesController) GetAPI(c fiber.Ctx) error {
	id, err := parseSeriesIDParam(c, "id")
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	row, err := ctrl.svc.GetByID(id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Serie no encontrada"})
	}
	return c.JSON(fiber.Map{
		"data": fiber.Map{
			"id":             row.ID,
			"name":           row.Name,
			"sunat_code":     row.SunatCode,
			"series":         row.Series,
			"current_number": row.CurrentNumber,
			"next_number":    services.NextCorrelativePreview(row),
			"active":         row.Active,
			"description":    row.Description,
		},
	})
}

func (ctrl *FiscalDocumentSeriesController) CreateAPI(c fiber.Ctx) error {
	var body services.FiscalDocumentSeriesInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	row, err := ctrl.svc.Create(&body)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

func (ctrl *FiscalDocumentSeriesController) UpdateAPI(c fiber.Ctx) error {
	id, err := parseSeriesIDParam(c, "id")
	if err != nil || id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body services.FiscalDocumentSeriesInput
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	row, err := ctrl.svc.Update(id, &body)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func parseSeriesIDParam(c fiber.Ctx, name string) (uint, error) {
	v, err := strconv.ParseUint(c.Params(name), 10, 32)
	return uint(v), err
}
