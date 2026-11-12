package services

import (
	"fmt"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Cumplimiento del dashboard del supervisor desde la MISMA lista de tareas que el panel del asistente
// (supervisor_assistant_tasks.go). Se arman las tareas de TODO el estudio una vez por periodo (se recuerda unos segundos) y
// cualquier subconjunto —un supervisor, un asistente, un filtro— es solo una suma por empresa, así las cifras no se contradicen.
//
// Hay DOS indicadores, porque no es lo mismo cumplir una obligación tributaria que una tarea operativa del estudio:
//
//	Cumplimiento tributario (el titular): PDT 601, PDT 621 · Declaración y Estado cta. detracciones. Es lo que responde el supervisor.
//	Cumplimiento operativo: Buzón SOL, archivador del PDT 621, Preliminar de ventas, Informe de detracciones y Siscont balances.
//
// El Buzón SOL son miles de capturas semanales: sumado al tributario lo hundía sin decir nada de las declaraciones. Informe de
// detracciones y Siscont balances no cuentan mientras el estudio no entregue ninguno («sin uso»): tienen fecha en el calendario y,
// al vencer, aparecerían como cientos de vencidos por algo que todavía no se usa.
//
// Cada tarea cae en una de las 5 categorías del cumplimiento:
//
//	a tiempo / fuera de plazo   entregadas;
//	vencida                     sin entregar y fuera de plazo, o OBSERVADA con el plazo ya vencido (regla del estudio, §5.9.2b);
//	pendiente                   sin vencer, ya entregada y por revisar, u observada con plazo vigente: no se castiga todavía;
//	no aplica                   empresa suspendida o sin planilla.
//
// Cumplimiento % = a tiempo ÷ (a tiempo + fuera de plazo + vencidas).

const (
	complianceGroupTax = "tributario"
	complianceGroupOps = "operativo"
)

// complianceGroup el indicador al que pertenece un módulo.
func complianceGroup(key string) string {
	switch key {
	case models.SupervisorDeclPDT601, pdt621DeclarationKey, models.SupervisorDeclDetracciones:
		return complianceGroupTax
	}
	return complianceGroupOps
}

// complianceUnusedCandidate módulos que pueden quedar «sin uso» (nadie los entrega todavía en el estudio).
func complianceUnusedCandidate(key string) bool {
	return key == models.SupervisorDeclInformeDetracciones || key == models.SupervisorDeclSiscontBalances
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
	// unused módulos que nadie del estudio entrega todavía (se decide sobre todo el estudio, no sobre el alcance que se mira).
	unused map[string]bool
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
	sc := &studioCompliance{perCompany: map[uint]map[string]AssistantProgress{}, unused: map[string]bool{}}
	if len(companies) > 0 {
		b, err := s.assistantBuild(periodYM, companies, true, "", false)
		if err != nil {
			return nil, err
		}
		sc.modules, sc.perCompany = b.Modules, b.PerCompany
		for key, p := range sc.sum(nil) {
			if complianceUnusedCandidate(key) && p.Completed+p.InReview+p.Observed == 0 {
				sc.unused[key] = true
			}
		}
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

// addTo suma un módulo a un cumplimiento (las 5 categorías).
func (cs *ComplianceSummary) addProgress(p *AssistantProgress) {
	cs.OnTime += p.OnTime
	cs.Late += p.Late
	cs.Missing += p.Overdue + p.ObservedOverdue
	cs.Pending += p.Pending + p.InReview + (p.Observed - p.ObservedOverdue)
	cs.Exempt += p.NotApplicable
}

// complianceBoth el cumplimiento tributario y el operativo de un conjunto de empresas, y las filas del cuadro por módulo.
type complianceBoth struct {
	Tax, Ops ComplianceSummary
	Rows     []DashboardModuleRow
}

// summaryFor arma el cumplimiento tributario, el operativo y las filas por módulo de un conjunto de empresas (nil = todo el
// estudio).
func (sc *studioCompliance) summaryFor(only map[uint]bool) complianceBoth {
	sums := sc.sum(only)
	var out complianceBoth
	out.Rows = make([]DashboardModuleRow, 0, len(sc.modules))
	for _, m := range sc.modules {
		p, ok := sums[m.Key]
		if !ok {
			continue
		}
		p.finalize()
		if p.Total == 0 && p.NotApplicable == 0 {
			continue // módulo sin tareas en el periodo (por ejemplo, Preliminar de ventas sin calendario)
		}
		unused := sc.unused[m.Key]
		group := complianceGroup(m.Key)
		out.Rows = append(out.Rows, DashboardModuleRow{
			Key: m.Key, Label: m.Label, Owner: m.Owner, Group: group, Counts: !unused, Unused: unused,
			// Las columnas se reparten sin repetir tareas: lo observado con el plazo vencido cuenta como vencido.
			Pendiente: p.Pending + p.InReview, Observado: p.Observed - p.ObservedOverdue, Vencido: p.Overdue + p.ObservedOverdue,
			ATiempo: p.OnTime, FueraFecha: p.Late, Total: p.Total, SinCompleta: p.Total - p.Completed,
		})
		if unused {
			continue
		}
		if group == complianceGroupTax {
			out.Tax.addProgress(p)
		} else {
			out.Ops.addProgress(p)
		}
	}
	for _, cs := range []*ComplianceSummary{&out.Tax, &out.Ops} {
		cs.Total = cs.OnTime + cs.Late + cs.Missing + cs.Pending + cs.Exempt
		cs.finalize()
	}
	return out
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
