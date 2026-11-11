package services

import (
	"errors"
	"fmt"
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
	CompanyID   uint   `json:"company_id"`
	Company     string `json:"company"`
	RUC         string `json:"ruc"`
	ModuleKey   string `json:"module_key"`
	ModuleLabel string `json:"module_label"`
	// Detail y WeekStart ubican una captura de buzón observada (qué buzón, qué carga y de qué semana).
	Detail    string `json:"detail,omitempty"`
	WeekStart string `json:"week_start,omitempty"`
	// Slot entrega del mes (1 o 2) cuando el módulo se envía más de una vez por período (Preliminar de ventas).
	Slot          int  `json:"slot,omitempty"`
	DeclarationID uint `json:"declaration_id,omitempty"`
	// State: vencida | observada | pendiente | por_revisar
	State       string `json:"state"`
	DueDate     string `json:"due_date,omitempty"`
	DaysLeft    *int   `json:"days_left,omitempty"`
	Note        string `json:"note,omitempty"`
	NoteBy      string `json:"note_by,omitempty"`
	SubmittedAt string `json:"submitted_at,omitempty"`
	// Assistant asistente asignado a la empresa; solo se llena en la vista del estudio.
	Assistant string `json:"assistant,omitempty"`
	// Owner responsable de la tarea: asistente | supervisor.
	Owner string `json:"owner,omitempty"`
	// Hint aclaración corta bajo la tarea (por ejemplo «Falta enviarla al cliente»).
	Hint string `json:"hint,omitempty"`
}

type AssistantCounts struct {
	// All toda la lista de trabajo (las pestañas cuentan sobre esto, no sobre lo que alcanza a enviarse a la pantalla).
	All          int64 `json:"all"`
	ToDeliver    int64 `json:"to_deliver"` // pendientes + vencidas
	Overdue      int64 `json:"overdue"`
	OverdueOver3 int64 `json:"overdue_over_3_days"`
	Observed     int64 `json:"observed"`
	InReview     int64 `json:"in_review"`
	DueThisWeek  int64 `json:"due_this_week"`
}

// AssistantSupervisorRef supervisor a cargo de (parte de) las empresas del asistente, con cuántas de ellas supervisa.
type AssistantSupervisorRef struct {
	UserID    uint   `json:"user_id"`
	Name      string `json:"name"`
	Companies int    `json:"companies"`
}

type AssistantOverview struct {
	Companies int64 `json:"companies"`
	// Supervisors los supervisores de las empresas asignadas (el de cada empresa, ver companies.supervisor_user_id),
	// de mayor a menor cantidad de empresas. UserID 0 = empresas sin supervisor asignado.
	Supervisors []AssistantSupervisorRef `json:"supervisors"`
	// Progress avance del periodo: tareas completadas ÷ tareas que aplican (ver supervisor_assistant_tasks.go).
	Progress AssistantProgress `json:"progress"`
	// Trend el mismo avance en los últimos 6 meses.
	Trend []AssistantTrendPoint `json:"trend"`
	// Modules avance de cada actividad; ModuleOptions todas las actividades elegibles en el filtro (aunque uno esté aplicado).
	Modules       []AssistantModuleProgress `json:"modules"`
	ModuleOptions []AssistantModuleRef      `json:"module_options"`
	Counts        AssistantCounts           `json:"counts"`
	Work          []AssistantWorkItem       `json:"work"`
	// WorkTruncated la lista se recortó por tamaño; los conteos y el avance siguen siendo de todo.
	WorkTruncated bool                `json:"work_truncated,omitempty"`
	Upcoming      []DashboardUpcoming `json:"upcoming"`
	// Studio solo en la vista del estudio (administrador): las opciones de los filtros por asistente y supervisor.
	Studio *AssistantStudioInfo `json:"studio,omitempty"`
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
	if due, err := activityDueDate(periodYM, act); err == nil {
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
		moduleRowFromCompliance(models.SupervisorDeclDetracciones, "Estado cta. detracciones", detSum),
		moduleRowFromCompliance(models.SupervisorDeclSunatInbox, "Buzón SOL", mailboxSum),
		moduleRowFromPdf(PdfReportInformeDetracciones, informeRows),
		moduleRowFromPdf(PdfReportSiscontBalances, siscontRows),
	}, nil
}

// AssistantModuleRef una actividad elegible en el filtro de módulo del panel.
type AssistantModuleRef struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// assistantWorkLimit tope de filas de la lista de trabajo que se envían a la pantalla (los conteos son de todo).
const assistantWorkLimit = 1500

// AssistantOverview arma el panel del asistente. p.AllowedCompanyIDs son SUS empresas (nunca el alcance
// de estudio): quien llama lo resuelve con las asignaciones del usuario. Todo sale de una sola lista de tareas
// (supervisor_assistant_tasks.go), así el porcentaje, los totales, las pestañas y la lista no se contradicen.
func (s *SupervisorService) AssistantOverview(p SupervisorDashboardParams) (*AssistantOverview, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	companies, err := s.dashboardScopeCompanies(p)
	if err != nil {
		return nil, err
	}
	out := &AssistantOverview{
		Companies: int64(len(companies)), Supervisors: s.assistantSupervisors(companies),
		Modules: []AssistantModuleProgress{}, ModuleOptions: assistantModuleOptions(p.IncludeSupervisorTasks),
		Work: []AssistantWorkItem{}, Upcoming: []DashboardUpcoming{}, Trend: []AssistantTrendPoint{},
	}
	if len(companies) == 0 {
		return out, nil
	}

	var (
		build *assistantBuild
		trend []AssistantTrendPoint
		up    []DashboardUpcoming
	)
	tasks := []func() error{
		func() (err error) {
			build, err = s.assistantBuild(p.PeriodYM, companies, p.IncludeSupervisorTasks, p.ModuleKey, true)
			return
		},
		func() error {
			trend = s.assistantProgressTrend(p, p.IncludeSupervisorTasks, p.ModuleKey, 6)
			return nil
		},
		func() error { up = s.dashboardUpcoming(p.PeriodYM, companies); return nil },
	}
	if err := runParallel(3, tasks); err != nil {
		return nil, err
	}

	items := build.Work
	s.attachWorkNotes(items)
	sortAssistantWork(items)
	out.Counts = assistantWorkCounts(items)
	if len(items) > assistantWorkLimit {
		items = items[:assistantWorkLimit]
		out.WorkTruncated = true
	}
	out.Work = items
	out.Progress, out.Trend, out.Upcoming = build.Progress, trend, up
	for _, m := range build.Modules {
		if p.ModuleKey == "" || p.ModuleKey == m.Key {
			out.Modules = append(out.Modules, m)
		}
	}
	return out, nil
}

// assistantModuleOptions las actividades que se pueden elegir en el filtro de módulo.
func assistantModuleOptions(includeSupervisor bool) []AssistantModuleRef {
	opts := []AssistantModuleRef{
		{models.SupervisorDeclPDT601, "PDT 601"},
		{models.SupervisorDeclPDT621, "PDT 621"},
	}
	if includeSupervisor {
		opts = append(opts, AssistantModuleRef{pdt621DeclarationKey, "PDT 621 · Declaración"})
	}
	return append(opts,
		AssistantModuleRef{models.SupervisorDeclDetracciones, "Estado cta. detracciones"},
		AssistantModuleRef{models.SupervisorDeclSunatInbox, "Buzón SOL"},
		AssistantModuleRef{PdfReportInformeDetracciones.DeclType, PdfReportInformeDetracciones.Label},
		AssistantModuleRef{PdfReportSiscontBalances.DeclType, PdfReportSiscontBalances.Label},
		AssistantModuleRef{models.SupervisorDeclPreliminarVentas, "Preliminar de ventas"},
	)
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

// assistantSupervisors agrupa las empresas por su supervisor asignado (companies.supervisor_user_id).
func (s *SupervisorService) assistantSupervisors(companies []models.Company) []AssistantSupervisorRef {
	counts := map[uint]int{}
	ids := make([]uint, 0)
	for _, c := range companies {
		var id uint
		if c.SupervisorUserID != nil {
			id = *c.SupervisorUserID
		}
		if _, seen := counts[id]; !seen && id != 0 {
			ids = append(ids, id)
		}
		counts[id]++
	}
	names := s.userNames(ids)
	out := make([]AssistantSupervisorRef, 0, len(counts))
	for id, n := range counts {
		ref := AssistantSupervisorRef{UserID: id, Companies: n}
		if id == 0 {
			ref.Name = "Sin supervisor asignado"
		} else if ref.Name = names[id]; ref.Name == "" {
			ref.Name = fmt.Sprintf("Usuario %d", id)
		}
		out = append(out, ref)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Companies != out[j].Companies {
			return out[i].Companies > out[j].Companies
		}
		return out[i].Name < out[j].Name
	})
	return out
}
