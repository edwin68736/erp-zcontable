package controllers

import (
	"strconv"

	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type SubscriptionPlanController struct {
	svc *services.SubscriptionPlanService
}

func NewSubscriptionPlanController() *SubscriptionPlanController {
	return &SubscriptionPlanController{svc: services.NewSubscriptionPlanService()}
}

type subscriptionPlanBody struct {
	models.SubscriptionPlan
	Tiers []models.PlanTier `json:"tiers"`
}

func (ctrl *SubscriptionPlanController) ListAPI(c fiber.Ctx) error {
	catStr := c.Query("plan_category_id", "")
	if catStr != "" {
		cid, err := strconv.ParseUint(catStr, 10, 32)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plan_category_id inválido"})
		}
		list, err := ctrl.svc.ListByCategory(uint(cid))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"data": list})
	}
	list, err := ctrl.svc.ListAll()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": list})
}

func (ctrl *SubscriptionPlanController) GetAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	p, err := ctrl.svc.GetByID(uint(id))
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Plan no encontrado"})
	}
	return c.JSON(p)
}

func (ctrl *SubscriptionPlanController) CreateAPI(c fiber.Ctx) error {
	var body subscriptionPlanBody
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.svc.Create(&body.SubscriptionPlan, body.Tiers); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	out, _ := ctrl.svc.GetByID(body.ID)
	return c.Status(fiber.StatusCreated).JSON(out)
}

func (ctrl *SubscriptionPlanController) UpdateAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var input models.SubscriptionPlan
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.svc.Update(uint(id), &input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	out, _ := ctrl.svc.GetByID(uint(id))
	return c.JSON(out)
}

func (ctrl *SubscriptionPlanController) ReplaceTiersAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	var body struct {
		Tiers []models.PlanTier `json:"tiers"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	if err := ctrl.svc.ReplaceTiers(uint(id), body.Tiers); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	out, _ := ctrl.svc.GetByID(uint(id))
	return c.JSON(out)
}

func (ctrl *SubscriptionPlanController) DeleteAPI(c fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}
	if err := ctrl.svc.Delete(uint(id)); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Eliminado"})
}
