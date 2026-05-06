package controllers

import (
	"time"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type LiquidationController struct {
	svc *services.SubscriptionLiquidationService
}

func NewLiquidationController() *LiquidationController {
	return &LiquidationController{svc: services.NewSubscriptionLiquidationService()}
}

// RunLiquidationAPI ejecuta liquidación de mensualidades para la fecha actual (servidor).
func (ctrl *LiquidationController) RunLiquidationAPI(c fiber.Ctx) error {
	asOf := time.Now()
	if ds := c.Query("date", ""); ds != "" {
		t, err := time.ParseInLocation("2006-01-02", ds, time.Local)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "fecha inválida, use YYYY-MM-DD"})
		}
		asOf = t
	}
	res := ctrl.svc.RunLiquidation(asOf)
	return c.JSON(res)
}
