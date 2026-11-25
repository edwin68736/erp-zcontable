package services

import (
	"errors"
	"sort"
	"strings"

	"miappfiber/database"
	"miappfiber/models"
)

// Avance del dashboard del supervisor: LO MISMO que el panel del asistente (mismas tareas, mismas reglas, mismos totales por
// módulo y por dígito de RUC), pero sobre las empresas que ve el supervisor (su cartera) o el estudio completo (administrador), y
// siempre con las tareas del supervisor incluidas (la declaración del PDT 621).
//
// El dashboard anterior medía «controles» mensuales (un registro interno por empresa y mes con un estado general que casi siempre
// salía «vencido»): ya no se usa. Todo parte de las tareas por actividad.

// DashboardAssistantProgress el avance de las empresas de un asistente (todas las actividades).
type DashboardAssistantProgress struct {
	UserID         uint   `json:"user_id"`
	Name           string `json:"name"`
	SupervisorName string `json:"supervisor_name,omitempty"`
	Companies      int64  `json:"companies"`
	AssistantProgress
}

// DashboardSuspendedCompany una empresa de las listas del periodo (suspendida, o marcada «No corresponde»).
type DashboardSuspendedCompany struct {
	CompanyID uint   `json:"company_id"`
	Company   string `json:"company"`
	RUC       string `json:"ruc"`
	Assistant string `json:"assistant,omitempty"`
}

// DashboardProgress todo lo que pinta el dashboard del supervisor, en una sola respuesta.
type DashboardProgress struct {
	PeriodYM string `json:"period_ym"`
	// Companies empresas activas del alcance (incluye las suspendidas, que no aplican).
	Companies   int64                    `json:"companies"`
	Supervisors []AssistantSupervisorRef `json:"supervisors"`
	// Progress avance del periodo: tareas completadas ÷ tareas que aplican.
	Progress AssistantProgress `json:"progress"`
	// Trend el mismo avance en los últimos 6 meses.
	Trend       []AssistantTrendPoint        `json:"trend"`
	Modules     []AssistantModuleProgress    `json:"modules"`
	ByAssistant []DashboardAssistantProgress `json:"by_assistant"`
	Suspended   []DashboardSuspendedCompany  `json:"suspended"`
	// NotApplicablePdt621 empresas marcadas «No corresponde» en PDT 621 (no entran en el KPI 4).
	NotApplicablePdt621 []DashboardSuspendedCompany `json:"not_applicable_pdt621"`
	Mailboxes           []IndicatorMailboxRow       `json:"mailboxes"`
}

// DashboardProgress arma el avance con el alcance y los filtros de p (p.AllowedCompanyIDs ya trae la cartera del supervisor, o
// todo el estudio si es nil). Las tareas del supervisor siempre entran.
func (s *SupervisorService) DashboardProgress(p SupervisorDashboardParams) (*DashboardProgress, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	p.IncludeSupervisorTasks = true
	companies, err := s.dashboardScopeCompanies(p)
	if err != nil {
		return nil, err
	}
	out := &DashboardProgress{
		PeriodYM: p.PeriodYM, Companies: int64(len(companies)), Supervisors: s.assistantSupervisors(companies),
		Trend: []AssistantTrendPoint{}, Modules: []AssistantModuleProgress{}, ByAssistant: []DashboardAssistantProgress{},
		Suspended: []DashboardSuspendedCompany{}, NotApplicablePdt621: []DashboardSuspendedCompany{}, Mailboxes: []IndicatorMailboxRow{},
	}
	if len(companies) == 0 {
		return out, nil
	}

	var (
		build     *assistantBuild
		trend     []AssistantTrendPoint
		mailboxes []IndicatorMailboxRow
		suspended []uint
	)
	ids := make([]uint, 0, len(companies))
	for _, c := range companies {
		ids = append(ids, c.ID)
	}
	tasks := []func() error{
		func() (err error) { build, err = s.assistantBuild(p.PeriodYM, companies, true, "", false); return },
		func() error { trend = s.assistantProgressTrend(p, true, "", 6); return nil },
		func() error { mailboxes = s.indicatorMailboxes(p.PeriodYM, companies); return nil },
		func() error { suspended = s.suspendedCompanyIDs(p.PeriodYM, ids); return nil },
	}
	if err := runParallel(4, tasks); err != nil {
		return nil, err
	}

	out.Progress, out.Trend, out.Modules, out.Mailboxes = build.Progress, trend, build.Modules, mailboxes
	// El último punto de la tendencia es el periodo que se está viendo: es el mismo avance que ya se calculó arriba.
	if n := len(trend); n > 0 {
		trend[n-1].Pct, trend[n-1].Total, trend[n-1].Completed = build.Progress.Pct, build.Progress.Total, build.Progress.Completed
	}

	// Avance de cada asistente: suma de las tareas de sus empresas en todas las actividades.
	byAssistant := map[uint]*DashboardAssistantProgress{}
	nameIDs := []uint{}
	supOf := map[uint]uint{}
	for _, c := range companies {
		if c.AssistantUserID == nil || *c.AssistantUserID == 0 {
			continue
		}
		aid := *c.AssistantUserID
		row, ok := byAssistant[aid]
		if !ok {
			row = &DashboardAssistantProgress{UserID: aid}
			byAssistant[aid] = row
			nameIDs = append(nameIDs, aid)
		}
		row.Companies++
		if _, seen := supOf[aid]; !seen && c.SupervisorUserID != nil && *c.SupervisorUserID != 0 {
			supOf[aid] = *c.SupervisorUserID
			nameIDs = append(nameIDs, *c.SupervisorUserID)
		}
		for _, mp := range build.PerCompany[c.ID] {
			row.AssistantProgress.merge(mp)
		}
	}
	names := s.userNames(nameIDs)
	for aid, row := range byAssistant {
		row.AssistantProgress.finalize()
		row.Name = strings.TrimSpace(names[aid])
		if row.Name == "" {
			row.Name = "Usuario"
		}
		row.SupervisorName = strings.TrimSpace(names[supOf[aid]])
		out.ByAssistant = append(out.ByAssistant, *row)
	}
	sort.Slice(out.ByAssistant, func(i, j int) bool {
		a, b := out.ByAssistant[i], out.ByAssistant[j]
		if a.Pct != b.Pct {
			return a.Pct > b.Pct
		}
		return a.Name < b.Name
	})

	// Empresas suspendidas del periodo y las marcadas «No corresponde» en PDT 621 (resumen del KPI 4). Una suspendida no se
	// repite en la segunda lista: tiene su propio cuadro.
	isSusp := idSet(suspended)
	out.Suspended = s.dashboardCompanyList(companies, isSusp)
	noCorresponde := notApplicableCompanies(p.PeriodYM, models.SupervisorDeclPDT621, ids)
	for id := range isSusp {
		delete(noCorresponde, id)
	}
	out.NotApplicablePdt621 = s.dashboardCompanyList(companies, noCorresponde)
	return out, nil
}

// dashboardCompanyList las empresas de `only` con su asistente, ordenadas por razón social.
func (s *SupervisorService) dashboardCompanyList(companies []models.Company, only map[uint]bool) []DashboardSuspendedCompany {
	out := []DashboardSuspendedCompany{}
	if len(only) == 0 {
		return out
	}
	var asstIDs []uint
	for _, c := range companies {
		if only[c.ID] && c.AssistantUserID != nil && *c.AssistantUserID != 0 {
			asstIDs = append(asstIDs, *c.AssistantUserID)
		}
	}
	names := s.userNames(asstIDs)
	for _, c := range companies {
		if !only[c.ID] {
			continue
		}
		row := DashboardSuspendedCompany{CompanyID: c.ID, Company: strings.TrimSpace(c.BusinessName), RUC: c.RUC}
		if c.AssistantUserID != nil {
			row.Assistant = strings.TrimSpace(names[*c.AssistantUserID])
		}
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Company) < strings.ToLower(out[j].Company) })
	return out
}

// suspendedCompanyIDs las empresas con la marca «suspendida» en el control del periodo (la marca es global para las actividades).
func (s *SupervisorService) suspendedCompanyIDs(periodYM string, companyIDs []uint) []uint {
	var rows []struct{ CompanyID uint }
	_ = database.DB.Table("supervisor_monthly_controls").
		Select("company_id").
		Where("company_id IN ? AND period_ym = ? AND suspendida = ? AND deleted_at IS NULL", companyIDs, periodYM, true).
		Scan(&rows).Error
	out := make([]uint, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.CompanyID)
	}
	return out
}
