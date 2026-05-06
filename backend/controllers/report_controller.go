package controllers

import (
	"strconv"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type ReportController struct {
	financeService *services.FinanceService
}

func NewReportController() *ReportController {
	return &ReportController{
		financeService: services.NewFinanceService(),
	}
}

func (ctrl *ReportController) FinancialSummaryAPI(c fiber.Ctx) error {
	var allowedCompanyIDs []uint
	if !isAdmin(c) {
		userID, err := getUserID(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
		}
		accessService := services.NewAccessService()
		ids, err := accessService.GetAllowedCompanyIDs(userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error de acceso"})
		}
		allowedCompanyIDs = ids
	}

	var totalDocs, totalPays float64
	if len(allowedCompanyIDs) > 0 || isAdmin(c) {
		docQ := database.DB.Model(&models.Document{}).Where("status <> ?", "anulado")
		payQ := database.DB.Model(&models.Payment{})
		if !isAdmin(c) {
			docQ = docQ.Where("company_id IN ?", allowedCompanyIDs)
			payQ = payQ.Where("company_id IN ?", allowedCompanyIDs)
		}
		docQ.Select("COALESCE(SUM(total_amount),0)").Scan(&totalDocs)
		payQ.Select("COALESCE(SUM(amount),0)").Scan(&totalPays)
	}

	include := c.Query("include", "")
	if include == "companies" {
		params := services.FinancialReportParams{IsAdmin: isAdmin(c)}
		if !isAdmin(c) {
			params.AllowedCompanyIDs = allowedCompanyIDs
			if len(allowedCompanyIDs) == 0 {
				return c.JSON(fiber.Map{
					"total_documents_amount": 0,
					"total_payments_amount":  0,
					"global_balance":         0,
					"rows":                   []services.FinancialCompanyReportRow{},
				})
			}
		}

		if cidStr := strings.TrimSpace(c.Query("company_id", "")); cidStr != "" {
			if cid, err := strconv.ParseUint(cidStr, 10, 32); err == nil && cid > 0 {
				params.CompanyID = uint(cid)
			}
		}

		if df := strings.TrimSpace(c.Query("date_from", "")); df != "" {
			if t, err := time.ParseInLocation("2006-01-02", df, time.Local); err == nil {
				params.DateFrom = &t
			}
		}
		if dt := strings.TrimSpace(c.Query("date_to", "")); dt != "" {
			if t, err := time.ParseInLocation("2006-01-02", dt, time.Local); err == nil {
				excl := t.AddDate(0, 0, 1)
				params.DateToExclusive = &excl
			}
		}

		if mo := strings.TrimSpace(c.Query("min_overdue_months", "")); mo != "" {
			if n, err := strconv.Atoi(mo); err == nil && n > 0 {
				if n > 24 {
					n = 24
				}
				params.MinOverdueMonths = n
			}
		}

		rows, gDocs, gPays, gBal, err := ctrl.financeService.GetFinancialReportRows(params)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{
			"total_documents_amount": gDocs,
			"total_payments_amount":  gPays,
			"global_balance":         gBal,
			"rows":                   rows,
		})
	}

	return c.JSON(fiber.Map{
		"total_documents_amount": totalDocs,
		"total_payments_amount":  totalPays,
		"global_balance":         totalDocs - totalPays,
	})
}
