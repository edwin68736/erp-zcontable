package services

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Tareas del panel del asistente.
//
// UNA sola lista de tareas alimenta todo el panel (el porcentaje de avance, los totales por módulo, las pestañas y la
// lista de trabajo), para que ninguna cifra pueda contradecir a otra.
//
//	Actividad = el módulo (PDT 621, Buzón SOL…). Tarea = cada entrega concreta de una actividad en el periodo: una por
//	empresa y mes en la mayoría, dos en Preliminar de ventas, una por semana y por buzón (SUNAT/SUNAFIL) en el Buzón SOL.
//	Completada = entregada, a tiempo o fuera de fecha. Observada, vencida y pendiente no cuentan como completadas.
//	No aplica (no entra en el análisis): empresa suspendida, y «sin planilla» en PDT 601.
//
// El PDT 621 son dos tareas de dos responsables (ver supervisor_pdt621_tareas.go): el archivador (asistente: queda
// completada cuando el supervisor lo recepciona) y la declaración (supervisor; solo entra en la vista del estudio).

const (
	assistantTaskDone     = "completada"
	assistantTaskInReview = "por_revisar"
	assistantTaskObserved = "observada"
	assistantTaskOverdue  = "vencida"
	assistantTaskPending  = "pendiente"

	pdt621DeclarationKey = "pdt_621_declaracion"

	assistantOwnerAssistant  = "asistente"
	assistantOwnerSupervisor = "supervisor"
)

// AssistantProgress conteo de tareas de un conjunto (un módulo o todo el panel). Total = tareas que aplican.
type AssistantProgress struct {
	Total         int64 `json:"total"`
	Completed     int64 `json:"completed"`
	OnTime        int64 `json:"on_time"`
	Late          int64 `json:"late"`
	InReview      int64 `json:"in_review"`
	Pending       int64 `json:"pending"`
	Overdue       int64 `json:"overdue"`
	Observed      int64 `json:"observed"`
	NotApplicable int64 `json:"not_applicable"`
	// Pct avance = completadas ÷ tareas que aplican, con un decimal.
	Pct float64 `json:"pct"`
}

func (p *AssistantProgress) add(state string, onTime bool) {
	switch state {
	case assistantTaskDone:
		p.Completed++
		if onTime {
			p.OnTime++
		} else {
			p.Late++
		}
	case assistantTaskInReview:
		p.InReview++
	case assistantTaskObserved:
		p.Observed++
	case assistantTaskOverdue:
		p.Overdue++
	default:
		p.Pending++
	}
}

func (p *AssistantProgress) finalize() {
	p.Total = p.Completed + p.InReview + p.Pending + p.Overdue + p.Observed
	p.Pct = 0
	if p.Total > 0 {
		p.Pct = math.Round(float64(p.Completed)/float64(p.Total)*1000) / 10
	}
}

func (p *AssistantProgress) merge(o AssistantProgress) {
	p.Completed += o.Completed
	p.OnTime += o.OnTime
	p.Late += o.Late
	p.InReview += o.InReview
	p.Pending += o.Pending
	p.Overdue += o.Overdue
	p.Observed += o.Observed
	p.NotApplicable += o.NotApplicable
}

// AssistantDigitProgress el avance de un módulo para las empresas cuyo RUC termina en un dígito (consolidado de «dentro y
// fuera de plazo» por dígito: los vencimientos de SUNAT se reparten por el último dígito del RUC).
type AssistantDigitProgress struct {
	Digit int `json:"digit"`
	AssistantProgress
}

// AssistantModuleProgress avance de una actividad (módulo) del panel.
type AssistantModuleProgress struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// Owner quién es responsable de esta tarea: asistente | supervisor.
	Owner string `json:"owner"`
	AssistantProgress
	// ByDigit el mismo conteo separado por último dígito del RUC (0 al 9). Vacío en los módulos que no se miden por empresa
	// (Buzón SOL).
	ByDigit []AssistantDigitProgress `json:"by_digit,omitempty"`
	// Planilla solo en PDT 601: trabajadores atendidos por cada asistente (la carga de planillas).
	Planilla *AssistantPlanillaLoad `json:"planilla,omitempty"`
}

// AssistantTrendPoint avance de un mes (con la misma fórmula que el panel). Total 0 = ese mes no tiene tareas medidas.
type AssistantTrendPoint struct {
	PeriodYM  string  `json:"period_ym"`
	Pct       float64 `json:"pct"`
	Total     int64   `json:"total"`
	Completed int64   `json:"completed"`
}

type assistantBuild struct {
	Modules  []AssistantModuleProgress
	Progress AssistantProgress
	Work     []AssistantWorkItem
	// PlanillaLoad la carga de planillas por asistente (solo si el módulo PDT 601 está en el alcance).
	PlanillaLoad *AssistantPlanillaLoad
}

type assistantAcc struct {
	order  []string
	mods   map[string]*AssistantModuleProgress
	digits map[string]*[10]AssistantProgress
}

func newAssistantAcc() *assistantAcc {
	return &assistantAcc{mods: map[string]*AssistantModuleProgress{}, digits: map[string]*[10]AssistantProgress{}}
}

func (a *assistantAcc) mod(key, label, owner string) *AssistantModuleProgress {
	if m, ok := a.mods[key]; ok {
		return m
	}
	m := &AssistantModuleProgress{Key: key, Label: label, Owner: owner}
	a.mods[key] = m
	a.order = append(a.order, key)
	return m
}

// addDigit cuenta la tarea también en el dígito final del RUC de su empresa (un RUC sin dígito válido no se separa).
func (a *assistantAcc) addDigit(key, ruc, state string, onTime bool) {
	ruc = strings.TrimSpace(ruc)
	if ruc == "" {
		return
	}
	d := int(ruc[len(ruc)-1]) - '0'
	if d < 0 || d > 9 {
		return
	}
	arr, ok := a.digits[key]
	if !ok {
		arr = &[10]AssistantProgress{}
		a.digits[key] = arr
	}
	arr[d].add(state, onTime)
}

// byDigit el consolidado por dígito de un módulo ya contado (nil si no se separó por dígito).
func (a *assistantAcc) byDigit(key string) []AssistantDigitProgress {
	arr, ok := a.digits[key]
	if !ok {
		return nil
	}
	out := make([]AssistantDigitProgress, 0, 10)
	for d := 0; d < 10; d++ {
		p := arr[d]
		p.finalize()
		out = append(out, AssistantDigitProgress{Digit: d, AssistantProgress: p})
	}
	return out
}

// assistantTaskState estado de una tarea según el estado de su entrega y su puntualidad.
func assistantTaskState(status, timeliness string, exempt bool) (state string, onTime bool, applies bool) {
	if exempt {
		return "", false, false
	}
	switch status {
	case models.SupervisorDeclEntregado, models.SupervisorDeclAprobado, models.SupervisorDeclPresentado,
		models.SupervisorDeclCerrado, models.SupervisorDetraccionVerificado:
		return assistantTaskDone, timeliness != TimelinessLate, true
	case models.SupervisorDeclObservado:
		return assistantTaskObserved, false, true
	case models.SupervisorDeclPorRevisar, models.SupervisorDetraccionCargado:
		return assistantTaskInReview, false, true
	}
	if timeliness == TimelinessMissing {
		return assistantTaskOverdue, false, true
	}
	return assistantTaskPending, false, true
}

// assistantBuild arma las tareas del periodo para las empresas dadas y devuelve el avance por módulo, el total y la lista
// de lo que falta por hacer (tareas no completadas, sin las capturas pendientes del Buzón, que son miles y se cuentan
// pero no se listan). moduleKey != "" limita todo a ese módulo. includeSupervisor añade las tareas del supervisor
// (vista del estudio). wantWork false evita armar la lista (la usa la tendencia de meses).
func (s *SupervisorService) assistantBuild(periodYM string, companies []models.Company, includeSupervisor bool, moduleKey string, wantWork bool) (*assistantBuild, error) {
	out := &assistantBuild{Modules: []AssistantModuleProgress{}, Work: []AssistantWorkItem{}}
	if len(companies) == 0 {
		return out, nil
	}
	want := func(key string) bool { return moduleKey == "" || moduleKey == key }

	var (
		pdt601 []Pdt601ListRow
		pdt621 []Pdt621ListRow
		det    []DetraccionesListRow
		inf    []PdfReportListRow
		sis    []PdfReportListRow
		prelim []preliminarSlotWork
	)
	fetch := []func() error{}
	if want(models.SupervisorDeclPDT601) {
		fetch = append(fetch, func() (err error) { pdt601, err = s.pdt601BuildRows(companies, periodYM); return })
	}
	if want(models.SupervisorDeclPDT621) || (includeSupervisor && want(pdt621DeclarationKey)) {
		fetch = append(fetch, func() (err error) { pdt621, err = s.pdt621BuildRows(companies, periodYM); return })
	}
	if want(models.SupervisorDeclDetracciones) {
		fetch = append(fetch, func() (err error) { det, err = s.detraccionesBuildRows(companies, periodYM); return })
	}
	if want(PdfReportInformeDetracciones.DeclType) {
		fetch = append(fetch, func() error {
			inf = s.pdfReportBuildRows(PdfReportInformeDetracciones, companies, periodYM)
			return nil
		})
	}
	if want(PdfReportSiscontBalances.DeclType) {
		fetch = append(fetch, func() error { sis = s.pdfReportBuildRows(PdfReportSiscontBalances, companies, periodYM); return nil })
	}
	if want(models.SupervisorDeclPreliminarVentas) {
		fetch = append(fetch, func() error { prelim = s.preliminarVentasSlotWork(companies, periodYM); return nil })
	}
	if err := runParallel(6, fetch); err != nil {
		return nil, err
	}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	cache := map[uint]*time.Time{}
	acts601, _ := CalendarActivitiesForType(periodYM, models.CalendarActivityPDT601)
	acts621, _ := CalendarActivitiesForType(periodYM, models.CalendarActivityPDT621)

	acc := newAssistantAcc()
	// Se fija el orden de los módulos aunque alguno no tenga tareas.
	acc.mod(models.SupervisorDeclPDT601, "PDT 601", assistantOwnerAssistant)
	acc.mod(models.SupervisorDeclPDT621, "PDT 621", assistantOwnerAssistant)
	if includeSupervisor {
		acc.mod(pdt621DeclarationKey, "PDT 621 · Declaración", assistantOwnerSupervisor)
	}
	acc.mod(models.SupervisorDeclDetracciones, "Estado cta. detracciones", assistantOwnerAssistant)
	acc.mod(models.SupervisorDeclSunatInbox, "Buzón SOL", assistantOwnerAssistant)
	acc.mod(PdfReportInformeDetracciones.DeclType, PdfReportInformeDetracciones.Label, assistantOwnerAssistant)
	acc.mod(PdfReportSiscontBalances.DeclType, PdfReportSiscontBalances.Label, assistantOwnerAssistant)
	acc.mod(models.SupervisorDeclPreliminarVentas, "Preliminar de ventas", assistantOwnerAssistant)

	items := []AssistantWorkItem{}
	newItem := func(key, label, owner string, companyID uint, company, ruc string, declID *uint, state string, due *time.Time, detail string) AssistantWorkItem {
		it := AssistantWorkItem{CompanyID: companyID, Company: strings.TrimSpace(company), RUC: ruc, ModuleKey: key, ModuleLabel: label, State: state, Owner: owner, Detail: detail}
		if declID != nil {
			it.DeclarationID = *declID
		}
		if due != nil {
			it.DueDate = due.Format("2006-01-02")
			d := daysUntil(*due, today)
			it.DaysLeft = &d
		}
		return it
	}
	// record cuenta la tarea en su módulo y, si sigue abierta, la agrega a la lista de trabajo.
	record := func(key, label, owner string, companyID uint, company, ruc string, declID *uint, state string, onTime bool, due *time.Time, detail string) *AssistantWorkItem {
		m := acc.mod(key, label, owner)
		m.add(state, onTime)
		acc.addDigit(key, ruc, state, onTime)
		if state == assistantTaskDone || !wantWork {
			return nil
		}
		items = append(items, newItem(key, label, owner, companyID, company, ruc, declID, state, due, detail))
		return &items[len(items)-1]
	}

	planillaAcc := newPlanillaLoadAcc(companies)
	for _, r := range pdt601 {
		m := acc.mod(models.SupervisorDeclPDT601, "PDT 601", assistantOwnerAssistant)
		exempt := r.Suspendida || (r.Planilla != nil && r.Planilla.SinPlanilla)
		st, onTime, applies := assistantTaskState(r.Status, r.Timeliness, exempt)
		if !applies {
			m.NotApplicable++
			continue
		}
		onp, afp := 0, 0
		if r.Planilla != nil {
			onp, afp = r.Planilla.TrabajadoresONP, r.Planilla.TrabajadoresAFP
		}
		planillaAcc.addCompany(r.CompanyID, onp, afp)
		planillaAcc.addTask(r.CompanyID, st == assistantTaskDone)
		record(models.SupervisorDeclPDT601, "PDT 601", assistantOwnerAssistant, r.CompanyID, r.BusinessName, r.RUC, r.DeclarationID, st, onTime, calendarDeadlineFor(periodYM, acts601, r.Dig, cache), "")
	}

	for _, r := range pdt621 {
		due := calendarDeadlineFor(periodYM, acts621, r.Dig, cache)
		arch := acc.mod(models.SupervisorDeclPDT621, "PDT 621", assistantOwnerAssistant)
		if r.Suspendida {
			arch.NotApplicable++
			if includeSupervisor {
				acc.mod(pdt621DeclarationKey, "PDT 621 · Declaración", assistantOwnerSupervisor).NotApplicable++
			}
			continue
		}
		if want(models.SupervisorDeclPDT621) {
			// Archivador: queda completado cuando el supervisor lo recepciona (Por revisar o Entregado), salvo que lo observe.
			st := assistantTaskPending
			onTime := false
			switch r.Status {
			case models.SupervisorDeclObservado:
				st = assistantTaskObserved
			case models.SupervisorDeclPorRevisar, models.SupervisorDeclEntregado, models.SupervisorDeclAprobado,
				models.SupervisorDeclPresentado, models.SupervisorDeclCerrado:
				st, onTime = assistantTaskDone, r.AssistantTimeliness != TimelinessLate
			default:
				if r.AssistantTimeliness == TimelinessMissing {
					st = assistantTaskOverdue
				}
			}
			record(models.SupervisorDeclPDT621, "PDT 621", assistantOwnerAssistant, r.CompanyID, r.BusinessName, r.RUC, r.DeclarationID, st, onTime, due, "")
		}
		if includeSupervisor && want(pdt621DeclarationKey) {
			// Declaración: la fecha de declaración la registra el supervisor, contra la misma actividad del calendario.
			declared := r.Record != nil && r.Record.FechaDeclaracion != nil && strings.TrimSpace(*r.Record.FechaDeclaracion) != ""
			st := assistantTaskPending
			onTime := false
			switch {
			case declared:
				st, onTime = assistantTaskDone, r.DeclarationTimeliness != TimelinessLate
			case r.DeclarationTimeliness == TimelinessMissing:
				st = assistantTaskOverdue
			}
			it := record(pdt621DeclarationKey, "PDT 621 · Declaración", assistantOwnerSupervisor, r.CompanyID, r.BusinessName, r.RUC, r.DeclarationID, st, onTime, due, "")
			if it != nil && r.Status == models.SupervisorDeclPendiente {
				it.Hint = "Falta que el asistente entregue el archivador"
			}
		}
	}

	for _, r := range det {
		m := acc.mod(models.SupervisorDeclDetracciones, "Estado cta. detracciones", assistantOwnerAssistant)
		exempt := r.Suspendida || detraccionesIsExemptStatus(r.Status)
		st, onTime, applies := assistantTaskState(r.Status, r.Timeliness.Timeliness, exempt)
		if !applies {
			m.NotApplicable++
			continue
		}
		record(models.SupervisorDeclDetracciones, "Estado cta. detracciones", assistantOwnerAssistant, r.CompanyID, r.BusinessName, r.RUC, r.DeclarationID, st, onTime, r.Timeliness.DueAt, "")
	}

	for _, pair := range []struct {
		mod  PdfReportModule
		rows []PdfReportListRow
	}{{PdfReportInformeDetracciones, inf}, {PdfReportSiscontBalances, sis}} {
		for _, r := range pair.rows {
			m := acc.mod(pair.mod.DeclType, pair.mod.Label, assistantOwnerAssistant)
			st, onTime, applies := assistantTaskState(r.Status, r.Timeliness, r.Suspendida)
			if !applies {
				m.NotApplicable++
				continue
			}
			var due *time.Time
			if r.DueDate != nil {
				due = pdt601ParseDate(*r.DueDate)
			}
			record(pair.mod.DeclType, pair.mod.Label, assistantOwnerAssistant, r.CompanyID, r.BusinessName, r.RUC, r.DeclarationID, st, onTime, due, "")
		}
	}

	for _, w := range prelim {
		m := acc.mod(models.SupervisorDeclPreliminarVentas, "Preliminar de ventas", assistantOwnerAssistant)
		if w.Suspendida {
			m.NotApplicable++
			continue
		}
		// La entrega cuenta desde que se REGISTRAN los datos (aunque falte enviarla): ver preliminarSlotTimeliness.
		registrada := w.Status == models.PreliminarVentasRegistrado || w.Status == models.PreliminarVentasEnviado
		st, onTime := assistantTaskPending, false
		switch {
		case registrada:
			st, onTime = assistantTaskDone, w.Timeliness.Timeliness != TimelinessLate
		case w.Timeliness.Timeliness == TimelinessMissing:
			st = assistantTaskOverdue
		}
		it := record(models.SupervisorDeclPreliminarVentas, "Preliminar de ventas", assistantOwnerAssistant, w.Company.ID, w.Company.BusinessName, w.Company.RUC, nil, st, onTime, w.Timeliness.DueAt, "")
		if it != nil {
			it.Slot = w.SlotIndex
		}
		if wantWork && w.Status == models.PreliminarVentasRegistrado {
			// Ya cuenta como entregada, pero sigue en la lista hasta enviarla al cliente.
			extra := newItem(models.SupervisorDeclPreliminarVentas, "Preliminar de ventas", assistantOwnerAssistant, w.Company.ID, w.Company.BusinessName, w.Company.RUC, nil, assistantTaskPending, w.Timeliness.DueAt, "")
			extra.Slot = w.SlotIndex
			extra.Hint = "Ya registrada: falta enviarla al cliente"
			items = append(items, extra)
		}
	}

	if want(models.SupervisorDeclSunatInbox) {
		bm := acc.mod(models.SupervisorDeclSunatInbox, "Buzón SOL", assistantOwnerAssistant)
		if slots := sunatInboxRealSlotsForPeriod(periodYM); len(slots) > 0 {
			ids := make([]uint, 0, len(companies))
			for _, c := range companies {
				ids = append(ids, c.ID)
			}
			// Cada semana de cada empresa son dos tareas: la captura de SUNAT y la de SUNAFIL. Las vencidas se cuentan por
			// empresa para la lista de trabajo (una fila por empresa, no miles de filas).
			overduePerCompany := map[uint]int64{}
			sunatInboxEachVerdict(periodYM, ids, slots, func(companyID uint, sunat, sunafil string) {
				for _, v := range []string{sunat, sunafil} {
					switch v {
					case TimelinessOnTime:
						bm.add(assistantTaskDone, true)
					case TimelinessLate:
						bm.add(assistantTaskDone, false)
					case TimelinessMissing:
						bm.add(assistantTaskOverdue, false)
						overduePerCompany[companyID]++
					case TimelinessPending:
						bm.add(assistantTaskPending, false)
					default:
						bm.NotApplicable++
					}
				}
			})
			if wantWork {
				for _, c := range companies {
					n := overduePerCompany[c.ID]
					if n == 0 {
						continue
					}
					it := newItem(models.SupervisorDeclSunatInbox, "Buzón SOL", assistantOwnerAssistant, c.ID, c.BusinessName, c.RUC, nil, assistantTaskOverdue, nil, "")
					it.Detail = fmt.Sprintf("%d capturas vencidas", n)
					if n == 1 {
						it.Detail = "1 captura vencida"
					}
					it.Hint = "Capturas semanales de SUNAT y SUNAFIL sin hacer en este periodo"
					items = append(items, it)
				}
			}
		}
		// Capturas que el supervisor observó: ya contaban como entregadas; pasan a observadas (siguen abiertas).
		for _, obs := range s.assistantObservedMailboxes(companies, periodYM) {
			if bm.Completed > 0 {
				bm.Completed--
				if bm.OnTime > 0 {
					bm.OnTime--
				} else if bm.Late > 0 {
					bm.Late--
				}
			}
			bm.Observed++
			if wantWork {
				obs.Owner = assistantOwnerAssistant
				items = append(items, obs)
			}
		}
	}

	for _, key := range acc.order {
		m := acc.mods[key]
		m.finalize()
		m.ByDigit = acc.byDigit(key)
		out.Modules = append(out.Modules, *m)
		out.Progress.merge(m.AssistantProgress)
	}
	out.Progress.finalize()
	if wantWork {
		out.Work = items
	}
	if wantWork && len(pdt601) > 0 { // la tendencia de meses no lo necesita
		out.PlanillaLoad = planillaAcc.finish(s, periodYM)
		for i := range out.Modules {
			if out.Modules[i].Key == models.SupervisorDeclPDT601 {
				out.Modules[i].Planilla = out.PlanillaLoad
			}
		}
	}
	return out, nil
}

// trendCacheTTL cuánto se recuerda el avance de un mes ya terminado (casi no cambia y cada uno cuesta armar todas las tareas
// del estudio). 0 = sin caché (los tests).
var trendCacheTTL = 2 * time.Minute

type trendCacheEntry struct {
	point AssistantTrendPoint
	at    time.Time
}

var trendCache = struct {
	sync.Mutex
	m map[string]trendCacheEntry
}{m: map[string]trendCacheEntry{}}

// trendCacheKey identifica el avance de un mes para un alcance: el periodo, el módulo, si incluye al supervisor y quién se
// está mirando (empresas permitidas, supervisor y responsable elegidos).
func trendCacheKey(p SupervisorDashboardParams, period string, includeSupervisor bool, moduleKey string) string {
	pp := p
	pp.PeriodYM = period
	return fmt.Sprintf("%p|%s|%t|%s|%v", database.DB, period, includeSupervisor, moduleKey, pp)
}

// assistantProgressTrend avance de los últimos meses con la misma fórmula del panel. Los meses sin tareas medidas salen con
// Total 0 (la pantalla los muestra como «sin datos»). El ÚLTIMO mes es el del periodo que se está viendo: ya lo calcula quien
// llama con la carga principal, así que aquí queda en blanco y se completa con ese avance (no se arma dos veces). Los meses
// anteriores se recuerdan unos minutos.
func (s *SupervisorService) assistantProgressTrend(p SupervisorDashboardParams, includeSupervisor bool, moduleKey string, months int) []AssistantTrendPoint {
	points := make([]AssistantTrendPoint, months)
	tasks := make([]func() error, 0, months)
	for i := 0; i < months; i++ {
		i := i
		period := shiftPeriodYM(p.PeriodYM, -(months - 1 - i))
		points[i] = AssistantTrendPoint{PeriodYM: period}
		if i == months-1 {
			continue
		}
		key := trendCacheKey(p, period, includeSupervisor, moduleKey)
		if trendCacheTTL > 0 {
			trendCache.Lock()
			e, ok := trendCache.m[key]
			trendCache.Unlock()
			if ok && time.Since(e.at) < trendCacheTTL {
				points[i] = e.point
				continue
			}
		}
		tasks = append(tasks, func() error {
			pp := p
			pp.PeriodYM = period
			scope, err := s.dashboardScopeCompanies(pp)
			if err != nil {
				return nil
			}
			b, err := s.assistantBuild(period, scope, includeSupervisor, moduleKey, false)
			if err != nil || b == nil {
				return nil
			}
			points[i].Pct, points[i].Total, points[i].Completed = b.Progress.Pct, b.Progress.Total, b.Progress.Completed
			if trendCacheTTL > 0 {
				trendCache.Lock()
				if len(trendCache.m) > 2000 {
					trendCache.m = map[string]trendCacheEntry{}
				}
				trendCache.m[key] = trendCacheEntry{point: points[i], at: time.Now()}
				trendCache.Unlock()
			}
			return nil
		})
	}
	_ = runParallel(3, tasks)
	return points
}

// assistantWorkCounts conteos de las pestañas de la lista de trabajo, sobre TODA la lista (sin el corte de la pantalla).
func assistantWorkCounts(items []AssistantWorkItem) AssistantCounts {
	var c AssistantCounts
	c.All = int64(len(items))
	for _, it := range items {
		switch it.State {
		case assistantTaskOverdue:
			c.ToDeliver++
			c.Overdue++
			if it.DaysLeft != nil && *it.DaysLeft < -3 {
				c.OverdueOver3++
			}
		case assistantTaskPending:
			c.ToDeliver++
			if it.DaysLeft != nil && *it.DaysLeft >= 0 && *it.DaysLeft <= 7 {
				c.DueThisWeek++
			}
		case assistantTaskObserved:
			c.Observed++
		case assistantTaskInReview:
			c.InReview++
		}
	}
	return c
}

// sortAssistantWork orden de urgencia: vencido, devuelto por el supervisor, por vencer, enviado.
func sortAssistantWork(items []AssistantWorkItem) {
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
}
