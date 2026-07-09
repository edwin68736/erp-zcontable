package controllers

import (
	"strconv"
	"strings"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type ActivityTemplateController struct {
	svc *services.ActivityTemplateService
}

func NewActivityTemplateController() *ActivityTemplateController {
	return &ActivityTemplateController{svc: services.NewActivityTemplateService()}
}

func (ctrl *ActivityTemplateController) ListAPI(c fiber.Ctx) error {
	activeOnly := strings.TrimSpace(c.Query("active", "")) == "1" ||
		strings.EqualFold(c.Query("active", ""), "true")
	rows, err := ctrl.svc.List(services.ActivityTemplateListParams{ActiveOnly: activeOnly})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *ActivityTemplateController) GetAPI(c fiber.Ctx) error {
	idParam := strings.TrimSpace(c.Params("id"))
	if idParam == "" || idParam == "new" || idParam == "next-code" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	id, err := strconv.ParseUint(idParam, 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	row, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *ActivityTemplateController) PreviewCodeAPI(c fiber.Ctx) error {
	code, err := ctrl.svc.PreviewNextCode()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"code": code}})
}

func (ctrl *ActivityTemplateController) CreateAPI(c fiber.Ctx) error {
	var body struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		ActivityType  string `json:"activity_type"`
		Priority      string `json:"priority"`
		TextColor     string `json:"text_color"`
		Icon          string `json:"icon"`
		SortOrder     int    `json:"sort_order"`
		IsValidatable *bool  `json:"is_validatable"`
		Active        *bool  `json:"active"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	row, err := ctrl.svc.Create(services.ActivityTemplateInput{
		Name:          body.Name,
		Description:   body.Description,
		ActivityType:  body.ActivityType,
		Priority:      body.Priority,
		TextColor:     body.TextColor,
		Icon:          body.Icon,
		SortOrder:     body.SortOrder,
		IsValidatable: body.IsValidatable,
		Active:        body.Active,
	})
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

func (ctrl *ActivityTemplateController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		ActivityType  string `json:"activity_type"`
		Priority      string `json:"priority"`
		TextColor     string `json:"text_color"`
		Icon          string `json:"icon"`
		SortOrder     int    `json:"sort_order"`
		IsValidatable *bool  `json:"is_validatable"`
		Active        *bool  `json:"active"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	row, err := ctrl.svc.Update(uint(id), services.ActivityTemplateInput{
		Name:          body.Name,
		Description:   body.Description,
		ActivityType:  body.ActivityType,
		Priority:      body.Priority,
		TextColor:     body.TextColor,
		Icon:          body.Icon,
		SortOrder:     body.SortOrder,
		IsValidatable: body.IsValidatable,
		Active:        body.Active,
	})
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *ActivityTemplateController) SetActiveAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		Active bool `json:"active"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	row, err := ctrl.svc.SetActive(uint(id), body.Active)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *ActivityTemplateController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.svc.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (ctrl *ActivityTemplateController) SetActivityRuleAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		ActivityRuleID *uint `json:"activity_rule_id"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	row, err := ctrl.svc.SetActivityRule(uint(id), body.ActivityRuleID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}
