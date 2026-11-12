package services

import (
	"fmt"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Cumplimiento del dashboard del supervisor desde la MISMA lista de tareas que el panel del asistente
// (supervisor_assistant_tasks.go). Antes el cumplimiento general, la tendencia, el ranking y el cuadro por módulo salían de
// otras consultas (agrupaciones SQL por estado) con otro universo de empresas y otros criterios: las cifras no coincidían con
// el panel del asistente ni entre sí. Ahora hay una sola fuente: se arman las tareas de TODO el estudio una vez por periodo
// (se recuerda unos segundos) y cualquier subconjunto —un supervisor, un asistente, un filtro— es solo una suma por empresa.
//
// Módulos que cuentan en el cumplimiento general: PDT 601, PDT 621 · Declaración (la tarea del supervisor), Estado cta.
// detracciones y Buzón SOL. El archivador del PDT 621, el Informe de detracciones, Siscont balances y Preliminar de ventas
// se muestran en el cuadro por módulo pero no entran en el porcentaje (ver complianceCountsModule).
//
// Cada tarea cae en una de las 5 categorías del cumplimiento: a tiempo, fuera de plazo (entregadas); vencida (sin entregar y
// fuera de plazo); pendiente (sin vencer, ya entregada y por revisar u observada: no se castiga todavía); y no aplica (empresa
// suspendida o sin planilla). Cumplimiento % = a tiempo ÷ (a tiempo + fuera de plazo + vencidas).

// complianceCountsModule dice si un módulo entra en el porcentaje de cumplimiento general.
func complianceCountsModule(key string) bool {
	switch key {
	case models.SupervisorDeclPDT601, pdt621DeclarationKey, models.SupervisorDeclDetracciones, models.SupervisorDeclSunatInbox:
		return true
	}
	return false
}

// complianceCacheTTL cuánto se recuerda el cálculo de un periodo en curso; el de un periodo ya cerrado casi no cambia y se
// recuerda más. 0 = sin caché (los tests).
var (
	complianceCacheTTL     = 30 * time.Second
	complianceCacheTTLPast = 5 * time.Minute
)

// studioCompliance las tareas de todo el estudio en un periodo, con el conteo por empresa y módulo.
type studioCompliance struct {
	modules    []AssistantModuleProgress // en el orden del panel; sirven para los rótulos
	perCompany map[uint]map[string]AssistantProgress
}

type studioComplianceSlot struct {
	mu sync.Mutex
	v  *studioCompliance
	at time.Time
}

var studioComplianceCache = struct {
	sync.Mutex
	m map[string]*studioComplianceSlot
}{m: map[string]*studioComplianceSlot{}}

func complianceTTLFor(periodYM string) time.Duration {
	if periodYM < time.Now().Format("2006-01") {
		return complianceCacheTTLPast
	}
	return complianceCacheTTL
}

// studioComplianceFor arma (o recuerda unos segundos) las tareas de todas las empresas activas del estudio en el periodo.
// Las peticiones simultáneas del mismo periodo esperan a la primera en vez de armarlo cada una.
func (s *SupervisorService) studioComplianceFor(periodYM string) (*studioCompliance, error) {
	key := fmt.Sprintf("%p|%s", database.DB, periodYM)
	studioComplianceCache.Lock()
	if len(studioComplianceCache.m) > 200 {
		studioComplianceCache.m = map[string]*studioComplianceSlot{}
	}
	slot, ok := studioComplianceCache.m[key]
	if !ok {
		slot = &studioComplianceSlot{}
		studioComplianceCache.m[key] = slot
	}
	studioComplianceCache.Unlock()

	slot.mu.Lock()
	defer slot.mu.Unlock()
	ttl := complianceTTLFor(periodYM)
	if slot.v != nil && ttl > 0 && time.Since(slot.at) < ttl {
		return slot.v, nil
	}
	companies, err := s.dashboardScopeCompanies(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		return nil, err
	}
	sc := &studioCompliance{perCompany: map[uint]map[string]AssistantProgress{}}
	if len(companies) > 0 {
		b, err := s.assistantBuild(periodYM, companies, true, "", false)
		if err != nil {
			return nil, err
		}
		sc.modules, sc.perCompany = b.Modules, b.PerCompany
	}
	slot.v, slot.at = sc, time.Now()
	return sc, nil
}

// sum suma el conteo de las empresas indicadas (nil = todas) por módulo.
func (sc *studioCompliance) sum(only map[uint]bool) map[string]*AssistantProgress {
	out := map[string]*AssistantProgress{}
	for cid, byMod := range sc.perCompany {
		if only != nil && !only[cid] {
			continue
		}
		for key, p := range byMod {
			acc, ok := out[key]
			if !ok {
				acc = &AssistantProgress{}
				out[key] = acc
			}
			acc.merge(p)
		}
	}
	return out
}

// summaryFor el cumplimiento general (5 categorías) y las filas por módulo de un conjunto de empresas.
func (sc *studioCompliance) summaryFor(only map[uint]bool) (ComplianceSummary, []DashboardModuleRow) {
	sums := sc.sum(only)
	var cs ComplianceSummary
	rows := make([]DashboardModuleRow, 0, len(sc.modules))
	for _, m := range sc.modules {
		p, ok := sums[m.Key]
		if !ok {
			continue
		}
		p.finalize()
		if p.Total == 0 && p.NotApplicable == 0 {
			continue // módulo sin tareas en el periodo (por ejemplo, Preliminar de ventas sin calendario)
		}
		counts := complianceCountsModule(m.Key)
		rows = append(rows, DashboardModuleRow{
			Key: m.Key, Label: m.Label, Owner: m.Owner, Counts: counts,
			Pendiente: p.Pending + p.InReview, Observado: p.Observed, Vencido: p.Overdue, ATiempo: p.OnTime, FueraFecha: p.Late,
			Total: p.Total, SinCompleta: p.Total - p.Completed,
		})
		if counts {
			cs.OnTime += p.OnTime
			cs.Late += p.Late
			cs.Missing += p.Overdue
			cs.Pending += p.Pending + p.InReview + p.Observed
			cs.Exempt += p.NotApplicable
		}
	}
	cs.Total = cs.OnTime + cs.Late + cs.Missing + cs.Pending + cs.Exempt
	cs.finalize()
	return cs, rows
}

func idSet(ids []uint) map[uint]bool {
	out := make(map[uint]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

func companyIDSet(companies []models.Company) map[uint]bool {
	out := make(map[uint]bool, len(companies))
	for _, c := range companies {
		out[c.ID] = true
	}
	return out
}
