package services

import (
	"errors"
	"sort"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Panel del asistente ("Mi panel"): una sola respuesta con TODO lo que el asistente tiene que hacer
// en el período, sobre las empresas que tiene asignadas — lista de trabajo ordenada por urgencia
// (vencido → devuelto por el supervisor → por vencer → enviado, esperando revisión), avance por módulo,
// cumplimiento propio y vencimientos de la semana. Mismos módulos y mismas reglas de puntualidad que
// el resto del sistema; no hay estados nuevos.

type AssistantWorkItem struct {
	CompanyID     uint   `json:"company_id"`
	Company       string `json:"company"`
	RUC           string `json:"ruc"`
	ModuleKey     string `json:"module_key"`
	ModuleLabel   string `json:"module_label"`
	DeclarationID uint   `json:"declaration_id,omitempty"`
	// State: vencida | observada | pendiente | por_revisar
	State       string `json:"state"`
	DueDate     string `json:"due_date,omitempty"`
	DaysLeft    *int   `json:"days_left,omitempty"`
	Note        string `json:"note,omitempty"`
	NoteBy      string `json:"note_by,omitempty"`
	SubmittedAt string `json:"submitted_at,omitempty"`
}

type AssistantCounts struct {
	ToDeliver    int64 `json:"to_deliver"` // pendientes + vencidas
	Overdue      int64 `json:"overdue"`
	OverdueOver3 int64 `json:"overdue_over_3_days"`
	Observed     int64 `json:"observed"`
	InReview     int64 `json:"in_review"`
	DueThisWeek  int64 `json:"due_this_week"`
}

type AssistantOverview struct {
	Companies  int64                  `json:"companies"`
	Compliance ComplianceSummary      `json:"compliance"`
	Trend      []ComplianceTrendPoint `json:"trend"`
	Modules    []DashboardModuleRow   `json:"modules"`
	Counts     AssistantCounts        `json:"counts"`
	Work       []AssistantWorkItem    `json:"work"`
	Upcoming   []DashboardUpcoming    `json:"upcoming"`
}

var assistantWorkRank = map[string]int{"vencida": 0, "observada": 1, "pendiente": 2, "por_revisar": 3}

// classifyWork decide si una empresa-módulo es trabajo pendiente del asistente y en qué estado.
func classifyWork(status, timeliness string, exempt bool) (string, bool) {
	if exempt {
		return "", false
	}
	switch status {
	case models.SupervisorDeclEntregado, models.SupervisorDeclAprobado, models.SupervisorDeclPresentado,
		models.SupervisorDeclCerrado, models.SupervisorDetraccionVerificado:
		return "", false
	case models.SupervisorDeclObservado:
		return "observada", true
	case models.SupervisorDeclPorRevisar, models.SupervisorDetraccionCargado:
		return "por_revisar", true
	}
	if timeliness == TimelinessMissing {
		return "vencida", true
	}
	return "pendiente", true
}

func daysUntil(t time.Time, today time.Time) int {
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
	return int(day.Sub(today).Hours() / 24)
}

// calendarDeadlineFor fecha límite (con la regla de plazo) de la actividad del calendario que le toca a
// un dígito de RUC.
func calendarDeadlineFor(periodYM string, acts []models.FinanceCalendarActivity, dig string, cache map[uint]*time.Time) *time.Time {
	act := PickCalendarActivityByDigit(acts, pdt601DigitFromString(dig))
	if act == nil {
		return nil
	}
	if d, ok := cache[act.ID]; ok {
		return d
	}
	var out *time.Time
	if due, err := dueDateForActivity(periodYM, act.DueDay); err == nil {
		if rule, err := LoadActiveActivityRule(act.ActivityRuleID); err == nil && rule != nil {
			due = BuildUploadDeadline(due, rule)
		}
		out = &due
	}
	cache[act.ID] = out
	return out
}

func (s *SupervisorService) dashboardModuleRows(p SupervisorDashboardParams, companies []models.Company) ([]DashboardModuleRow, error) {
	var (
		pdtSum                   map[string]PdtTypeSummary
		detSum, mailboxSum       ComplianceSummary
		informeRows, siscontRows []PdfReportListRow
	)
	tasks := []func() error{
		func() (err error) { pdtSum, err = s.PdtDashboardSummary(p); return },
		func() (err error) { detSum, err = s.DetraccionesDashboardSummary(p); return },
		func() (err error) { mailboxSum, err = s.SunatInboxDashboardSummary(p); return },
		func() error {
			informeRows = s.pdfReportBuildRows(PdfReportInformeDetracciones, companies, p.PeriodYM)
			return nil
		},
		func() error {
			siscontRows = s.pdfReportBuildRows(PdfReportSiscontBalances, companies, p.PeriodYM)
			return nil
		},
	}
	if err := runParallel(5, tasks); err != nil {
		return nil, err
	}
	return []DashboardModuleRow{
		moduleRowFromPdt(models.SupervisorDeclPDT601, "PDT 601", pdtSum[models.SupervisorDeclPDT601]),
		moduleRowFromPdt(models.SupervisorDeclPDT621, "PDT 621", pdtSum[models.SupervisorDeclPDT621]),
		moduleRowFromCompliance(models.SupervisorDeclDetracciones, "Detracciones", detSum),
		moduleRowFromCompliance(models.SupervisorDeclSunatInbox, "Buzón SOL", mailboxSum),
		moduleRowFromPdf(PdfReportInformeDetracciones, informeRows),
		moduleRowFromPdf(PdfReportSiscontBalances, siscontRows),
	}, nil
}

// AssistantOverview arma el panel del asistente. p.AllowedCompanyIDs son SUS empresas (nunca el alcance
// de estudio): quien llama lo resuelve con las asignaciones del usuario.
func (s *SupervisorService) AssistantOverview(p SupervisorDashboardParams) (*AssistantOverview, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	companies, err := s.dashboardScopeCompanies(p)
	if err != nil {
		return nil, err
	}
	out := &AssistantOverview{Companies: int64(len(companies)), Modules: []DashboardModuleRow{}, Work: []AssistantWorkItem{}, Upcoming: []DashboardUpcoming{}}
	if len(companies) == 0 {
		return out, nil
	}

	var (
		pdt601 []Pdt601ListRow
		pdt621 []Pdt621ListRow
		det    []DetraccionesListRow
		inf    []PdfReportListRow
		sis    []PdfReportListRow
		cs     ComplianceSummary
		trend  []ComplianceTrendPoint
		mods   []DashboardModuleRow
		up     []DashboardUpcoming
	)
	tasks := []func() error{
		func() (err error) { pdt601, err = s.pdt601BuildRows(companies, p.PeriodYM); return },
		func() (err error) { pdt621, err = s.pdt621BuildRows(companies, p.PeriodYM); return },
		func() (err error) { det, err = s.detraccionesBuildRows(companies, p.PeriodYM); return },
		func() error {
			inf = s.pdfReportBuildRows(PdfReportInformeDetracciones, companies, p.PeriodYM)
			return nil
		},
		func() error { sis = s.pdfReportBuildRows(PdfReportSiscontBalances, companies, p.PeriodYM); return nil },
		func() (err error) { cs, err = s.MonthlyComplianceSummary(p); return },
		func() (err error) { trend, err = s.ComplianceTrend(p, 6); return },
		func() (err error) { mods, err = s.dashboardModuleRows(p, companies); return },
		func() error { up = s.dashboardUpcoming(p.PeriodYM, companies); return nil },
	}
	if err := runParallel(8, tasks); err != nil {
		return nil, err
	}
	out.Compliance, out.Trend, out.Modules, out.Upcoming = cs, trend, mods, up

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	cache := map[uint]*time.Time{}
	acts601, _ := CalendarActivitiesForType(p.PeriodYM, models.CalendarActivityPDT601)
	acts621, _ := CalendarActivitiesForType(p.PeriodYM, models.CalendarActivityPDT621)

	items := []AssistantWorkItem{}
	add := func(companyID uint, company, ruc, key, label string, declID *uint, state string, due *time.Time) {
		it := AssistantWorkItem{CompanyID: companyID, Company: strings.TrimSpace(company), RUC: ruc, ModuleKey: key, ModuleLabel: label, State: state}
		if declID != nil {
			it.DeclarationID = *declID
		}
		if due != nil {
			it.DueDate = due.Format("2006-01-02")
			d := daysUntil(*due, today)
			it.DaysLeft = &d
		}
		items = append(items, it)
	}

	for _, r := range pdt601 {
		exempt := r.Suspendida || (r.Planilla != nil && r.Planilla.SinPlanilla)
		if st, ok := classifyWork(r.Status, r.Timeliness, exempt); ok {
			add(r.CompanyID, r.BusinessName, r.RUC, models.SupervisorDeclPDT601, "PDT 601", r.DeclarationID, st, calendarDeadlineFor(p.PeriodYM, acts601, r.Dig, cache))
		}
	}
	for _, r := range pdt621 {
		if st, ok := classifyWork(r.Status, r.AssistantTimeliness, r.Suspendida); ok {
			add(r.CompanyID, r.BusinessName, r.RUC, models.SupervisorDeclPDT621, "PDT 621", r.DeclarationID, st, calendarDeadlineFor(p.PeriodYM, acts621, r.Dig, cache))
		}
	}
	for _, r := range det {
		exempt := r.Suspendida || detraccionesIsExemptStatus(r.Status)
		if st, ok := classifyWork(r.Status, r.Timeliness.Timeliness, exempt); ok {
			add(r.CompanyID, r.BusinessName, r.RUC, models.SupervisorDeclDetracciones, "Detracciones", r.DeclarationID, st, r.Timeliness.DueAt)
		}
	}
	for _, pair := range []struct {
		mod  PdfReportModule
		rows []PdfReportListRow
	}{{PdfReportInformeDetracciones, inf}, {PdfReportSiscontBalances, sis}} {
		for _, r := range pair.rows {
			if st, ok := classifyWork(r.Status, r.Timeliness, r.Suspendida); ok {
				var due *time.Time
				if r.DueDate != nil {
					if t := pdt601ParseDate(*r.DueDate); t != nil {
						due = t
					}
				}
				add(r.CompanyID, r.BusinessName, r.RUC, pair.mod.DeclType, pair.mod.Label, r.DeclarationID, st, due)
			}
		}
	}

	s.attachWorkNotes(items)

	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if assistantWorkRank[a.State] != assistantWorkRank[b.State] {
			return assistantWorkRank[a.State] < assistantWorkRank[b.State]
		}
		ad, bd := 9999, 9999
		if a.DaysLeft != nil {
			ad = *a.DaysLeft
		}
		if b.DaysLeft != nil {
			bd = *b.DaysLeft
		}
		if ad != bd {
			return ad < bd
		}
		return a.Company < b.Company
	})

	for _, it := range items {
		switch it.State {
		case "vencida":
			out.Counts.ToDeliver++
			out.Counts.Overdue++
			if it.DaysLeft != nil && *it.DaysLeft < -3 {
				out.Counts.OverdueOver3++
			}
		case "pendiente":
			out.Counts.ToDeliver++
			if it.DaysLeft != nil && *it.DaysLeft >= 0 && *it.DaysLeft <= 7 {
				out.Counts.DueThisWeek++
			}
		case "observada":
			out.Counts.Observed++
		case "por_revisar":
			out.Counts.InReview++
		}
	}
	if len(items) > 300 {
		items = items[:300]
	}
	out.Work = items
	return out, nil
}

// attachWorkNotes completa, para las entregas observadas, el comentario del supervisor y quién lo hizo.
func (s *SupervisorService) attachWorkNotes(items []AssistantWorkItem) {
	ids := []uint{}
	for _, it := range items {
		if it.State == "observada" && it.DeclarationID > 0 {
			ids = append(ids, it.DeclarationID)
		}
	}
	if len(ids) == 0 {
		return
	}
	var decls []models.SupervisorDeclaration
	_ = database.DB.Select("id", "notes", "approver_user_id").Where("id IN ?", ids).Find(&decls).Error
	approverIDs := []uint{}
	for _, d := range decls {
		if d.ApproverUserID != nil {
			approverIDs = append(approverIDs, *d.ApproverUserID)
		}
	}
	names := s.userNames(approverIDs)
	byID := map[uint]models.SupervisorDeclaration{}
	for _, d := range decls {
		byID[d.ID] = d
	}
	for i := range items {
		if d, ok := byID[items[i].DeclarationID]; ok && items[i].State == "observada" {
			items[i].Note = strings.TrimSpace(d.Notes)
			if d.ApproverUserID != nil {
				items[i].NoteBy = names[*d.ApproverUserID]
			}
		}
	}
}
