package controllers

import (
	"strconv"

	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

// ExchangeRateController Recursos → Tipo de cambio: calendario mensual de SUNAT guardado en nuestra base y completado
// desde ApiPeru.dev (ver services/exchange_rate_service.go). Lo ve cualquier usuario autenticado.
type ExchangeRateController struct {
	svc    *services.ExchangeRateService
	market *services.ExchangeMarketService
}

func NewExchangeRateController() *ExchangeRateController {
	return &ExchangeRateController{svc: services.NewExchangeRateService(), market: services.NewExchangeMarketService()}
}

// MonthAPI GET /exchange-rates/month?year=2026&month=10&currency=USD&fetch=1
// Devuelve los días del mes que hay en la base; con fetch=1 trae antes los que falten. Si no se pudo completar, igual
// responde con lo guardado y un aviso (warning / warning_code).
func (ctrl *ExchangeRateController) MonthAPI(c fiber.Ctx) error {
	year, _ := strconv.Atoi(c.Query("year"))
	month, _ := strconv.Atoi(c.Query("month"))
	fetch := c.Query("fetch") == "1" || c.Query("fetch") == "true"
	res, err := ctrl.svc.Month(year, month, c.Query("currency"), fetch)
	if err != nil {
		return sunatErrorResponse(c, err, "No se pudo leer el tipo de cambio")
	}
	return c.JSON(fiber.Map{"data": res})
}

// MarketAPI GET /exchange-rates/market — tipo de cambio «paralelo» (de mercado): cotización de hoy y el historial
// interbancario del BCRP para el gráfico (ver services/exchange_market_service.go). Solo informativo.
func (ctrl *ExchangeRateController) MarketAPI(c fiber.Ctx) error {
	res, err := ctrl.market.Get()
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "No se pudo obtener el tipo de cambio de mercado. Intente de nuevo en unos minutos."})
	}
	return c.JSON(fiber.Map{"data": res})
}
