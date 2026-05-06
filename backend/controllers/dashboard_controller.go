package controllers

import (
	"fmt"
	"strconv"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	"miappfiber/services"

	"github.com/gofiber/fiber/v3"
)

type DashboardController struct{}

type MonthlyPaymentStat struct {
	Label  string
	Amount float64
	Level  string
	Height int
}

type CompanyDebtCard struct {
	Company              *models.Company
	TotalDocuments       float64
	TotalPayments        float64
	Balance              float64
	MaxOverdueMonths     int    // atraso en meses vs. periodo contable del cargo con saldo
	HasOverdue           bool   // true si hay al menos un mes de atraso de periodo
	OldestOpenDebtPeriod string // YYYY-MM del cargo con saldo más antiguo
}

type DashboardData struct {
	UsersCount               int64
	CompaniesCount           int64
	DocumentsCount           int64
	PaymentsCount            int64
	TotalDocs                float64
	TotalPays                float64
	GlobalBalance            float64
	MonthlyPayments          []MonthlyPaymentStat
	TopDebtors               []CompanyDebtCard
	RecentDocuments          []models.Document
	MonthlyPaymentsYear      int
	YearCollectionPercent    float64
	YearCollectionPercentStr string
	YearCollectionDocs       float64
	YearCollectionPayments   float64
	YearCollectionDocsStr    string
	YearCollectionPaysStr    string
	DebtCompaniesCount       int
	TotalDebtAmount          float64
	PendingDocsCount         int64
	OverdueDocsCount         int64
}

func NewDashboardController() *DashboardController {
	return &DashboardController{}
}

// filterSortLimitDebtors aplica mora mínima, ordena por saldo descendente y limita la lista (p. ej. top 10).
func filterSortLimitDebtors(debtCards []CompanyDebtCard, minOverdueMonths int, limit int) []CompanyDebtCard {
	if minOverdueMonths > 0 {
		filtered := make([]CompanyDebtCard, 0, len(debtCards))
		for _, d := range debtCards {
			if d.MaxOverdueMonths >= minOverdueMonths {
				filtered = append(filtered, d)
			}
		}
		debtCards = filtered
	}
	for i := 0; i < len(debtCards); i++ {
		for j := i + 1; j < len(debtCards); j++ {
			if debtCards[j].Balance > debtCards[i].Balance {
				debtCards[i], debtCards[j] = debtCards[j], debtCards[i]
			}
		}
	}
	if limit > 0 && len(debtCards) > limit {
		debtCards = debtCards[:limit]
	}
	return debtCards
}

func (ctrl *DashboardController) getDashboardData(minOverdueMonths int) (*DashboardData, error) {
	var usersCount, companiesCount, documentsCount, paymentsCount int64
	database.DB.Model(&models.User{}).Count(&usersCount)
	database.DB.Model(&models.Company{}).Count(&companiesCount)
	database.DB.Model(&models.Document{}).Count(&documentsCount)
	database.DB.Model(&models.Payment{}).Count(&paymentsCount)

	finService := services.NewFinanceService()
	// Para el dashboard principal no calculamos por empresa específica,
	// sino totales globales.
	var totalDocs, totalPays float64
	database.DB.Model(&models.Document{}).
		Where("status <> ?", "anulado").
		Select("COALESCE(SUM(total_amount),0)").Scan(&totalDocs)
	database.DB.Model(&models.Payment{}).
		Where("deleted_at IS NULL").
		Select("COALESCE(SUM(amount),0)").Scan(&totalPays)

	// Pagos por mes (año actual)
	now := time.Now()
	year := now.Year()
	monthLabels := []string{"E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"}
	monthly := make([]MonthlyPaymentStat, 0, 12)

	var maxAmount float64
	var minAmount *float64

	for i := 1; i <= 12; i++ {
		start := time.Date(year, time.Month(i), 1, 0, 0, 0, 0, time.Local)
		end := start.AddDate(0, 1, 0)
		var sum float64
		database.DB.Model(&models.Payment{}).
			Where("date >= ? AND date < ?", start, end).
			Select("COALESCE(SUM(amount),0)").Scan(&sum)

		if sum > maxAmount {
			maxAmount = sum
		}
		if minAmount == nil || sum < *minAmount {
			v := sum
			minAmount = &v
		}

		monthly = append(monthly, MonthlyPaymentStat{
			Label:  monthLabels[i-1],
			Amount: sum,
			Level:  "mid", // se ajustará luego
			Height: 0,     // se ajustará luego
		})
	}

	// Asignar niveles de color según mínimo / máximo
	// Todos en cero -> tratarlos como "zero" (barras con rayas)
	if maxAmount == 0 {
		for i := range monthly {
			monthly[i].Level = "zero"
		}
	} else if minAmount != nil {
		for i := range monthly {
			switch {
			case monthly[i].Amount == maxAmount:
				monthly[i].Level = "max"
			case monthly[i].Amount == 0:
				monthly[i].Level = "zero"
			default:
				monthly[i].Level = "mid"
			}
		}
	}

	// Altura relativa (20% a 100%) según el monto vs. máximo
	for i := range monthly {
		if maxAmount == 0 {
			monthly[i].Height = 40
			continue
		}
		ratio := 0.0
		if monthly[i].Amount > 0 {
			ratio = monthly[i].Amount / maxAmount
		}
		base := 20.0
		span := 80.0
		h := int(base + ratio*span)
		if h < 10 {
			h = 10
		}
		if h > 100 {
			h = 100
		}
		monthly[i].Height = h
	}

	// Porcentaje de cobranza del año actual
	yearStart := time.Date(year, time.January, 1, 0, 0, 0, 0, time.Local)
	yearEnd := yearStart.AddDate(1, 0, 0)

	var yearDocs, yearPays float64
	database.DB.Model(&models.Document{}).
		Where("issue_date >= ? AND issue_date < ? AND status <> ?", yearStart, yearEnd, "anulado").
		Select("COALESCE(SUM(total_amount),0)").Scan(&yearDocs)
	database.DB.Model(&models.Payment{}).
		Where("date >= ? AND date < ?", yearStart, yearEnd).
		Select("COALESCE(SUM(amount),0)").Scan(&yearPays)

	collectionPercent := 0.0
	if yearDocs > 0 {
		collectionPercent = (yearPays / yearDocs) * 100
		if collectionPercent > 100 {
			collectionPercent = 100
		}
	}
	collectionPercentStr := fmt.Sprintf("%.0f", collectionPercent)
	yearPaysStr := fmt.Sprintf("%.2f", yearPays)
	yearDocsStr := fmt.Sprintf("%.2f", yearDocs)

	// Top empresas con deuda (saldo > 0)
	var companies []models.Company
	if err := database.DB.Order("business_name ASC").Find(&companies).Error; err != nil {
		companies = []models.Company{}
	}
	debtCards := make([]CompanyDebtCard, 0, 10)
	var totalDebt float64
	for _, cmp := range companies {
		bal, err := finService.GetCompanyBalance(cmp.ID)
		if err != nil {
			continue
		}
		if bal.Balance <= 0 {
			continue
		}
		totalDebt += bal.Balance
		maxLag, oldestYM, _ := finService.MaxPeriodLagMonthsForCompany(cmp.ID)
		debtCards = append(debtCards, CompanyDebtCard{
			Company:              bal.Company,
			TotalDocuments:       bal.TotalDocuments,
			TotalPayments:        bal.TotalPayments,
			Balance:              bal.Balance,
			MaxOverdueMonths:     maxLag,
			HasOverdue:           maxLag > 0,
			OldestOpenDebtPeriod: oldestYM,
		})
	}

	allDebtCompaniesCount := len(debtCards)
	debtCards = filterSortLimitDebtors(debtCards, minOverdueMonths, 10)

	// Últimos documentos registrados (para "Proyectos recientes")
	var recentDocs []models.Document
	if err := database.DB.
		Preload("Company").
		Order("issue_date DESC, id DESC").
		Limit(5).
		Find(&recentDocs).Error; err != nil {
		recentDocs = []models.Document{}
	}

	// Recordatorios: documentos pendientes y vencidos
	var pendingDocsCount, overdueDocsCount int64
	today := time.Now()
	startOfToday := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.Local)
	openStatuses := []string{"pendiente", "parcial"}

	database.DB.Model(&models.Document{}).
		Where("status IN ? AND (due_date IS NULL OR due_date >= ?)", openStatuses, startOfToday).
		Count(&pendingDocsCount)
	database.DB.Model(&models.Document{}).
		Where("status IN ? AND due_date IS NOT NULL AND due_date < ?", openStatuses, startOfToday).
		Count(&overdueDocsCount)

	return &DashboardData{
		UsersCount:               usersCount,
		CompaniesCount:           companiesCount,
		DocumentsCount:           documentsCount,
		PaymentsCount:            paymentsCount,
		TotalDocs:                totalDocs,
		TotalPays:                totalPays,
		GlobalBalance:            totalDocs - totalPays,
		MonthlyPayments:          monthly,
		TopDebtors:               debtCards,
		RecentDocuments:          recentDocs,
		MonthlyPaymentsYear:      year,
		YearCollectionPercent:    collectionPercent,
		YearCollectionPercentStr: collectionPercentStr,
		YearCollectionDocs:       yearDocs,
		YearCollectionPayments:   yearPays,
		YearCollectionDocsStr:    yearDocsStr,
		YearCollectionPaysStr:    yearPaysStr,
		DebtCompaniesCount:       allDebtCompaniesCount,
		TotalDebtAmount:          totalDebt,
		PendingDocsCount:         pendingDocsCount,
		OverdueDocsCount:         overdueDocsCount,
	}, nil
}

func (ctrl *DashboardController) getDashboardDataForCompanyIDs(companyIDs []uint, minOverdueMonths int) (*DashboardData, error) {
	now := time.Now()
	year := now.Year()
	monthLabels := []string{"E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"}
	monthly := make([]MonthlyPaymentStat, 0, 12)

	if len(companyIDs) == 0 {
		for i := 1; i <= 12; i++ {
			monthly = append(monthly, MonthlyPaymentStat{
				Label:  monthLabels[i-1],
				Amount: 0,
				Level:  "zero",
				Height: 40,
			})
		}

		return &DashboardData{
			UsersCount:               0,
			CompaniesCount:           0,
			DocumentsCount:           0,
			PaymentsCount:            0,
			TotalDocs:                0,
			TotalPays:                0,
			GlobalBalance:            0,
			MonthlyPayments:          monthly,
			TopDebtors:               []CompanyDebtCard{},
			RecentDocuments:          []models.Document{},
			MonthlyPaymentsYear:      year,
			YearCollectionPercent:    0,
			YearCollectionPercentStr: "0",
			YearCollectionDocs:       0,
			YearCollectionPayments:   0,
			YearCollectionDocsStr:    "0.00",
			YearCollectionPaysStr:    "0.00",
			DebtCompaniesCount:       0,
			TotalDebtAmount:          0,
			PendingDocsCount:         0,
			OverdueDocsCount:         0,
		}, nil
	}

	var companiesCount, documentsCount, paymentsCount int64
	database.DB.Model(&models.Company{}).Where("id IN ?", companyIDs).Count(&companiesCount)
	database.DB.Model(&models.Document{}).Where("company_id IN ?", companyIDs).Count(&documentsCount)
	database.DB.Model(&models.Payment{}).Where("company_id IN ?", companyIDs).Count(&paymentsCount)

	var totalDocs, totalPays float64
	database.DB.Model(&models.Document{}).
		Where("company_id IN ? AND status <> ?", companyIDs, "anulado").
		Select("COALESCE(SUM(total_amount),0)").Scan(&totalDocs)
	database.DB.Model(&models.Payment{}).
		Where("company_id IN ? AND deleted_at IS NULL", companyIDs).
		Select("COALESCE(SUM(amount),0)").Scan(&totalPays)

	var maxAmount float64
	var minAmount *float64

	for i := 1; i <= 12; i++ {
		start := time.Date(year, time.Month(i), 1, 0, 0, 0, 0, time.Local)
		end := start.AddDate(0, 1, 0)
		var sum float64
		database.DB.Model(&models.Payment{}).
			Where("company_id IN ?", companyIDs).
			Where("date >= ? AND date < ?", start, end).
			Select("COALESCE(SUM(amount),0)").Scan(&sum)

		if sum > maxAmount {
			maxAmount = sum
		}
		if minAmount == nil || sum < *minAmount {
			v := sum
			minAmount = &v
		}

		monthly = append(monthly, MonthlyPaymentStat{
			Label:  monthLabels[i-1],
			Amount: sum,
			Level:  "mid",
			Height: 0,
		})
	}

	if maxAmount == 0 {
		for i := range monthly {
			monthly[i].Level = "zero"
		}
	} else if minAmount != nil {
		for i := range monthly {
			switch {
			case monthly[i].Amount == maxAmount:
				monthly[i].Level = "max"
			case monthly[i].Amount == 0:
				monthly[i].Level = "zero"
			default:
				monthly[i].Level = "mid"
			}
		}
	}

	for i := range monthly {
		if maxAmount == 0 {
			monthly[i].Height = 40
			continue
		}
		ratio := 0.0
		if monthly[i].Amount > 0 {
			ratio = monthly[i].Amount / maxAmount
		}
		base := 20.0
		span := 80.0
		h := int(base + ratio*span)
		if h < 10 {
			h = 10
		}
		if h > 100 {
			h = 100
		}
		monthly[i].Height = h
	}

	yearStart := time.Date(year, time.January, 1, 0, 0, 0, 0, time.Local)
	yearEnd := yearStart.AddDate(1, 0, 0)

	var yearDocs, yearPays float64
	database.DB.Model(&models.Document{}).
		Where("company_id IN ?", companyIDs).
		Where("issue_date >= ? AND issue_date < ? AND status <> ?", yearStart, yearEnd, "anulado").
		Select("COALESCE(SUM(total_amount),0)").Scan(&yearDocs)
	database.DB.Model(&models.Payment{}).
		Where("company_id IN ?", companyIDs).
		Where("date >= ? AND date < ? AND deleted_at IS NULL", yearStart, yearEnd).
		Select("COALESCE(SUM(amount),0)").Scan(&yearPays)

	collectionPercent := 0.0
	if yearDocs > 0 {
		collectionPercent = (yearPays / yearDocs) * 100
		if collectionPercent > 100 {
			collectionPercent = 100
		}
	}
	collectionPercentStr := fmt.Sprintf("%.0f", collectionPercent)
	yearPaysStr := fmt.Sprintf("%.2f", yearPays)
	yearDocsStr := fmt.Sprintf("%.2f", yearDocs)

	finService := services.NewFinanceService()
	var companies []models.Company
	if err := database.DB.
		Where("id IN ?", companyIDs).
		Order("business_name ASC").
		Find(&companies).Error; err != nil {
		companies = []models.Company{}
	}
	debtCards := make([]CompanyDebtCard, 0, 10)
	var totalDebt float64
	for _, cmp := range companies {
		bal, err := finService.GetCompanyBalance(cmp.ID)
		if err != nil {
			continue
		}
		if bal.Balance <= 0 {
			continue
		}
		totalDebt += bal.Balance
		maxLag, oldestYM, _ := finService.MaxPeriodLagMonthsForCompany(cmp.ID)
		debtCards = append(debtCards, CompanyDebtCard{
			Company:              bal.Company,
			TotalDocuments:       bal.TotalDocuments,
			TotalPayments:        bal.TotalPayments,
			Balance:              bal.Balance,
			MaxOverdueMonths:     maxLag,
			HasOverdue:           maxLag > 0,
			OldestOpenDebtPeriod: oldestYM,
		})
	}

	allDebtCompaniesCount := len(debtCards)
	debtCards = filterSortLimitDebtors(debtCards, minOverdueMonths, 10)

	var recentDocs []models.Document
	if err := database.DB.
		Preload("Company").
		Where("company_id IN ?", companyIDs).
		Order("issue_date DESC, id DESC").
		Limit(5).
		Find(&recentDocs).Error; err != nil {
		recentDocs = []models.Document{}
	}

	var pendingDocsCount, overdueDocsCount int64
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	openStatuses := []string{"pendiente", "parcial"}

	database.DB.Model(&models.Document{}).
		Where("company_id IN ?", companyIDs).
		Where("status IN ? AND (due_date IS NULL OR due_date >= ?)", openStatuses, startOfToday).
		Count(&pendingDocsCount)
	database.DB.Model(&models.Document{}).
		Where("company_id IN ?", companyIDs).
		Where("status IN ? AND due_date IS NOT NULL AND due_date < ?", openStatuses, startOfToday).
		Count(&overdueDocsCount)

	return &DashboardData{
		UsersCount:               0,
		CompaniesCount:           companiesCount,
		DocumentsCount:           documentsCount,
		PaymentsCount:            paymentsCount,
		TotalDocs:                totalDocs,
		TotalPays:                totalPays,
		GlobalBalance:            totalDocs - totalPays,
		MonthlyPayments:          monthly,
		TopDebtors:               debtCards,
		RecentDocuments:          recentDocs,
		MonthlyPaymentsYear:      year,
		YearCollectionPercent:    collectionPercent,
		YearCollectionPercentStr: collectionPercentStr,
		YearCollectionDocs:       yearDocs,
		YearCollectionPayments:   yearPays,
		YearCollectionDocsStr:    yearDocsStr,
		YearCollectionPaysStr:    yearPaysStr,
		DebtCompaniesCount:       allDebtCompaniesCount,
		TotalDebtAmount:          totalDebt,
		PendingDocsCount:         pendingDocsCount,
		OverdueDocsCount:         overdueDocsCount,
	}, nil
}

func parseMinOverdueMonthsQuery(c fiber.Ctx) int {
	raw := c.Query("min_overdue_months")
	if raw == "" {
		return 0
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return 0
	}
	return v
}

func (ctrl *DashboardController) HomeAPI(c fiber.Ctx) error {
	minOvd := parseMinOverdueMonthsQuery(c)
	if isAdmin(c) {
		data, err := ctrl.getDashboardData(minOvd)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(data)
	}

	userID, err := getUserID(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "No autenticado"})
	}

	accessService := services.NewAccessService()
	companyIDs, err := accessService.GetAllowedCompanyIDs(userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	data, err := ctrl.getDashboardDataForCompanyIDs(companyIDs, minOvd)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(data)
}
