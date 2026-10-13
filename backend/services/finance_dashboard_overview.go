package services

import (
	"sort"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"
)

// Dashboard financiero rediseñado ("panel de cobranza"): una sola respuesta con lo que hace falta para
// decidir a quién cobrar — facturado vs. cobrado por mes, deuda vencida y por vencer EN SOLES,
// antigüedad de la deuda, empresas por cobrar, lo que vence esta semana, movimientos recientes y (solo
// administrador) la deuda por responsable.
//
// Todo se calcula en consultas agrupadas (una pasada sobre los documentos con saldo), no empresa por
// empresa. Las reglas son las del resto del sistema: un documento "con deuda" es pendiente/parcial,
// activo (no fusionado/archivado) y con saldo; "vencido" = tiene fecha de vencimiento anterior a hoy;
// el atraso por período usa el mismo cálculo que MaxPeriodLagMonthsForCompany.

type FinanceMonthStat struct {
	Month     int     `json:"month"` // 1..12
	Label     string  `json:"label"`
	Billed    float64 `json:"billed"`
	Collected float64 `json:"collected"`
	// StudioPct % cobrado del estudio completo en ese mes — solo para quien no tiene alcance de
	// estudio (referencia para compararse); 0 si no aplica.
	StudioPct float64 `json:"studio_pct,omitempty"`
}

type FinanceAgingBucket struct {
	Key       string  `json:"key"` // current | lag1 | lag2 | lag3plus
	Label     string  `json:"label"`
	Amount    float64 `json:"amount"`
	Companies int64   `json:"companies"`
}

type FinanceDebtor struct {
	CompanyID            uint    `json:"company_id"`
	Code                 string  `json:"code"`
	RUC                  string  `json:"ruc"`
	BusinessName         string  `json:"business_name"`
	TradeName            string  `json:"trade_name,omitempty"`
	Balance              float64 `json:"balance"`
	MaxOverdueMonths     int     `json:"max_overdue_months"`
	OldestOpenDebtPeriod string  `json:"oldest_open_debt_period,omitempty"`
}

type FinanceDueSoon struct {
	DocumentID   uint    `json:"document_id"`
	CompanyID    uint    `json:"company_id"`
	Company      string  `json:"company"`
	DocumentType string  `json:"document_type"`
	Number       string  `json:"number"`
	DueDate      string  `json:"due_date"`
	DaysLeft     int     `json:"days_left"`
	Balance      float64 `json:"balance"`
}

type FinanceMovement struct {
	Kind    string    `json:"kind"` // pago | deuda
	Company string    `json:"company"`
	What    string    `json:"what"`
	Date    string    `json:"date"`
	Amount  float64   `json:"amount"`
	At      time.Time `json:"-"`
}

type FinanceOwnerRow struct {
	UserID  uint    `json:"user_id"`
	Name    string  `json:"name"`
	Balance float64 `json:"balance"`
	Overdue float64 `json:"overdue"`
}

type FinanceDashboardOverview struct {
	Year      int   `json:"year"`
	Studio    bool  `json:"studio"`
	Companies int64 `json:"companies"`
	Documents int64 `json:"documents_count"`
	Payments  int64 `json:"payments_count"`

	YearBilled        float64 `json:"year_billed"`
	YearCollected     float64 `json:"year_collected"`
	YearCollectionPct float64 `json:"year_collection_pct"`
	// PrevYearCollectionPct cobranza del año anterior a esta misma fecha (para la variación).
	PrevYearCollectionPct float64            `json:"prev_year_collection_pct"`
	StudioYearPct         float64            `json:"studio_year_pct,omitempty"`
	Months                []FinanceMonthStat `json:"months"`

	Balance           float64 `json:"balance"`
	TotalDocs         float64 `json:"total_docs"`
	TotalPays         float64 `json:"total_pays"`
	Overdue           float64 `json:"overdue"`
	OverdueDocs       int64   `json:"overdue_docs"`
	DueNext30         float64 `json:"due_next_30"`
	DueNext30Docs     int64   `json:"due_next_30_docs"`
	CompaniesWithDebt int64   `json:"companies_with_debt"`
	CompaniesLag3Plus int64   `json:"companies_lag_3_plus"`
	Lag3PlusAmount    float64 `json:"lag_3_plus_amount"`

	CollectedThisMonth      float64 `json:"collected_this_month"`
	CollectedPrevMonthToDay float64 `json:"collected_prev_month_to_day"`
	CollectedPrevMonthFull  float64 `json:"collected_prev_month_full"`
	CurrentDay              int     `json:"current_day"`
	DaysInMonth             int     `json:"days_in_month"`

	Aging        []FinanceAgingBucket `json:"aging"`
	Debtors      []FinanceDebtor      `json:"debtors"`
	DueSoon      []FinanceDueSoon     `json:"due_soon"`
	DueSoonTotal float64              `json:"due_soon_total"`
	Movements    []FinanceMovement    `json:"movements"`
	Owners       []FinanceOwnerRow    `json:"owners"`
}

var financeMonthLabels = []string{"Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
}

// sumBetween suma documentos facturados / pagos cobrados en un rango [from, to).
func financeSums(companyIDs []uint, from, to time.Time) (billed, collected float64) {
	dq := database.DB.Model(&models.Document{}).
		Where("issue_date >= ? AND issue_date < ? AND status <> ?", from, to, "anulado")
	pq := database.DB.Model(&models.Payment{}).Where("date >= ? AND date < ? AND voided_at IS NULL", from, to)
	if companyIDs != nil {
		dq = dq.Where("company_id IN ?", companyIDs)
		pq = pq.Where("company_id IN ?", companyIDs)
	}
	dq.Select("COALESCE(SUM(total_amount),0)").Scan(&billed)
	pq.Select("COALESCE(SUM(amount),0)").Scan(&collected)
	return
}

func pctOf(part, whole float64) float64 {
	if whole <= 0 {
		return 0
	}
	p := part / whole * 100
	if p > 100 {
		p = 100
	}
	return float64(int(p*10+0.5)) / 10
}

// FinanceOverview arma el panel. companyIDs == nil → estudio completo; si no, solo esas empresas.
// minOverdueMonths filtra la lista de empresas por cobrar (atraso mínimo de período).
func (s *FinanceService) FinanceOverview(companyIDs []uint, studio bool, year, minOverdueMonths int) (*FinanceDashboardOverview, error) {
	now := time.Now()
	today := startOfDay(now)
	if year <= 0 || year > now.Year() {
		year = now.Year()
	}
	out := &FinanceDashboardOverview{
		Year: year, Studio: studio, Months: []FinanceMonthStat{}, Aging: []FinanceAgingBucket{}, Debtors: []FinanceDebtor{},
		DueSoon: []FinanceDueSoon{}, Movements: []FinanceMovement{}, Owners: []FinanceOwnerRow{},
		CurrentDay: now.Day(), DaysInMonth: time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, time.Local).Day(),
	}
	if companyIDs != nil && len(companyIDs) == 0 {
		return out, nil
	}
	// ---- conteos para el subtítulo ----
	cq := database.DB.Model(&models.Company{})
	dcq := database.DB.Model(&models.Document{})
	pcq := database.DB.Model(&models.Payment{})
	if companyIDs != nil {
		cq = cq.Where("id IN ?", companyIDs)
		dcq = dcq.Where("company_id IN ?", companyIDs)
		pcq = pcq.Where("company_id IN ?", companyIDs)
	}
	cq.Count(&out.Companies)
	dcq.Count(&out.Documents)
	pcq.Count(&out.Payments)

	// ---- facturado / cobrado por mes del año ----
	lastMonth := 12
	if year == now.Year() {
		lastMonth = int(now.Month())
	}
	for m := 1; m <= lastMonth; m++ {
		from := time.Date(year, time.Month(m), 1, 0, 0, 0, 0, time.Local)
		b, c := financeSums(companyIDs, from, from.AddDate(0, 1, 0))
		out.Months = append(out.Months, FinanceMonthStat{Month: m, Label: financeMonthLabels[m-1], Billed: b, Collected: c})
		out.YearBilled += b
		out.YearCollected += c
	}
	out.YearCollectionPct = pctOf(out.YearCollected, out.YearBilled)

	// Año anterior a la misma fecha.
	prevFrom := time.Date(year-1, 1, 1, 0, 0, 0, 0, time.Local)
	prevTo := time.Date(year-1, now.Month(), now.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, 1)
	if year != now.Year() {
		prevTo = time.Date(year, 1, 1, 0, 0, 0, 0, time.Local)
	}
	pb, pc := financeSums(companyIDs, prevFrom, prevTo)
	out.PrevYearCollectionPct = pctOf(pc, pb)

	// Referencia del estudio para quien solo ve su cartera.
	if !studio {
		for i := range out.Months {
			from := time.Date(year, time.Month(out.Months[i].Month), 1, 0, 0, 0, 0, time.Local)
			b, c := financeSums(nil, from, from.AddDate(0, 1, 0))
			out.Months[i].StudioPct = pctOf(c, b)
		}
		yb, yc := financeSums(nil, time.Date(year, 1, 1, 0, 0, 0, 0, time.Local), time.Date(year+1, 1, 1, 0, 0, 0, 0, time.Local))
		out.StudioYearPct = pctOf(yc, yb)
	}

	// ---- cobrado este mes vs. mismo día del mes anterior ----
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
	_, out.CollectedThisMonth = financeSums(companyIDs, monthStart, today.AddDate(0, 0, 1))
	prevMonthStart := monthStart.AddDate(0, -1, 0)
	prevDays := time.Date(prevMonthStart.Year(), prevMonthStart.Month()+1, 0, 0, 0, 0, 0, time.Local).Day()
	day := now.Day()
	if day > prevDays {
		day = prevDays
	}
	_, out.CollectedPrevMonthToDay = financeSums(companyIDs, prevMonthStart, prevMonthStart.AddDate(0, 0, day))
	_, out.CollectedPrevMonthFull = financeSums(companyIDs, prevMonthStart, monthStart)

	// ---- totales históricos (como el dashboard anterior) ----
	dtq := database.DB.Model(&models.Document{}).Where("status <> ?", "anulado")
	ptq := database.DB.Model(&models.Payment{}).Where("voided_at IS NULL")
	if companyIDs != nil {
		dtq = dtq.Where("company_id IN ?", companyIDs)
		ptq = ptq.Where("company_id IN ?", companyIDs)
	}
	dtq.Select("COALESCE(SUM(total_amount),0)").Scan(&out.TotalDocs)
	ptq.Select("COALESCE(SUM(amount),0)").Scan(&out.TotalPays)

	// ---- documentos con saldo (una sola pasada) ----
	oq := database.DB.Preload("Company").Where("status IN ?", []string{"pendiente", "parcial"})
	if companyIDs != nil {
		oq = oq.Where("company_id IN ?", companyIDs)
	}
	var open []models.Document
	if err := oq.Find(&open).Error; err != nil {
		return nil, err
	}

	type debtorAgg struct {
		debtor  FinanceDebtor
		lagMax  int
		oldest  string
		haveOld bool
	}
	debtorBy := map[uint]*debtorAgg{}
	lagCompanies := [4]map[uint]struct{}{{}, {}, {}, {}}
	agingAmt := [4]float64{}
	ownerBalance := map[uint]float64{}
	ownerOverdue := map[uint]float64{}
	ownerOf := map[uint]uint{} // company -> supervisor (0 = sin asignar)
	soon := []FinanceDueSoon{}
	in30 := today.AddDate(0, 0, 30)
	weekEnd := today.AddDate(0, 0, 7)

	debtSvc := debtsvc.NewService()
	for i := range open {
		d := &open[i]
		if !debtsvc.IsActiveDebt(d) {
			continue
		}
		bal := d.BalanceAmount
		if bal <= 0.005 {
			bal = debtSvc.EffectiveBalance(database.DB, d)
		}
		if bal <= 0.005 {
			continue
		}
		out.Balance += bal

		overdue := false
		if d.DueDate != nil && !d.DueDate.IsZero() {
			due := startOfDay(*d.DueDate)
			switch {
			case due.Before(today):
				overdue = true
				out.Overdue += bal
				out.OverdueDocs++
			case due.Before(in30):
				out.DueNext30 += bal
				out.DueNext30Docs++
			}
			if !due.Before(today) && due.Before(weekEnd) {
				name := ""
				if d.Company != nil {
					name = strings.TrimSpace(d.Company.BusinessName)
				}
				soon = append(soon, FinanceDueSoon{
					DocumentID: d.ID, CompanyID: d.CompanyID, Company: name, DocumentType: d.Type, Number: d.Number,
					DueDate: due.Format("2006-01-02"), DaysLeft: int(due.Sub(today).Hours() / 24), Balance: bal,
				})
			}
		}

		lag := 0
		if y, m, ok := documentDebtPeriodYM(*d); ok {
			lag = monthsPeriodBehindDebt(now, y, m)
			if lag < 0 {
				lag = 0
			}
		}
		bucket := lag
		if bucket > 3 {
			bucket = 3
		}
		agingAmt[bucket] += bal
		lagCompanies[bucket][d.CompanyID] = struct{}{}

		agg := debtorBy[d.CompanyID]
		if agg == nil {
			agg = &debtorAgg{}
			if d.Company != nil {
				agg.debtor = FinanceDebtor{
					CompanyID: d.CompanyID, Code: strings.TrimSpace(d.Company.InternalCode), RUC: strings.TrimSpace(d.Company.RUC),
					BusinessName: strings.TrimSpace(d.Company.BusinessName), TradeName: strings.TrimSpace(d.Company.TradeName),
				}
				if d.Company.SupervisorUserID != nil {
					ownerOf[d.CompanyID] = *d.Company.SupervisorUserID
				}
			} else {
				agg.debtor = FinanceDebtor{CompanyID: d.CompanyID}
			}
			debtorBy[d.CompanyID] = agg
		}
		agg.debtor.Balance += bal
		if lag > agg.lagMax {
			agg.lagMax = lag
		}
		if y, m, ok := documentDebtPeriodYM(*d); ok {
			ym := time.Date(y, m, 1, 0, 0, 0, 0, time.Local).Format("2006-01")
			if !agg.haveOld || ym < agg.oldest {
				agg.oldest, agg.haveOld = ym, true
			}
		}
		owner := ownerOf[d.CompanyID]
		ownerBalance[owner] += bal
		if overdue {
			ownerOverdue[owner] += bal
		}
	}
	out.CompaniesWithDebt = int64(len(debtorBy))

	keys := []string{"current", "lag1", "lag2", "lag3plus"}
	labels := []string{"Período actual", "1 mes de atraso", "2 meses de atraso", "3 meses o más"}
	for i := 0; i < 4; i++ {
		out.Aging = append(out.Aging, FinanceAgingBucket{Key: keys[i], Label: labels[i], Amount: agingAmt[i], Companies: int64(len(lagCompanies[i]))})
	}
	out.CompaniesLag3Plus = int64(len(lagCompanies[3]))
	out.Lag3PlusAmount = agingAmt[3]

	// ---- empresas por cobrar (top 10, filtro por atraso mínimo) ----
	all := make([]FinanceDebtor, 0, len(debtorBy))
	for _, agg := range debtorBy {
		deb := agg.debtor
		deb.MaxOverdueMonths = agg.lagMax
		deb.OldestOpenDebtPeriod = agg.oldest
		if minOverdueMonths > 0 && deb.MaxOverdueMonths < minOverdueMonths {
			continue
		}
		all = append(all, deb)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Balance != all[j].Balance {
			return all[i].Balance > all[j].Balance
		}
		return all[i].BusinessName < all[j].BusinessName
	})
	if len(all) > 10 {
		all = all[:10]
	}
	out.Debtors = all

	// ---- para cobrar esta semana ----
	sort.SliceStable(soon, func(i, j int) bool {
		if soon[i].DaysLeft != soon[j].DaysLeft {
			return soon[i].DaysLeft < soon[j].DaysLeft
		}
		return soon[i].Balance > soon[j].Balance
	})
	for _, d := range soon {
		out.DueSoonTotal += d.Balance
	}
	if len(soon) > 6 {
		soon = soon[:6]
	}
	out.DueSoon = soon

	// ---- movimientos recientes (pagos + deudas) ----
	var recentPays []models.Payment
	rpq := database.DB.Preload("Company").Where("voided_at IS NULL").Order("date DESC, id DESC").Limit(6)
	var recentDocs []models.Document
	rdq := database.DB.Preload("Company").Where("status <> ?", "anulado").Order("issue_date DESC, id DESC").Limit(6)
	if companyIDs != nil {
		rpq = rpq.Where("company_id IN ?", companyIDs)
		rdq = rdq.Where("company_id IN ?", companyIDs)
	}
	_ = rpq.Find(&recentPays).Error
	_ = rdq.Find(&recentDocs).Error
	moves := make([]FinanceMovement, 0, 12)
	for _, p := range recentPays {
		name := ""
		if p.Company != nil {
			name = strings.TrimSpace(p.Company.BusinessName)
		}
		what := "Pago"
		if m := strings.TrimSpace(p.Method); m != "" {
			what = "Pago · " + m
		}
		moves = append(moves, FinanceMovement{Kind: "pago", Company: name, What: what, Date: p.Date.Format("2006-01-02"), Amount: p.Amount, At: p.Date})
	}
	for _, d := range recentDocs {
		name := ""
		if d.Company != nil {
			name = strings.TrimSpace(d.Company.BusinessName)
		}
		moves = append(moves, FinanceMovement{Kind: "deuda", Company: name, What: "Deuda " + d.Number, Date: d.IssueDate.Format("2006-01-02"), Amount: d.TotalAmount, At: d.IssueDate})
	}
	sort.SliceStable(moves, func(i, j int) bool { return moves[i].At.After(moves[j].At) })
	if len(moves) > 6 {
		moves = moves[:6]
	}
	out.Movements = moves

	// ---- deuda por responsable (supervisor) — solo administrador ----
	if studio {
		ids := make([]uint, 0, len(ownerBalance))
		for id := range ownerBalance {
			if id > 0 {
				ids = append(ids, id)
			}
		}
		names := map[uint]string{}
		if len(ids) > 0 {
			var users []models.User
			_ = database.DB.Select("id", "name", "username").Where("id IN ?", ids).Find(&users).Error
			for _, u := range users {
				n := strings.TrimSpace(u.Name)
				if n == "" {
					n = strings.TrimSpace(u.Username)
				}
				names[u.ID] = n
			}
		}
		for id, bal := range ownerBalance {
			name := names[id]
			if id == 0 {
				name = "Sin supervisor"
			}
			out.Owners = append(out.Owners, FinanceOwnerRow{UserID: id, Name: name, Balance: bal, Overdue: ownerOverdue[id]})
		}
		sort.Slice(out.Owners, func(i, j int) bool { return out.Owners[i].Balance > out.Owners[j].Balance })
	}
	return out, nil
}
