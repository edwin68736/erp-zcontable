package services

import (
	"errors"
	"math"
	"sort"
	"strings"

	"miappfiber/database"
	"miappfiber/models"
)

// Indicadores de supervisión (libro "INDICADORES DE SUPERVISIÓN CONTABLE" que el estudio llevaba en
// Excel por supervisor y mes): los mismos 5 KPI y el resumen de buzones, pero calculados con los datos
// del sistema y sobre el alcance del dashboard (un supervisor ve su cartera; el administrador ve todo
// el estudio o filtra por un supervisor).
//
//	KPI 2 Entrega de planillas      PDT 601: entrega a tiempo (calendario) sobre las empresas con planilla.
//	KPI 3 Entrega de archivadores   PDT 621: 1.ª entrega del asistente vs. el plazo interno del estudio.
//	KPI 4 Declaraciones en plazo    PDT 621: fecha de declaración vs. el cronograma SUNAT por dígito de RUC.
//	KPI 5 Revisión de balances      Siscont balances: revisados (entregado) sobre los que aplican.
//	Buzones                         SUNAT / SUNAFIL por asistente: a tiempo, pendientes, fuera de plazo.
//
// KPI 1 (tiempo de primera respuesta) no se calcula: el sistema no registra ese dato.
// Cada tasa es "a tiempo / total" del conjunto (no un promedio de las tasas por dígito).

type IndicatorDigit struct {
	Dig      string  `json:"dig"`
	Total    int64   `json:"total"`
	OnTime   int64   `json:"on_time"` // a tiempo (KPI 2-4) o revisado/entregado (KPI 5)
	Late     int64   `json:"late"`
	Missing  int64   `json:"missing"`
	Pending  int64   `json:"pending"`
	Observed int64   `json:"observed,omitempty"`
	InReview int64   `json:"in_review,omitempty"`
	RatePct  float64 `json:"rate_pct"`
}

type IndicatorKpi struct {
	Key     string           `json:"key"`
	Label   string           `json:"label"`
	MetaPct float64          `json:"meta_pct"`
	Total   IndicatorDigit   `json:"total"`
	ByDigit []IndicatorDigit `json:"by_digit"`
	// NoDigit empresas incluidas en `total` que no tienen dígito de RUC y por eso no aparecen en `by_digit`.
	NoDigit int64 `json:"no_digit,omitempty"`
}

type IndicatorMailboxRow struct {
	Assistant      string `json:"assistant"`
	SunatOk        int64  `json:"sunat_ok"`
	SunatPending   int64  `json:"sunat_pending"`
	SunatLate      int64  `json:"sunat_late"`
	SunafilOk      int64  `json:"sunafil_ok"`
	SunafilPending int64  `json:"sunafil_pending"`
	SunafilLate    int64  `json:"sunafil_late"`
}

type SupervisorIndicators struct {
	PeriodYM    string                   `json:"period_ym"`
	Companies   int64                    `json:"companies"`
	Supervisors []AssistantSupervisorRef `json:"supervisors"`
	Kpis        []IndicatorKpi           `json:"kpis"`
	Mailboxes   []IndicatorMailboxRow    `json:"mailboxes"`
}

// indicatorDigitAcc acumula los 10 dígitos de un KPI.
type indicatorDigitAcc struct {
	byDig map[string]*IndicatorDigit
	// noDig empresas sin dígito de RUC numérico en sus claves: cuentan en el total del KPI (para que
	// coincida con los módulos) pero no caen en ninguna fila de las tablas por dígito.
	noDig IndicatorDigit
}

func newIndicatorDigitAcc() *indicatorDigitAcc {
	a := &indicatorDigitAcc{byDig: map[string]*IndicatorDigit{}}
	for d := '0'; d <= '9'; d++ {
		a.byDig[string(d)] = &IndicatorDigit{Dig: string(d)}
	}
	return a
}

// row fila del dígito (o la de "sin dígito" cuando la clave no trae un dígito numérico).
func (a *indicatorDigitAcc) row(dig string) *IndicatorDigit {
	if r := a.byDig[indicatorDigit(dig)]; r != nil {
		return r
	}
	return &a.noDig
}

// indicatorDigit primer carácter numérico del dígito de RUC de la clave SOL ("" si no hay).
func indicatorDigit(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw[0] < '0' || raw[0] > '9' {
		return ""
	}
	return raw[:1]
}

// addTimeliness suma un veredicto de puntualidad (los exentos no cuentan).
func (a *indicatorDigitAcc) addTimeliness(dig, timeliness string) {
	row := a.row(dig)
	if timeliness == TimelinessExempt {
		return
	}
	row.Total++
	switch timeliness {
	case TimelinessOnTime:
		row.OnTime++
	case TimelinessLate:
		row.Late++
	case TimelinessMissing:
		row.Missing++
	default:
		row.Pending++
	}
}

// addReviewStatus suma el estado de un módulo con revisión (Siscont balances).
func (a *indicatorDigitAcc) addReviewStatus(dig, status string) {
	row := a.row(dig)
	row.Total++
	switch status {
	case models.SupervisorDeclEntregado, models.SupervisorDeclAprobado, models.SupervisorDeclPresentado, models.SupervisorDeclCerrado:
		row.OnTime++
	case models.SupervisorDeclObservado:
		row.Observed++
	case models.SupervisorDeclPorRevisar:
		row.InReview++
	default:
		row.Pending++
	}
}

func indicatorRate(onTime, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return math.Round(float64(onTime)/float64(total)*1000) / 10
}

func (a *indicatorDigitAcc) kpi(key, label string, meta float64) IndicatorKpi {
	out := IndicatorKpi{Key: key, Label: label, MetaPct: meta, ByDigit: make([]IndicatorDigit, 0, 10)}
	for d := '0'; d <= '9'; d++ {
		row := *a.byDig[string(d)]
		row.RatePct = indicatorRate(row.OnTime, row.Total)
		out.ByDigit = append(out.ByDigit, row)
		out.Total.Total += row.Total
		out.Total.OnTime += row.OnTime
		out.Total.Late += row.Late
		out.Total.Missing += row.Missing
		out.Total.Pending += row.Pending
		out.Total.Observed += row.Observed
		out.Total.InReview += row.InReview
	}
	n := a.noDig
	out.Total.Total += n.Total
	out.Total.OnTime += n.OnTime
	out.Total.Late += n.Late
	out.Total.Missing += n.Missing
	out.Total.Pending += n.Pending
	out.Total.Observed += n.Observed
	out.Total.InReview += n.InReview
	out.NoDigit = n.Total
	out.Total.RatePct = indicatorRate(out.Total.OnTime, out.Total.Total)
	return out
}

func (s *SupervisorService) indicatorKpis(k2, k3, k4, k5 *indicatorDigitAcc) []IndicatorKpi {
	return []IndicatorKpi{
		k2.kpi("planillas", "Entrega de planillas", 95),
		k3.kpi("archivadores", "Entrega de archivadores", 95),
		k4.kpi("declaraciones", "Declaraciones en plazo", 95),
		k5.kpi("balances", "Revisión de balances", 100),
	}
}

// SupervisorIndicators arma los indicadores con el mismo alcance y filtros que el resto del dashboard.
func (s *SupervisorService) SupervisorIndicators(p SupervisorDashboardParams) (*SupervisorIndicators, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	companies, err := s.dashboardScopeCompanies(p)
	if err != nil {
		return nil, err
	}
	out := &SupervisorIndicators{
		PeriodYM: p.PeriodYM, Companies: int64(len(companies)), Supervisors: s.assistantSupervisors(companies),
		Kpis: []IndicatorKpi{}, Mailboxes: []IndicatorMailboxRow{},
	}
	k2, k3, k4, k5 := newIndicatorDigitAcc(), newIndicatorDigitAcc(), newIndicatorDigitAcc(), newIndicatorDigitAcc()
	if len(companies) == 0 {
		out.Kpis = s.indicatorKpis(k2, k3, k4, k5)
		return out, nil
	}

	var (
		pdt601 []Pdt601ListRow
		pdt621 []Pdt621ListRow
		sis    []PdfReportListRow
	)
	tasks := []func() error{
		func() (err error) { pdt601, err = s.pdt601BuildRows(companies, p.PeriodYM); return },
		func() (err error) { pdt621, err = s.pdt621BuildRows(companies, p.PeriodYM); return },
		func() error { sis = s.pdfReportBuildRows(PdfReportSiscontBalances, companies, p.PeriodYM); return nil },
		func() error { out.Mailboxes = s.indicatorMailboxes(p.PeriodYM, companies); return nil },
	}
	if err := runParallel(4, tasks); err != nil {
		return nil, err
	}

	for _, r := range pdt601 {
		if r.Suspendida || (r.Planilla != nil && r.Planilla.SinPlanilla) {
			continue
		}
		k2.addTimeliness(r.Dig, r.Timeliness)
	}
	for _, r := range pdt621 {
		if r.Suspendida {
			continue
		}
		k3.addTimeliness(r.Dig, r.AssistantTimeliness)
		k4.addTimeliness(r.Dig, r.DeclarationTimeliness)
	}
	for _, r := range sis {
		if r.Suspendida {
			continue
		}
		k5.addReviewStatus(r.Dig, r.Status)
	}
	out.Kpis = s.indicatorKpis(k2, k3, k4, k5)
	return out, nil
}

// indicatorMailboxes buzones SUNAT/SUNAFIL por asistente con los mismos veredictos que el
// cumplimiento (slots reales del calendario): a tiempo, pendientes (incluye lo vencido sin subir) y
// subidos fuera de plazo.
func (s *SupervisorService) indicatorMailboxes(periodYM string, companies []models.Company) []IndicatorMailboxRow {
	realSlots := sunatInboxRealSlotsForPeriod(periodYM)
	if len(realSlots) == 0 || len(companies) == 0 {
		return []IndicatorMailboxRow{}
	}
	assistantOf := map[uint]uint{}
	ids := make([]uint, 0, len(companies))
	userIDs := []uint{}
	seen := map[uint]bool{}
	for _, c := range companies {
		ids = append(ids, c.ID)
		if c.AssistantUserID != nil {
			assistantOf[c.ID] = *c.AssistantUserID
			if !seen[*c.AssistantUserID] {
				seen[*c.AssistantUserID] = true
				userIDs = append(userIDs, *c.AssistantUserID)
			}
		}
	}
	names := map[uint]string{}
	if len(userIDs) > 0 {
		var users []models.User
		_ = database.DB.Select("id", "name", "username").Where("id IN ?", userIDs).Find(&users).Error
		for _, u := range users {
			n := strings.TrimSpace(u.Username)
			if n == "" {
				n = strings.TrimSpace(u.Name)
			}
			names[u.ID] = strings.ToUpper(n)
		}
	}

	byAssistant := map[uint]*IndicatorMailboxRow{}
	bump := func(timeliness string, ok, pending, late *int64) {
		switch timeliness {
		case TimelinessOnTime:
			*ok++
		case TimelinessLate:
			*late++
		case TimelinessPending, TimelinessMissing:
			*pending++
		}
	}
	sunatInboxEachVerdict(periodYM, ids, realSlots, func(companyID uint, sunat, sunafil string) {
		aid := assistantOf[companyID]
		row := byAssistant[aid]
		if row == nil {
			name := names[aid]
			if aid == 0 {
				name = "SIN ASISTENTE"
			} else if name == "" {
				name = "USUARIO"
			}
			row = &IndicatorMailboxRow{Assistant: name}
			byAssistant[aid] = row
		}
		bump(sunat, &row.SunatOk, &row.SunatPending, &row.SunatLate)
		bump(sunafil, &row.SunafilOk, &row.SunafilPending, &row.SunafilLate)
	})
	out := make([]IndicatorMailboxRow, 0, len(byAssistant))
	for _, r := range byAssistant {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Assistant < out[j].Assistant })
	return out
}
