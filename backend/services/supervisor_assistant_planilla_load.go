package services

import (
	"fmt"
	"sort"

	"miappfiber/database"
	"miappfiber/models"
)

// Carga de planillas por asistente (módulo PDT 601). Para que el administrador vea qué asistente tiene más trabajo de
// planillas hay que saber cuántos TRABAJADORES atiende cada uno: el número de empresas no basta (una empresa con 80
// trabajadores pesa mucho más que una con 2). El dato sale de la planilla del periodo (trabajadores ONP + AFP). Si la
// planilla de este periodo aún no se registró, se usa la última que tenga trabajadores (la cantidad casi no cambia de un
// mes a otro), y la empresa se marca como estimada.

// AssistantPlanillaRow la carga de planillas de un asistente en el periodo.
type AssistantPlanillaRow struct {
	// AssistantID 0 = empresas sin asistente asignado.
	AssistantID uint   `json:"assistant_id"`
	Name        string `json:"name"`
	// Companies empresas a las que les corresponde planilla este mes (sin suspendidas ni «sin planilla»).
	Companies int `json:"companies"`
	Workers   int `json:"workers"`
	// WorkersONP / WorkersAFP el mismo total separado por sistema de pensiones.
	WorkersONP int `json:"workers_onp"`
	WorkersAFP int `json:"workers_afp"`
	// Estimated empresas cuyo número de trabajadores viene de un mes anterior (la planilla de este mes aún no se registró);
	// NoData empresas sin ningún dato de trabajadores todavía (no suman).
	Estimated int `json:"estimated"`
	NoData    int `json:"no_data"`
	// Tareas de PDT 601 de este asistente en el periodo.
	Total     int64 `json:"total"`
	Completed int64 `json:"completed"`
	Open      int64 `json:"open"`
}

// AssistantPlanillaLoad la carga de planillas de todo el alcance, con el desglose por asistente (la mayor carga primero).
type AssistantPlanillaLoad struct {
	Workers     int                    `json:"workers"`
	WorkersONP  int                    `json:"workers_onp"`
	WorkersAFP  int                    `json:"workers_afp"`
	Companies   int                    `json:"companies"`
	Estimated   int                    `json:"estimated"`
	NoData      int                    `json:"no_data"`
	ByAssistant []AssistantPlanillaRow `json:"by_assistant"`
}

type planillaWorkers struct{ onp, afp int }

// lastKnownPlanillaWorkers por empresa, la planilla más reciente ANTERIOR al periodo que tenga trabajadores.
func lastKnownPlanillaWorkers(companyIDs []uint, periodYM string) map[uint]planillaWorkers {
	out := map[uint]planillaWorkers{}
	if len(companyIDs) == 0 {
		return out
	}
	type row struct {
		CompanyID       uint
		TrabajadoresONP int
		TrabajadoresAFP int
	}
	var rows []row
	err := database.DB.Table("supervisor_pdt601_planillas AS p").
		Select("c.company_id AS company_id, p.trabajadores_onp AS trabajadores_onp, p.trabajadores_afp AS trabajadores_afp").
		Joins("JOIN supervisor_monthly_controls c ON c.id = p.monthly_control_id AND c.deleted_at IS NULL").
		Where("p.deleted_at IS NULL AND p.sin_planilla = ? AND (p.trabajadores_onp + p.trabajadores_afp) > 0", false).
		Where("c.company_id IN ? AND c.period_ym < ?", companyIDs, periodYM).
		Order("c.company_id ASC, c.period_ym DESC").
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for _, r := range rows { // vienen del periodo más reciente al más antiguo: se queda con el primero de cada empresa
		if _, seen := out[r.CompanyID]; !seen {
			out[r.CompanyID] = planillaWorkers{onp: r.TrabajadoresONP, afp: r.TrabajadoresAFP}
		}
	}
	return out
}

// planillaLoadAcc junta, fila por fila del módulo PDT 601, lo que hace falta para la carga por asistente.
type planillaLoadAcc struct {
	assistantOf map[uint]uint // empresa → asistente (0 = sin asistente)
	rows        map[uint]*AssistantPlanillaRow
	current     map[uint]planillaWorkers // empresa → trabajadores de la planilla de ESTE periodo (si ya hay)
	pending     []uint                   // empresas que aplican pero sin trabajadores este periodo
}

func newPlanillaLoadAcc(companies []models.Company) *planillaLoadAcc {
	a := &planillaLoadAcc{assistantOf: map[uint]uint{}, rows: map[uint]*AssistantPlanillaRow{}, current: map[uint]planillaWorkers{}}
	for _, c := range companies {
		var id uint
		if c.AssistantUserID != nil {
			id = *c.AssistantUserID
		}
		a.assistantOf[c.ID] = id
	}
	return a
}

func (a *planillaLoadAcc) row(companyID uint) *AssistantPlanillaRow {
	id := a.assistantOf[companyID]
	r, ok := a.rows[id]
	if !ok {
		r = &AssistantPlanillaRow{AssistantID: id}
		a.rows[id] = r
	}
	return r
}

// addTask cuenta una tarea de PDT 601 (ya medida) en el asistente de la empresa.
func (a *planillaLoadAcc) addTask(companyID uint, completed bool) {
	r := a.row(companyID)
	r.Total++
	if completed {
		r.Completed++
	} else {
		r.Open++
	}
}

// addCompany cuenta una empresa a la que le corresponde planilla este mes y sus trabajadores, si la planilla ya los trae.
func (a *planillaLoadAcc) addCompany(companyID uint, onp, afp int) {
	r := a.row(companyID)
	r.Companies++
	if onp+afp > 0 {
		r.WorkersONP += onp
		r.WorkersAFP += afp
		a.current[companyID] = planillaWorkers{onp: onp, afp: afp}
		return
	}
	a.pending = append(a.pending, companyID)
}

// finish completa con los datos de meses anteriores lo que este periodo aún no trae y arma el resultado.
func (a *planillaLoadAcc) finish(s *SupervisorService, periodYM string) *AssistantPlanillaLoad {
	known := lastKnownPlanillaWorkers(a.pending, periodYM)
	for _, id := range a.pending {
		r := a.row(id)
		if w, ok := known[id]; ok {
			r.WorkersONP += w.onp
			r.WorkersAFP += w.afp
			r.Estimated++
		} else {
			r.NoData++
		}
	}
	ids := make([]uint, 0, len(a.rows))
	for id := range a.rows {
		if id != 0 {
			ids = append(ids, id)
		}
	}
	names := s.userNames(ids)

	out := &AssistantPlanillaLoad{ByAssistant: make([]AssistantPlanillaRow, 0, len(a.rows))}
	for id, r := range a.rows {
		r.Workers = r.WorkersONP + r.WorkersAFP
		switch {
		case id == 0:
			r.Name = "Sin asistente asignado"
		case names[id] != "":
			r.Name = names[id]
		default:
			r.Name = fmt.Sprintf("Usuario %d", id)
		}
		out.Workers += r.Workers
		out.WorkersONP += r.WorkersONP
		out.WorkersAFP += r.WorkersAFP
		out.Companies += r.Companies
		out.Estimated += r.Estimated
		out.NoData += r.NoData
		out.ByAssistant = append(out.ByAssistant, *r)
	}
	// La mayor carga primero; a igual número de trabajadores, la de más empresas y luego por nombre (orden estable).
	sort.Slice(out.ByAssistant, func(i, j int) bool {
		a, b := out.ByAssistant[i], out.ByAssistant[j]
		if a.Workers != b.Workers {
			return a.Workers > b.Workers
		}
		if a.Companies != b.Companies {
			return a.Companies > b.Companies
		}
		return a.Name < b.Name
	})
	return out
}
