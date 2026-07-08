package controllers

import (
	"strconv"
	"strings"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type ActivityRuleController struct {
	svc *services.ActivityRuleService
}

func NewActivityRuleController() *ActivityRuleController {
	return &ActivityRuleController{svc: services.NewActivityRuleService()}
}

func (ctrl *ActivityRuleController) ListAPI(c fiber.Ctx) error {
	activeOnly := strings.TrimSpace(c.Query("active", "")) == "1" ||
		strings.EqualFold(c.Query("active", ""), "true")
	var rows []models.ActivityRule
	var err error
	if activeOnly {
		rows, err = ctrl.svc.ListActive()
	} else {
		rows, err = ctrl.svc.List()
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if rows == nil {
		rows = []models.ActivityRule{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *ActivityRuleController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	row, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *ActivityRuleController) AuditsAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if _, err := ctrl.svc.GetByID(uint(id)); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	rows, err := ctrl.svc.ListAudits(uint(id), limit)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (ctrl *ActivityRuleController) CreateAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	var body struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		CompareMode   string `json:"compare_mode"`
		MaxUploadTime string `json:"max_upload_time"`
		GraceDays     int    `json:"grace_days"`
		Active        bool   `json:"active"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	row, err := ctrl.svc.Create(services.ActivityRuleInput{
		Name:          body.Name,
		Description:   body.Description,
		CompareMode:   body.CompareMode,
		MaxUploadTime: body.MaxUploadTime,
		GraceDays:     body.GraceDays,
		Active:        body.Active,
	}, uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": row})
}

func (ctrl *ActivityRuleController) UpdateAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		CompareMode   string `json:"compare_mode"`
		MaxUploadTime string `json:"max_upload_time"`
		GraceDays     int    `json:"grace_days"`
		Active        bool   `json:"active"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "JSON inválido"})
	}
	row, err := ctrl.svc.Update(uint(id), services.ActivityRuleInput{
		Name:          body.Name,
		Description:   body.Description,
		CompareMode:   body.CompareMode,
		MaxUploadTime: body.MaxUploadTime,
		GraceDays:     body.GraceDays,
		Active:        body.Active,
	}, uid)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (ctrl *ActivityRuleController) DeleteAPI(c fiber.Ctx) error {
	uid, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.svc.Delete(uint(id), uid); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}
