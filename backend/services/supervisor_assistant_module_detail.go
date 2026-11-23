package services

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"miappfiber/models"
)

// Detalle de un módulo del panel del asistente: UNA FILA POR EMPRESA con su estado en el periodo (dentro de plazo, fuera de
// plazo o pendiente), no solo las abiertas. Lo usa el modal del módulo para que, al pulsar un número del consolidado
// por dígito (por ejemplo «fuera de plazo» del dígito 3), se vea a qué empresas se refiere. Se pide al abrir el modal, no va en
// el panel principal (son cientos de filas por módulo).

// Categorías de una fila (coinciden con las columnas del consolidado por dígito). Una tarea no entregada es SIEMPRE «pendiente», esté o
// no pasado su plazo: solo cuando se entrega pasa a «dentro» o «fuera» de plazo (no existe una categoría «vencida»).
const (
	AssistantBucketDentro    = "dentro"    // entregada a tiempo
	AssistantBucketFuera     = "fuera"     // entregada fuera de plazo
	AssistantBucketPendiente = "pendiente" // sin entregar (pendiente, en revisión del supervisor u observada), venza cuando venza
)

// AssistantModuleRow una empresa en un módulo del periodo.
type AssistantModuleRow struct {
	CompanyID uint   `json:"company_id"`
	Company   string `json:"company"`
	RUC       string `json:"ruc"`
	// Digit último dígito del RUC (-1 si no hay).
	Digit       int    `json:"digit"`
	AssistantID uint   `json:"assistant_id,omitempty"`
	Assistant   string `json:"assistant,omitempty"`
	// State el estado de la tarea (completada | pendiente | vencida | por_revisar | observada) y Bucket su categoría (dentro | fuera | pendiente).
	State  string `json:"state"`
	Bucket string `json:"bucket"`
	// DeclarationID la entrega a la que se abre desde la fila.
	DeclarationID uint   `json:"declaration_id,omitempty"`
	DueDate       string `json:"due_date,omitempty"`
	DaysLeft      *int   `json:"days_left,omitempty"`
	// DeliveredAt cuándo se entregó o declaró (AAAA-MM-DD), si se sabe.
	DeliveredAt string `json:"delivered_at,omitempty"`
	// Observacion la nota que escribió el supervisor en el registro (PDT 621 · Declaración): por ejemplo el motivo de declarar fuera de plazo.
	Observacion string `json:"observacion,omitempty"`
	Hint        string `json:"hint,omitempty"`
	// Counts solo en módulos de VARIAS tareas por empresa (Buzón SOL: una captura por semana de SUNAT y de SUNAFIL): cuántas tareas de la
	// empresa hay en cada categoría. La fila entra en cada categoría en la que tenga alguna.
	Counts *AssistantBucketCounts `json:"counts,omitempty"`
}

// AssistantBucketCounts tareas de una empresa por categoría.
type AssistantBucketCounts struct {
	Dentro    int64 `json:"dentro"`
	Fuera     int64 `json:"fuera"`
	Pendiente int64 `json:"pendiente"`
}

var assistantBucketRank = map[string]int{AssistantBucketPendiente: 0, AssistantBucketFuera: 1, AssistantBucketDentro: 2}

// AssistantModuleDetail las filas de un módulo en el periodo.
type AssistantModuleDetail struct {
	ModuleKey string               `json:"module_key"`
	PeriodYM  string               `json:"period_ym"`
	Rows      []AssistantModuleRow `json:"rows"`
}

// rucDigit último dígito del RUC (-1 si no hay uno válido).
func rucDigit(ruc string) int {
	ruc = strings.TrimSpace(ruc)
	if ruc == "" {
		return -1
	}
	d := int(ruc[len(ruc)-1]) - '0'
	if d < 0 || d > 9 {
		return -1
	}
	return d
}

// assistantBucket la categoría de una tarea: entregada a tiempo, entregada fuera de plazo o pendiente (lo no entregado).
func assistantBucket(state string, onTime bool) string {
	if state == assistantTaskDone {
		if onTime {
			return AssistantBucketDentro
		}
		return AssistantBucketFuera
	}
	return AssistantBucketPendiente
}

// AssistantModuleDetail arma las filas de un módulo con el alcance de p (mismas reglas que el panel).
func (s *SupervisorService) AssistantModuleDetail(p SupervisorDashboardParams) (*AssistantModuleDetail, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	valid := false
	for _, o := range assistantModuleOptions(p.IncludeSupervisorTasks) {
		valid = valid || o.Key == p.ModuleKey
	}
	if !valid {
		return nil, errors.New("módulo no válido")
	}
	out := &AssistantModuleDetail{ModuleKey: p.ModuleKey, PeriodYM: p.PeriodYM, Rows: []AssistantModuleRow{}}
	companies, err := s.dashboardScopeCompanies(p)
	if err != nil {
		return nil, err
	}
	if len(companies) == 0 {
		return out, nil
	}
	build, err := s.assistantBuildRows(p.PeriodYM, companies, p.IncludeSupervisorTasks, p.ModuleKey, false, true)
	if err != nil {
		return nil, err
	}
	ids := make([]uint, 0)
	seen := map[uint]bool{}
	for _, r := range build.Rows {
		if r.AssistantID != 0 && !seen[r.AssistantID] {
			seen[r.AssistantID] = true
			ids = append(ids, r.AssistantID)
		}
	}
	names := s.userNames(ids)
	rows := build.Rows
	for i := range rows {
		if rows[i].AssistantID != 0 {
			rows[i].Assistant = strings.TrimSpace(names[rows[i].AssistantID])
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if assistantBucketRank[a.Bucket] != assistantBucketRank[b.Bucket] {
			return assistantBucketRank[a.Bucket] < assistantBucketRank[b.Bucket]
		}
		if a.DueDate != b.DueDate {
			return a.DueDate < b.DueDate
		}
		return strings.ToLower(a.Company) < strings.ToLower(b.Company)
	})
	out.Rows = rows
	return out, nil
}

// ---------- Comprobantes de ventas y compras por asistente (PDT 621 · Declaración) ----------

// AssistantComprobantesRow los comprobantes que registró cada asistente en el PDT 621 del periodo.
type AssistantComprobantesRow struct {
	// AssistantID 0 = empresas sin asistente asignado.
	AssistantID uint   `json:"assistant_id"`
	Name        string `json:"name"`
	Companies   int    `json:"companies"`
	Ventas      int    `json:"ventas"`
	Compras     int    `json:"compras"`
	// NoData empresas del asistente sin comprobantes registrados todavía (no suman).
	NoData int `json:"no_data"`
	// Open declaraciones de este asistente que aún faltan.
	Open int64 `json:"open"`
}

// AssistantComprobantesLoad la cantidad de comprobantes de ventas y compras de todo el alcance, por asistente.
type AssistantComprobantesLoad struct {
	Ventas      int                        `json:"ventas"`
	Compras     int                        `json:"compras"`
	Companies   int                        `json:"companies"`
	NoData      int                        `json:"no_data"`
	ByAssistant []AssistantComprobantesRow `json:"by_assistant"`
}

type comprobantesAcc struct {
	assistantOf map[uint]uint
	rows        map[uint]*AssistantComprobantesRow
}

func newComprobantesAcc(companies []models.Company) *comprobantesAcc {
	a := &comprobantesAcc{assistantOf: make(map[uint]uint, len(companies)), rows: map[uint]*AssistantComprobantesRow{}}
	for _, c := range companies {
		var id uint
		if c.AssistantUserID != nil {
			id = *c.AssistantUserID
		}
		a.assistantOf[c.ID] = id
	}
	return a
}

// add cuenta una empresa a la que le corresponde declaración este mes, con sus comprobantes (0 y 0 = aún sin registrar).
func (a *comprobantesAcc) add(companyID uint, ventas, compras int, open bool) {
	id := a.assistantOf[companyID]
	r, ok := a.rows[id]
	if !ok {
		r = &AssistantComprobantesRow{AssistantID: id}
		a.rows[id] = r
	}
	r.Companies++
	if ventas+compras > 0 {
		r.Ventas += ventas
		r.Compras += compras
	} else {
		r.NoData++
	}
	if open {
		r.Open++
	}
}

func (a *comprobantesAcc) finish(s *SupervisorService) *AssistantComprobantesLoad {
	ids := make([]uint, 0, len(a.rows))
	for id := range a.rows {
		if id != 0 {
			ids = append(ids, id)
		}
	}
	names := s.userNames(ids)
	out := &AssistantComprobantesLoad{ByAssistant: make([]AssistantComprobantesRow, 0, len(a.rows))}
	for id, r := range a.rows {
		switch {
		case id == 0:
			r.Name = "Sin asistente asignado"
		case strings.TrimSpace(names[id]) != "":
			r.Name = strings.TrimSpace(names[id])
		default:
			r.Name = fmt.Sprintf("Usuario %d", id)
		}
		out.Ventas += r.Ventas
		out.Compras += r.Compras
		out.Companies += r.Companies
		out.NoData += r.NoData
		out.ByAssistant = append(out.ByAssistant, *r)
	}
	// El que más comprobantes atiende primero; a igual cantidad, el de más empresas y luego por nombre (orden estable).
	sort.Slice(out.ByAssistant, func(i, j int) bool {
		x, y := out.ByAssistant[i], out.ByAssistant[j]
		if x.Ventas+x.Compras != y.Ventas+y.Compras {
			return x.Ventas+x.Compras > y.Ventas+y.Compras
		}
		if x.Companies != y.Companies {
			return x.Companies > y.Companies
		}
		return x.Name < y.Name
	})
	return out
}
