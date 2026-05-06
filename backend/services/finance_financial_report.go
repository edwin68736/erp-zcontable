package services

import (
	"math"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// FinancialReportParams filtros para el reporte financiero por empresa.
type FinancialReportParams struct {
	DateFrom          *time.Time
	DateToExclusive   *time.Time // issue_date / pago date < este instante
	CompanyID         uint
	MinOverdueMonths  int // 0 = sin filtro; >= N muestra empresas con al menos N meses de atraso respecto al periodo contable del cargo con saldo
	AllowedCompanyIDs []uint
	IsAdmin           bool
}

// FinancialCompanyReportRow una fila del reporte financiero.
type FinancialCompanyReportRow struct {
	Company              models.Company `json:"company"`
	TotalDocuments       float64        `json:"total_documents"`
	TotalPayments        float64        `json:"total_payments"`
	Balance              float64        `json:"balance"`
	MaxOverdueMonths     int            `json:"max_overdue_months"` // meses de atraso vs. periodo del cargo (accounting_period / service_month / emisión)
	HasOverdue           bool           `json:"has_overdue"`        // true si max_overdue_months > 0 según periodo
	OldestOpenDebtPeriod string         `json:"oldest_open_debt_period"`
}

// monthsOverdueCalendar meses completos de calendario desde la fecha de vencimiento hasta hoy (deuda vencida).
func monthsOverdueCalendar(due time.Time, now time.Time) int {
	loc := now.Location()
	dueDay := time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, loc)
	nowDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	if !dueDay.Before(nowDay) {
		return 0
	}
	y1, m1, d1 := dueDay.Date()
	y2, m2, d2 := nowDay.Date()
	months := (y2-y1)*12 + int(m2-m1)
	if d2 < d1 {
		months--
	}
	if months < 0 {
		return 0
	}
	return months
}

// documentDebtPeriodYM año y mes del periodo de la deuda: accounting_period, service_month o mes de emisión.
func documentDebtPeriodYM(d models.Document) (year int, month time.Month, ok bool) {
	s := strings.TrimSpace(d.AccountingPeriod)
	if s == "" {
		s = strings.TrimSpace(d.ServiceMonth)
	}
	if len(s) >= 7 {
		if t, err := time.ParseInLocation("2006-01", s[:7], time.Local); err == nil {
			return t.Year(), t.Month(), true
		}
	}
	if !d.IssueDate.IsZero() {
		return d.IssueDate.Year(), d.IssueDate.Month(), true
	}
	return 0, 0, false
}

func monthsPeriodBehindDebt(now time.Time, year int, month time.Month) int {
	cur := now.Year()*12 + int(now.Month())
	per := year*12 + int(month)
	return cur - per
}

// MaxPeriodLagMonthsForCompany máximo atraso en meses calendario entre el periodo de cada documento con saldo y el mes actual.
// Devuelve también el periodo YYYY-MM más antiguo entre documentos pendiente/parcial con saldo.
func (s *FinanceService) MaxPeriodLagMonthsForCompany(companyID uint) (maxLag int, oldestYM string, hasOpenDebt bool) {
	var docs []models.Document
	if err := database.DB.Where("company_id = ? AND status IN ?", companyID, []string{"pendiente", "parcial"}).Find(&docs).Error; err != nil {
		return 0, "", false
	}
	now := time.Now()
	oldestYM = ""
	haveOldest := false
	for _, d := range docs {
		bal := d.TotalAmount - DocumentPaidTotal(database.DB, d.ID)
		if bal <= 0.005 {
			continue
		}
		y, m, ok := documentDebtPeriodYM(d)
		if !ok {
			continue
		}
		hasOpenDebt = true
		ym := time.Date(y, m, 1, 0, 0, 0, 0, time.Local).Format("2006-01")
		if !haveOldest || ym < oldestYM {
			oldestYM = ym
			haveOldest = true
		}
		lag := monthsPeriodBehindDebt(now, y, m)
		if lag < 0 {
			lag = 0
		}
		if lag > maxLag {
			maxLag = lag
		}
	}
	if !haveOldest {
		return 0, "", false
	}
	return maxLag, oldestYM, hasOpenDebt
}

// MaxOverdueMonthsForCompany meses máximos de retraso en documentos pendientes/parciales con saldo y vencimiento pasado.
func (s *FinanceService) MaxOverdueMonthsForCompany(companyID uint) (int, bool) {
	var docs []models.Document
	if err := database.DB.Where("company_id = ? AND status IN ?", companyID, []string{"pendiente", "parcial"}).Find(&docs).Error; err != nil {
		return 0, false
	}
	now := time.Now()
	maxM := 0
	hasOverdue := false
	for _, d := range docs {
		if d.DueDate == nil || d.DueDate.IsZero() {
			continue
		}
		bal := d.TotalAmount - DocumentPaidTotal(database.DB, d.ID)
		if bal <= 0.005 {
			continue
		}
		due := *d.DueDate
		m := monthsOverdueCalendar(due, now)
		if m > 0 {
			hasOverdue = true
		}
		if m > maxM {
			maxM = m
		}
	}
	return maxM, hasOverdue
}

func companyTotalsForReport(companyID uint, dateFrom, dateToExclusive *time.Time) (totalDocs, totalPays float64) {
	dq := database.DB.Model(&models.Document{}).Where("company_id = ? AND status <> ?", companyID, "anulado")
	if dateFrom != nil {
		dq = dq.Where("issue_date >= ?", *dateFrom)
	}
	if dateToExclusive != nil {
		dq = dq.Where("issue_date < ?", *dateToExclusive)
	}
	dq.Select("COALESCE(SUM(total_amount),0)").Scan(&totalDocs)

	pq := database.DB.Model(&models.Payment{}).Where("company_id = ?", companyID)
	if dateFrom != nil {
		pq = pq.Where("date >= ?", *dateFrom)
	}
	if dateToExclusive != nil {
		pq = pq.Where("date < ?", *dateToExclusive)
	}
	pq.Select("COALESCE(SUM(amount),0)").Scan(&totalPays)
	return
}

// GetFinancialReportRows totales por empresa (opcionalmente por rango de fechas) y meses máximos de mora en deudas con saldo.
func (s *FinanceService) GetFinancialReportRows(p FinancialReportParams) (rows []FinancialCompanyReportRow, grandDocs, grandPays, grandBal float64, err error) {
	var companies []models.Company
	q := database.DB.Order("business_name ASC")
	if !p.IsAdmin {
		if len(p.AllowedCompanyIDs) == 0 {
			return nil, 0, 0, 0, nil
		}
		q = q.Where("id IN ?", p.AllowedCompanyIDs)
	}
	if p.CompanyID > 0 {
		q = q.Where("id = ?", p.CompanyID)
	}
	if err = q.Find(&companies).Error; err != nil {
		return nil, 0, 0, 0, err
	}

	rows = make([]FinancialCompanyReportRow, 0, len(companies))
	for _, cpy := range companies {
		td, tp := companyTotalsForReport(cpy.ID, p.DateFrom, p.DateToExclusive)
		td = math.Round(td*100) / 100
		tp = math.Round(tp*100) / 100
		bal := math.Round((td-tp)*100) / 100

		maxLag, oldestYM, _ := s.MaxPeriodLagMonthsForCompany(cpy.ID)
		hasPeriodLag := maxLag > 0
		if p.MinOverdueMonths > 0 && maxLag < p.MinOverdueMonths {
			continue
		}

		rows = append(rows, FinancialCompanyReportRow{
			Company:              cpy,
			TotalDocuments:       td,
			TotalPayments:        tp,
			Balance:              bal,
			MaxOverdueMonths:     maxLag,
			HasOverdue:           hasPeriodLag,
			OldestOpenDebtPeriod: oldestYM,
		})
		grandDocs += td
		grandPays += tp
		grandBal += bal
	}
	grandDocs = math.Round(grandDocs*100) / 100
	grandPays = math.Round(grandPays*100) / 100
	grandBal = math.Round(grandBal*100) / 100
	return rows, grandDocs, grandPays, grandBal, nil
}
