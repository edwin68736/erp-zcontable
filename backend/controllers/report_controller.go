package controllers

import (
	"strconv"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	"miappfiber/services"
	debtsvc "miappfiber/services/debt"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

type ReportController struct {
	financeService *services.FinanceService
}

func NewReportController() *ReportController {
	return &ReportController{
		financeService: services.NewFinanceService(),
	}
}

// sumSaldoDocumentado agrega debt.Service.SaldoDocumentado sobre cada empresa indicada. Extraída de
// FinancialSummaryAPI (Fase 3 Paso 4B) para poder probarla sin necesidad de simular el contexto HTTP
// completo del endpoint — no introduce ninguna fórmula nueva, solo reutiliza SaldoDocumentado por
// empresa, igual que ya hace GetFinancialReportRows con su propio bucle de compañías.
func sumSaldoDocumentado(db *gorm.DB, debtSvc *debtsvc.Service, companyIDs []uint) (float64, error) {
	var total float64
	for _, cid := range companyIDs {
		bal, err := debtSvc.SaldoDocumentado(db, cid)
		if err != nil {
			return 0, err
		}
		total += bal
	}
	return total, nil
}

func (ctrl *ReportController) FinancialSummaryAPI(c fiber.Ctx) error {
	var allowedCompanyIDs []uint
	if !hasStudioScope(c) {
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

	var totalDocs, totalPays, globalBalance float64
	if len(allowedCompanyIDs) > 0 || hasStudioScope(c) {
		docQ := database.DB.Model(&models.Document{}).Where("status <> ?", "anulado")
		payQ := database.DB.Model(&models.Payment{})
		if !hasStudioScope(c) {
			docQ = docQ.Where("company_id IN ?", allowedCompanyIDs)
			payQ = payQ.Where("company_id IN ?", allowedCompanyIDs)
		}
		docQ.Select("COALESCE(SUM(total_amount),0)").Scan(&totalDocs)
		payQ.Select("COALESCE(SUM(amount),0)").Scan(&totalPays)

		// Fase 3 Paso 4B (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md):
		// global_balance ya NO se calcula como totalDocs-totalPays (mezclaba dinero de
		// servicio/a-cuenta con la deuda y podía producir saldos negativos falsos) — se agrega
		// debt.Service.SaldoDocumentado por cada empresa del ámbito visible, reutilizando la misma
		// función centralizada que ya usan GetCompanyBalance/GetCompanyStatement/
		// GetFinancialReportRows. totalDocs/totalPays se conservan sin cambios como datos
		// informativos (total_documents_amount/total_payments_amount).
		var companyIDsInScope []uint
		if hasStudioScope(c) {
			if err := database.DB.Model(&models.Company{}).Pluck("id", &companyIDsInScope).Error; err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
			}
		} else {
			companyIDsInScope = allowedCompanyIDs
		}
		bal, err := sumSaldoDocumentado(database.DB, debtsvc.NewService(), companyIDsInScope)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		globalBalance = bal
	}

	include := c.Query("include", "")
	if include == "companies" {
		params := services.FinancialReportParams{IsAdmin: hasStudioScope(c)}
		if !hasStudioScope(c) {
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
		"global_balance":         globalBalance,
	})
}

// DebtsReportAPI GET /api/reports/debts — reporte de deudas con balance_amount persistido.
func (ctrl *ReportController) DebtsReportAPI(c fiber.Ctx) error {
	var allowedCompanyIDs []uint
	if !hasStudioScope(c) {
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
		if len(allowedCompanyIDs) == 0 {
			return c.JSON(fiber.Map{"data": []debtsvc.DocumentStatementRow{}})
		}
	}
	var companyID uint
	if cidStr := strings.TrimSpace(c.Query("company_id", "")); cidStr != "" {
		if cid, err := strconv.ParseUint(cidStr, 10, 32); err == nil {
			companyID = uint(cid)
		}
	}
	debtSvc := debtsvc.NewService()
	rows, err := debtSvc.ListDocumentReportRows(database.DB, companyID, allowedCompanyIDs)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"data": rows})
}
