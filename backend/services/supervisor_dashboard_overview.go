package services

import (
	"errors"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Datos del dashboard "propuesta B" (admin y supervisor): un solo endpoint que arma, con el mismo
// alcance y filtros que el resto del dashboard (SupervisorDashboardParams.AllowedCompanyIDs ya
// distingue al administrador —todas las empresas— del supervisor —solo las asignadas—), lo que el
// diseño necesita y las demás consultas no entregan: cola "por revisar", resumen por módulo,
// cumplimiento por supervisor y por asistente, vencimientos próximos y la referencia del estudio.

type DashboardScopeInfo struct {
	Studio            bool  `json:"studio"`
	Companies         int64 `json:"companies"`
	Assistants        int64 `json:"assistants"`
	Supervisors       int64 `json:"supervisors"`
	WithoutSupervisor int64 `json:"without_supervisor"`
}

// DashboardModuleRow estado de un módulo en el alcance. Total = controles aplicables (sin exentos).
type DashboardModuleRow struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Pendiente   int64  `json:"pendiente"`
	Observado   int64  `json:"observado"`
	Vencido     int64  `json:"vencido"`
	ATiempo     int64  `json:"a_tiempo"`
	FueraFecha  int64  `json:"fuera_fecha"`
	Total       int64  `json:"total"`
	SinCompleta int64  `json:"sin_completar"`
}

type DashboardReviewItem struct {
	DeclarationID uint   `json:"declaration_id"`
	CompanyID     uint   `json:"company_id"`
	Company       string `json:"company"`
	ModuleKey     string `json:"module_key"`
	ModuleLabel   string `json:"module_label"`
	Assistant     string `json:"assistant"`
	SubmittedAt   string `json:"submitted_at,omitempty"`
	AgeDays       int    `json:"age_days"`
	Timeliness    string `json:"timeliness"`
}

type DashboardReview struct {
	Total     int64                 `json:"total"`
	Over3Days int64                 `json:"over_3_days"`
	Observed  int64                 `json:"observed"`
	Items     []DashboardReviewItem `json:"items"`
}

type DashboardEntityRow struct {
	UserID         uint              `json:"user_id"`
	Name           string            `json:"name"`
	SupervisorName string            `json:"supervisor_name,omitempty"`
	Companies      int64             `json:"companies"`
	Assistants     int64             `json:"assistants,omitempty"`
	Compliance     ComplianceSummary `json:"compliance"`
	Review         int64             `json:"review"`
}

type DashboardUpcoming struct {
	ModuleKey string `json:"module_key"`
	Label     string `json:"label"`
	DueDate   string `json:"due_date"`
	DaysLeft  int    `json:"days_left"`
	Pending   int64  `json:"pending"`
	Detail    string `json:"detail,omitempty"`
}

type DashboardOverview struct {
	Scope        DashboardScopeInfo     `json:"scope"`
	Review       DashboardReview        `json:"review"`
	Modules      []DashboardModuleRow   `json:"modules"`
	BySupervisor []DashboardEntityRow   `json:"by_supervisor"`
	ByAssistant  []DashboardEntityRow   `json:"by_assistant"`
	Upcoming     []DashboardUpcoming    `json:"upcoming"`
	Trend        []ComplianceTrendPoint `json:"trend"`
	// StudioTrend solo para quien NO tiene alcance de estudio (supervisor): promedio agregado del
	// estudio para compararse — nunca desglosado por otros supervisores.
	StudioTrend []ComplianceTrendPoint `json:"studio_trend,omitempty"`
}

// reviewModules módulos con el enum reducido (por_revisar) que entran en la cola de revisión.
var reviewModules = []struct {
	Key, Label, CalendarType string
}{
	{models.SupervisorDeclPDT601, "PDT 601", models.CalendarActivityPDT601},
	{models.SupervisorDeclPDT621, "PDT 621", models.CalendarActivityPDT621},
	{models.SupervisorDeclInformeDetracciones, "Informe detracciones", models.CalendarActivityInformeDetracciones},
	{models.SupervisorDeclSiscontBalances, "Siscont balances", models.CalendarActivitySiscontBalances},
}

func reviewModuleLabel(key string) (label, calType string) {
	for _, m := range reviewModules {
		if m.Key == key {
			return m.Label, m.CalendarType
		}
	}
	return key, ""
}

// dashboardScopeCompanies empresas activas del estudio dentro del alcance y los filtros del
// dashboard (mismos criterios que DetraccionesDashboardSummary).
func (s *SupervisorService) dashboardScopeCompanies(p SupervisorDashboardParams) ([]models.Company, error) {
	q := database.DB.Model(&models.Company{}).
		Where("client_type = ? AND status = ?", models.CompanyClientTypeEstudio, "activo")
	if p.AllowedCompanyIDs != nil {
		if len(p.AllowedCompanyIDs) == 0 {
			return nil, nil
		}
		q = q.Where("id IN ?", p.AllowedCompanyIDs)
	}
	if p.CompanyID > 0 {
		q = q.Where("id = ?", p.CompanyID)
	}
	if p.GeneralStatus != "" || p.RiskLevel != "" || p.ResponsibleUserID > 0 || p.SupervisorUserID > 0 {
		sub := database.DB.Model(&models.SupervisorMonthlyControl{}).Select("company_id").Where("period_ym = ?", p.PeriodYM)
		if p.GeneralStatus != "" {
			sub = sub.Where("general_status = ?", p.GeneralStatus)
		}
		if p.RiskLevel != "" {
			sub = sub.Where("risk_level = ?", p.RiskLevel)
		}
		if p.ResponsibleUserID > 0 {
			sub = sub.Where("responsible_user_id = ?", p.ResponsibleUserID)
		}
		if p.SupervisorUserID > 0 {
			sub = sub.Where("supervisor_user_id = ?", p.SupervisorUserID)
		}
		q = q.Where("id IN (?)", sub)
	}
	var companies []models.Company
	if err := q.Find(&companies).Error; err != nil {
		return nil, err
	}
	return companies, nil
}

func (s *SupervisorService) userNames(ids []uint) map[uint]string {
	out := map[uint]string{}
	if len(ids) == 0 {
		return out
	}
	var users []models.User
	_ = database.DB.Select("id", "name", "username").Where("id IN ?", ids).Find(&users).Error
	for _, u := range users {
		name := strings.TrimSpace(u.Name)
		if name == "" {
			name = strings.TrimSpace(u.Username)
		}
		out[u.ID] = name
	}
	return out
}

func moduleRowFromCompliance(key, label string, cs ComplianceSummary) DashboardModuleRow {
	row := DashboardModuleRow{Key: key, Label: label, Pendiente: cs.Pending, Vencido: cs.Missing, ATiempo: cs.OnTime, FueraFecha: cs.Late}
	row.Total = cs.Total - cs.Exempt
	row.SinCompleta = row.Pendiente + row.Observado + row.Vencido
	return row
}

func moduleRowFromPdt(key, label string, t PdtTypeSummary) DashboardModuleRow {
	row := DashboardModuleRow{Key: key, Label: label, Pendiente: t.Pendiente, Observado: t.Observado, Vencido: t.Vencido,
		ATiempo: t.EntregadoATiempo, FueraFecha: t.EntregadoFueraDeFecha}
	row.Total = t.Total - t.SinPlanilla - t.Suspendida
	row.SinCompleta = row.Pendiente + row.Observado + row.Vencido
	return row
}

// moduleRowFromPdf clasifica un módulo de informe en PDF (una fila por empresa) con las mismas
// categorías que PDT: completado (entregado) = a tiempo / fuera de fecha; observado; vencido = sin
// entregar y fuera de plazo; el resto, pendiente. Suspendida queda fuera del total.
func moduleRowFromPdf(mod PdfReportModule, rows []PdfReportListRow) DashboardModuleRow {
	out := DashboardModuleRow{Key: mod.DeclType, Label: mod.Label}
	for _, r := range rows {
		if r.Suspendida {
			continue
		}
		out.Total++
		switch {
		case r.Status == models.SupervisorDeclEntregado && r.Timeliness == TimelinessLate:
			out.FueraFecha++
		case r.Status == models.SupervisorDeclEntregado:
			out.ATiempo++
		case r.Status == models.SupervisorDeclObservado:
			out.Observado++
		case r.Status == models.SupervisorDeclPorRevisar:
			out.Pendiente++
		case r.Timeliness == TimelinessMissing:
			out.Vencido++
		default:
			out.Pendiente++
		}
	}
	out.SinCompleta = out.Pendiente + out.Observado + out.Vencido
	return out
}

// DashboardOverview arma todo el panel de una vez. Quien llama define el alcance en
// p.AllowedCompanyIDs (nil = estudio completo) y `studio` indica si el usuario tiene ese alcance.
func (s *SupervisorService) DashboardOverview(p SupervisorDashboardParams, studio bool) (*DashboardOverview, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	companies, err := s.dashboardScopeCompanies(p)
	if err != nil {
		return nil, err
	}
	out := &DashboardOverview{
		Modules: []DashboardModuleRow{}, BySupervisor: []DashboardEntityRow{}, ByAssistant: []DashboardEntityRow{},
		Upcoming: []DashboardUpcoming{}, Review: DashboardReview{Items: []DashboardReviewItem{}},
	}
	out.Scope.Studio = studio
	out.Scope.Companies = int64(len(companies))

	ids := make([]uint, 0, len(companies))
	supOf := map[uint]uint{}
	byAssistant := map[uint][]uint{}
	bySupervisor := map[uint][]uint{}
	for _, c := range companies {
		ids = append(ids, c.ID)
		if c.SupervisorUserID != nil && *c.SupervisorUserID > 0 {
			bySupervisor[*c.SupervisorUserID] = append(bySupervisor[*c.SupervisorUserID], c.ID)
			supOf[c.ID] = *c.SupervisorUserID
		} else {
			out.Scope.WithoutSupervisor++
		}
		if c.AssistantUserID != nil && *c.AssistantUserID > 0 {
			byAssistant[*c.AssistantUserID] = append(byAssistant[*c.AssistantUserID], c.ID)
		}
	}
	out.Scope.Supervisors = int64(len(bySupervisor))
	out.Scope.Assistants = int64(len(byAssistant))

	// Todas las partes son independientes entre sí (solo lectura): se calculan en paralelo para que la
	// pantalla tarde lo que la más lenta y no la suma de todas. Cada tarea escribe en su propia
	// variable; se ensamblan en orden al final.
	names := s.userNames(userIDsOf(bySupervisor, byAssistant))
	assistantsOfSup := map[uint]map[uint]struct{}{}
	supervisorOfAssistant := map[uint]uint{}
	for _, c := range companies {
		if c.SupervisorUserID == nil || c.AssistantUserID == nil {
			continue
		}
		if assistantsOfSup[*c.SupervisorUserID] == nil {
			assistantsOfSup[*c.SupervisorUserID] = map[uint]struct{}{}
		}
		assistantsOfSup[*c.SupervisorUserID][*c.AssistantUserID] = struct{}{}
		if _, ok := supervisorOfAssistant[*c.AssistantUserID]; !ok {
			supervisorOfAssistant[*c.AssistantUserID] = *c.SupervisorUserID
		}
	}

	var (
		reviewRows               []reviewRowTmp
		pdtSum                   map[string]PdtTypeSummary
		detSum, mailboxSum       ComplianceSummary
		informeRows, siscontRows []PdfReportListRow
		trend, studioTrend       []ComplianceTrendPoint
		upcoming                 []DashboardUpcoming
	)
	supIDs := sortedKeys(bySupervisor)
	assistIDs := sortedKeys(byAssistant)
	supSummaries := make([]ComplianceSummary, len(supIDs))
	assistSummaries := make([]ComplianceSummary, len(assistIDs))
	entity := func(companyIDs []uint) (ComplianceSummary, error) {
		scoped := p
		scoped.AllowedCompanyIDs = companyIDs
		return s.MonthlyComplianceSummary(scoped)
	}

	tasks := []func() error{
		func() (err error) { reviewRows, err = s.fillDashboardReview(p, ids, supOf, out); return },
		func() (err error) { trend, err = s.ComplianceTrend(p, 6); return },
		func() error { upcoming = s.dashboardUpcoming(p.PeriodYM, companies); return nil },
	}
	if len(ids) > 0 {
		tasks = append(tasks,
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
		)
	}
	if !studio {
		// Referencia agregada del estudio para quien solo ve su cartera (nunca desglosada).
		tasks = append(tasks, func() error {
			st, err := s.ComplianceTrend(SupervisorDashboardParams{PeriodYM: p.PeriodYM}, 6)
			if err == nil {
				studioTrend = st
			}
			return nil
		})
	}
	for i, id := range supIDs {
		i, id := i, id
		tasks = append(tasks, func() (err error) { supSummaries[i], err = entity(bySupervisor[id]); return })
	}
	for i, id := range assistIDs {
		i, id := i, id
		tasks = append(tasks, func() (err error) { assistSummaries[i], err = entity(byAssistant[id]); return })
	}
	if err := runParallel(8, tasks); err != nil {
		return nil, err
	}

	if len(ids) > 0 {
		out.Modules = append(out.Modules,
			moduleRowFromPdt(models.SupervisorDeclPDT601, "PDT 601", pdtSum[models.SupervisorDeclPDT601]),
			moduleRowFromPdt(models.SupervisorDeclPDT621, "PDT 621", pdtSum[models.SupervisorDeclPDT621]),
			moduleRowFromCompliance(models.SupervisorDeclDetracciones, "Detracciones", detSum),
			moduleRowFromCompliance(models.SupervisorDeclSunatInbox, "Buzón SOL", mailboxSum),
			moduleRowFromPdf(PdfReportInformeDetracciones, informeRows),
			moduleRowFromPdf(PdfReportSiscontBalances, siscontRows),
		)
	}

	reviewBySup := map[uint]int64{}
	reviewByAssistant := map[uint]int64{}
	for _, it := range reviewRows {
		reviewBySup[it.supervisor]++
		reviewByAssistant[it.assistant]++
	}
	for i, id := range supIDs {
		out.BySupervisor = append(out.BySupervisor, DashboardEntityRow{
			UserID: id, Name: names[id], Companies: int64(len(bySupervisor[id])),
			Assistants: int64(len(assistantsOfSup[id])), Compliance: supSummaries[i], Review: reviewBySup[id],
		})
	}
	sort.Slice(out.BySupervisor, func(i, j int) bool { return out.BySupervisor[i].Name < out.BySupervisor[j].Name })
	for i, id := range assistIDs {
		out.ByAssistant = append(out.ByAssistant, DashboardEntityRow{
			UserID: id, Name: names[id], SupervisorName: names[supervisorOfAssistant[id]],
			Companies: int64(len(byAssistant[id])), Compliance: assistSummaries[i], Review: reviewByAssistant[id],
		})
	}
	sort.Slice(out.ByAssistant, func(i, j int) bool { return out.ByAssistant[i].Name < out.ByAssistant[j].Name })

	out.Trend = trend
	out.StudioTrend = studioTrend
	out.Upcoming = upcoming
	return out, nil
}

// reviewRowTmp fila interna de la cola, para repartir conteos por supervisor/asistente.
type reviewRowTmp struct {
	supervisor, assistant uint
}

func (s *SupervisorService) fillDashboardReview(p SupervisorDashboardParams, ids []uint, supOf map[uint]uint, out *DashboardOverview) ([]reviewRowTmp, error) {
	var tmpRows []reviewRowTmp
	if len(ids) == 0 {
		return nil, nil
	}
	types := make([]string, 0, len(reviewModules))
	for _, m := range reviewModules {
		types = append(types, m.Key)
	}

	var observed int64
	_ = database.DB.Table("supervisor_declarations AS d").
		Joins("JOIN supervisor_monthly_controls c ON c.id = d.monthly_control_id AND c.deleted_at IS NULL").
		Where("c.period_ym = ? AND c.company_id IN ? AND d.declaration_type IN ? AND d.status = ? AND d.deleted_at IS NULL",
			p.PeriodYM, ids, types, models.SupervisorDeclObservado).
		Count(&observed).Error
	out.Review.Observed = observed

	type row struct {
		DeclarationID uint
		DeclType      string
		CompanyID     uint
		BusinessName  string
		AssistantID   *uint
		UpdatedAt     time.Time
		DeliveredAt   *time.Time
		FechaEntrega  *time.Time
		PrimeraFecha  *time.Time
	}
	var rows []row
	if err := database.DB.Table("supervisor_declarations AS d").
		Select(`d.id AS declaration_id, d.declaration_type AS decl_type, c.company_id AS company_id,
			co.business_name AS business_name, co.assistant_user_id AS assistant_id, d.updated_at AS updated_at,
			d.delivered_at AS delivered_at, pl.fecha_entrega AS fecha_entrega, r.primera_entrega_fecha AS primera_fecha`).
		Joins("JOIN supervisor_monthly_controls c ON c.id = d.monthly_control_id AND c.deleted_at IS NULL").
		Joins("JOIN companies co ON co.id = c.company_id").
		Joins("LEFT JOIN supervisor_pdt601_planillas pl ON pl.monthly_control_id = c.id AND pl.deleted_at IS NULL AND d.declaration_type = ?", models.SupervisorDeclPDT601).
		Joins("LEFT JOIN supervisor_pdt621_records r ON r.monthly_control_id = c.id AND r.deleted_at IS NULL AND d.declaration_type = ?", models.SupervisorDeclPDT621).
		Where("c.period_ym = ? AND c.company_id IN ? AND d.declaration_type IN ? AND d.status = ? AND d.deleted_at IS NULL",
			p.PeriodYM, ids, types, models.SupervisorDeclPorRevisar).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	type item struct {
		DashboardReviewItem
		at time.Time
	}
	items := make([]item, 0, len(rows))
	assistantIDs := []uint{}
	for _, r := range rows {
		at := r.UpdatedAt
		switch {
		case r.DeliveredAt != nil:
			at = *r.DeliveredAt
		case r.FechaEntrega != nil:
			at = *r.FechaEntrega
		case r.PrimeraFecha != nil:
			at = *r.PrimeraFecha
		}
		day := time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, time.Local)
		age := int(today.Sub(day).Hours() / 24)
		if age < 0 {
			age = 0
		}
		label, _ := reviewModuleLabel(r.DeclType)
		it := item{at: day, DashboardReviewItem: DashboardReviewItem{
			DeclarationID: r.DeclarationID, CompanyID: r.CompanyID, Company: strings.TrimSpace(r.BusinessName),
			ModuleKey: r.DeclType, ModuleLabel: label, SubmittedAt: day.Format("2006-01-02"), AgeDays: age,
		}}
		var assistant uint
		if r.AssistantID != nil {
			assistant = *r.AssistantID
			assistantIDs = append(assistantIDs, assistant)
		}
		tmpRows = append(tmpRows, reviewRowTmp{supervisor: supOf[r.CompanyID], assistant: assistant})
		items = append(items, it)
		out.Review.Total++
		if age > 3 {
			out.Review.Over3Days++
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].at.Before(items[j].at) })
	if len(items) > 8 {
		items = items[:8]
	}

	names := s.userNames(assistantIDs)
	// asistente por empresa para los ítems visibles
	assistantByCompany := map[uint]uint{}
	for _, r := range rows {
		if r.AssistantID != nil {
			assistantByCompany[r.CompanyID] = *r.AssistantID
		}
	}
	for _, it := range items {
		dto := it.DashboardReviewItem
		dto.Assistant = names[assistantByCompany[dto.CompanyID]]
		_, calType := reviewModuleLabel(dto.ModuleKey)
		dig := s.companyDig(dto.CompanyID)
		act := PickCalendarActivityByDigitFor(p.PeriodYM, calType, dig)
		delivered := it.at
		dto.Timeliness = ComputeCalendarActivityTimeliness(p.PeriodYM, act, &delivered, false).Timeliness
		out.Review.Items = append(out.Review.Items, dto)
	}
	return tmpRows, nil
}

// dashboardUpcoming próximos vencimientos (por grupo de RUC del calendario) de los módulos con
// entrega, contando las empresas del alcance que todavía no completaron.
func (s *SupervisorService) dashboardUpcoming(periodYM string, companies []models.Company) []DashboardUpcoming {
	out := []DashboardUpcoming{}
	if len(companies) == 0 {
		return out
	}
	ids := make([]uint, 0, len(companies))
	for _, c := range companies {
		ids = append(ids, c.ID)
	}

	digByCompany := map[uint]string{}
	var creds []models.CompanyAccessCredential
	_ = database.DB.Where("company_id IN ?", ids).Find(&creds).Error
	for _, cr := range creds {
		digByCompany[cr.CompanyID] = strings.TrimSpace(cr.Dig)
	}
	suspended := map[uint]bool{}
	type suspRow struct {
		CompanyID  uint
		Suspendida bool
	}
	var susp []suspRow
	_ = database.DB.Table("supervisor_monthly_controls").Select("company_id, suspendida").
		Where("company_id IN ? AND period_ym = ? AND deleted_at IS NULL", ids, periodYM).Scan(&susp).Error
	for _, r := range susp {
		suspended[r.CompanyID] = r.Suspendida
	}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	completed := map[string]bool{
		models.SupervisorDeclEntregado: true, models.SupervisorDeclAprobado: true,
		models.SupervisorDeclPresentado: true, models.SupervisorDeclCerrado: true,
	}

	for _, m := range reviewModules {
		acts, err := CalendarActivitiesForType(periodYM, m.CalendarType)
		if err != nil || len(acts) == 0 {
			continue
		}
		type declRow struct {
			CompanyID uint
			Status    string
		}
		var decls []declRow
		_ = database.DB.Table("supervisor_monthly_controls AS c").
			Select("c.company_id, d.status").
			Joins("JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.deleted_at IS NULL", m.Key).
			Where("c.company_id IN ? AND c.period_ym = ? AND c.deleted_at IS NULL", ids, periodYM).
			Scan(&decls).Error
		statusBy := map[uint]string{}
		for _, d := range decls {
			statusBy[d.CompanyID] = d.Status
		}

		pending := map[uint]int64{}
		for _, c := range companies {
			if suspended[c.ID] || completed[statusBy[c.ID]] {
				continue
			}
			act := PickCalendarActivityByDigit(acts, pdt601DigitFromString(digByCompany[c.ID]))
			if act != nil {
				pending[act.ID]++
			}
		}
		for i := range acts {
			act := &acts[i]
			n := pending[act.ID]
			if n == 0 {
				continue
			}
			due, err := dueDateForActivity(periodYM, act.DueDay)
			if err != nil {
				continue
			}
			if rule, err := LoadActiveActivityRule(act.ActivityRuleID); err == nil && rule != nil {
				due = BuildUploadDeadline(due, rule)
			}
			day := time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, time.Local)
			daysLeft := int(day.Sub(today).Hours() / 24)
			if daysLeft < -2 || daysLeft > 21 {
				continue
			}
			detail := ""
			if act.RucDigitStartSnapshot != nil && act.RucDigitEndSnapshot != nil {
				detail = "dígitos " + strconv.Itoa(*act.RucDigitStartSnapshot) + "–" + strconv.Itoa(*act.RucDigitEndSnapshot)
			}
			out = append(out, DashboardUpcoming{ModuleKey: m.Key, Label: m.Label, DueDate: day.Format("2006-01-02"), DaysLeft: daysLeft, Pending: n, Detail: detail})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].DaysLeft < out[j].DaysLeft })
	if len(out) > 5 {
		out = out[:5]
	}
	return out
}

// runParallel ejecuta las tareas con a lo sumo `limit` en simultáneo y devuelve el primer error.
// Todas son consultas de solo lectura; cada una escribe en su propia variable.
func runParallel(limit int, tasks []func() error) error {
	if limit < 1 {
		limit = 1
	}
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var first error
	for _, task := range tasks {
		wg.Add(1)
		sem <- struct{}{}
		go func(fn func() error) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := fn(); err != nil {
				mu.Lock()
				if first == nil {
					first = err
				}
				mu.Unlock()
			}
		}(task)
	}
	wg.Wait()
	return first
}

func sortedKeys(m map[uint][]uint) []uint {
	keys := make([]uint, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	return keys
}

func userIDsOf(a, b map[uint][]uint) []uint {
	return append(sortedKeys(a), sortedKeys(b)...)
}
