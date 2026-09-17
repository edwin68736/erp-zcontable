package services

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// Pdt601ListParams filtros del listado PDT 601 por empresa y período.
type Pdt601ListParams struct {
	PeriodYM          string
	Status            string
	Q                 string
	Dig               string
	AssistantUserID   uint
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

// Pdt601ListRow fila del listado (empresa + período + módulo pdt_601).
type Pdt601ListRow struct {
	CompanyID         uint               `json:"company_id"`
	Code              string             `json:"code"`
	Dig               string             `json:"dig"`
	BusinessName      string             `json:"business_name"`
	RUC               string             `json:"ruc"`
	AssistantUsername string             `json:"assistant_username"`
	ControlID         *uint              `json:"control_id,omitempty"`
	DeclarationID     *uint              `json:"declaration_id,omitempty"`
	Status            string             `json:"status"`
	DueDate           *string            `json:"due_date,omitempty"`
	IsOverdue         bool               `json:"is_overdue"`
	DaysRemaining     *int               `json:"days_remaining"`
	AttachmentCount   int64              `json:"attachment_count"`
	LastStoredAt      *time.Time         `json:"last_stored_at,omitempty"`
	Planilla          *Pdt601PlanillaDTO `json:"planilla,omitempty"`
	// Timeliness cumplimiento de la fecha de entrega vs. la regla configurada en
	// /settings/activity-configuration para la actividad "PDT 601" del calendario
	// financiero del período (on_time | late | pending | missing | exempt | no_rule).
	Timeliness string `json:"timeliness"`
}

// Pdt601Detail detalle tras EnsurePdt601 (lazy create o reutiliza bootstrap).
type Pdt601Detail struct {
	PeriodYM          string                       `json:"period_ym"`
	CompanyID         uint                         `json:"company_id"`
	Code              string                       `json:"code"`
	Dig               string                       `json:"dig"`
	BusinessName      string                       `json:"business_name"`
	RUC               string                       `json:"ruc"`
	AssistantUsername string                       `json:"assistant_username"`
	ControlID         uint                         `json:"control_id"`
	ControlDueDate    *time.Time                   `json:"control_due_date,omitempty"`
	Declaration       models.SupervisorDeclaration `json:"declaration"`
	Planilla          *Pdt601PlanillaDTO           `json:"planilla,omitempty"`
	// Timeliness mismo criterio que Pdt601ListRow.Timeliness — presente acá también para que el
	// detalle pueda mostrar "Entregado" vs "Entregado fuera de fecha" sin recalcular nada en el
	// frontend (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §5/§12).
	Timeliness string `json:"timeliness"`
}

// pdt601StatusFilterSinPlanilla filtro sintético del listado: empresas marcadas sin planilla.
const pdt601StatusFilterSinPlanilla = "sin_planilla"

// pdt601StatusFilterSuspendida filtro sintético del listado: empresas marcadas suspendidas.
const pdt601StatusFilterSuspendida = "suspendida"

// Filtros sintéticos de puntualidad (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §11) — no son
// valores de Status guardados, se resuelven en la consulta comparando fecha_entrega contra la fecha
// límite única del período (pdt601PeriodDueDate). "entregado" solo, sin distinguir puntualidad, ya
// cubre el caso "quiero ver los entregados" sin filtrar por fecha.
const (
	pdt601StatusFilterEntregado             = "entregado"
	pdt601StatusFilterEntregadoATiempo      = "entregado_a_tiempo"
	pdt601StatusFilterEntregadoFueraDeFecha = "entregado_fuera_de_fecha"
)

// supervisorSuspendidaNote nota fija que se fuerza en el campo de observación (PDT 601 y PDT 621)
// cuando la empresa está marcada "suspendida" — así queda visible en el listado y en el reporte
// Excel sin depender de que alguien la escriba a mano. Compartida por ambos módulos (mismo
// package), definida acá una sola vez.
const supervisorSuspendidaNote = "Empresa suspendida"

// isPdt601Pdt621DeclarationType true para el enum reducido de estados
// (docs/diseno-estados-pdt601-pdt621-2026-09-16.md) — compartido por ambos módulos, definido acá una
// sola vez (mismo criterio que supervisorSuspendidaNote arriba).
func isPdt601Pdt621DeclarationType(t string) bool {
	return t == models.SupervisorDeclPDT601 || t == models.SupervisorDeclPDT621
}

// validatePdt601Pdt621StatusTransition bloquea cambios de estado vía el PUT genérico de declaraciones
// para pdt_601/pdt_621 — mismo patrón que validateDetraccionesStatusTransition
// (supervisor_detracciones_states.go): el estado de estos dos tipos ya no es un campo libre, cada
// cambio pasa por una acción dedicada (Entregar vía SavePdt601Planilla/SavePdt621Record, Aprobar,
// Observar, Reabrir), cada una con su propia validación y efectos secundarios.
func validatePdt601Pdt621StatusTransition(from, to string) error {
	if from == to {
		return nil
	}
	return errors.New("use las acciones dedicadas (Entregar, Aprobar, Observar, Reabrir) para cambiar el estado de PDT 601/621")
}

// Pdt601PlanillaDTO datos de planilla PDT 601 del período (salida a UI).
type Pdt601PlanillaDTO struct {
	SinPlanilla                 bool    `json:"sin_planilla"`
	Suspendida                  bool    `json:"suspendida"`
	RegimenLaboral              string  `json:"regimen_laboral"`
	TrabajadoresONP             int     `json:"trabajadores_onp"`
	TrabajadoresAFP             int     `json:"trabajadores_afp"`
	TrabajadoresTotal           int     `json:"trabajadores_total"`
	Essalud                     float64 `json:"essalud"`
	Onp                         float64 `json:"onp"`
	Afp                         float64 `json:"afp"`
	Sis                         float64 `json:"sis"`
	Rta4ta                      float64 `json:"rta_4ta"`
	Rta5ta                      float64 `json:"rta_5ta"`
	Sctr                        float64 `json:"sctr"`
	Rh                          float64 `json:"rh"`
	TotalAportes                float64 `json:"total_aportes"`
	FechaEntrega                *string `json:"fecha_entrega,omitempty"`
	HoraEntrega                 string  `json:"hora_entrega"`
	Observaciones               string  `json:"observaciones"`
	FechaDeclaracionPdt         *string `json:"fecha_declaracion_pdt,omitempty"`
	NPS                         string  `json:"nps"`
	TicketAFP                   string  `json:"ticket_afp"`
	EstadoEnvioBoletas          string  `json:"estado_envio_boletas"`
	FechaEnvioNpsTicketsBoletas *string `json:"fecha_envio_nps_tickets_boletas,omitempty"`
}

// Pdt601PlanillaInput datos de planilla enviados por el supervisor (fechas como AAAA-MM-DD).
type Pdt601PlanillaInput struct {
	SinPlanilla                 bool    `json:"sin_planilla"`
	Suspendida                  bool    `json:"suspendida"`
	RegimenLaboral              string  `json:"regimen_laboral"`
	TrabajadoresONP             int     `json:"trabajadores_onp"`
	TrabajadoresAFP             int     `json:"trabajadores_afp"`
	Essalud                     float64 `json:"essalud"`
	Onp                         float64 `json:"onp"`
	Afp                         float64 `json:"afp"`
	Sis                         float64 `json:"sis"`
	Rta4ta                      float64 `json:"rta_4ta"`
	Rta5ta                      float64 `json:"rta_5ta"`
	Sctr                        float64 `json:"sctr"`
	Rh                          float64 `json:"rh"`
	FechaEntrega                string  `json:"fecha_entrega"`
	HoraEntrega                 string  `json:"hora_entrega"`
	Observaciones               string  `json:"observaciones"`
	FechaDeclaracionPdt         string  `json:"fecha_declaracion_pdt"`
	NPS                         string  `json:"nps"`
	TicketAFP                   string  `json:"ticket_afp"`
	EstadoEnvioBoletas          string  `json:"estado_envio_boletas"`
	FechaEnvioNpsTicketsBoletas string  `json:"fecha_envio_nps_tickets_boletas"`
}

// pdt601ParseDate interpreta AAAA-MM-DD en hora local; vacío → nil.
func pdt601ParseDate(s string) *time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	t, err := time.ParseInLocation("2006-01-02", s, time.Local)
	if err != nil {
		return nil
	}
	return &t
}

func pdt601DateString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

// pdt601DigitFromString parsea un dígito de RUC ("0".."9", mismo formato que
// CompanyAccessCredential.Dig) a *int — nil si viene vacío o inválido (sin distinguir por dígito).
func pdt601DigitFromString(dig string) *int {
	dig = strings.TrimSpace(dig)
	if dig == "" {
		return nil
	}
	n, err := strconv.Atoi(dig)
	if err != nil || n < 0 || n > 9 {
		return nil
	}
	return &n
}

// findPdt601CalendarActivity busca la instancia "PDT 601" del calendario financiero para el período
// (tipo pdt_601) que le corresponde al dígito de RUC de la empresa — puede haber varias agrupadas por
// rango de dígitos (docs/diseno-limpieza-control-detail-2026-09-16.md §2.2/§2.7b), cada una con su
// propia fecha límite. `dig=""` no distingue (usa la primera/comodín, mismo comportamiento que antes
// de §2.7b). Nil si aún no está en el calendario.
func findPdt601CalendarActivity(periodYM, dig string) *models.FinanceCalendarActivity {
	act, err := FindCalendarActivityByTypeAndDigit(periodYM, models.CalendarActivityPDT601, pdt601DigitFromString(dig))
	if err != nil {
		return nil
	}
	return act
}

// pdt601PeriodDueDate fecha límite para PDT 601 según el calendario interno de actividades
// (/settings/activity-configuration), **para el dígito de RUC de una empresa específica** — desde
// §2.7b ya no es una fecha única para todo el período, el estudio agrupa las plantillas por rango de
// RUC (2 grupos hoy) igual que ya hacía el cronograma SUNAT de PDT 621. Nil si el período no tiene
// actividad configurada para ese dígito, o no tiene regla activa asignada — en ese caso no hay nada
// contra qué comparar, y tanto el filtro como el label tratan la entrega como "a tiempo" (no se
// castiga por falta de configuración).
func pdt601PeriodDueDate(periodYM, dig string) *time.Time {
	act := findPdt601CalendarActivity(periodYM, dig)
	if act == nil {
		return nil
	}
	dueDate, err := dueDateForActivity(periodYM, act.DueDay)
	if err != nil {
		return nil
	}
	rule, err := LoadActiveActivityRule(act.ActivityRuleID)
	if err != nil || rule == nil {
		return &dueDate
	}
	deadline := BuildUploadDeadline(dueDate, rule)
	return &deadline
}

// pdt601DueDateCandidate una actividad "pdt_601" del período ya resuelta a fecha límite absoluta
// (día + regla), con su rango de dígitos — usada para construir el CASE SQL de §2.7b sin repetir la
// consulta a `finance_calendar_activities` por cada empresa.
type pdt601DueDateCandidate struct {
	Start, End *int
	Due        time.Time
}

// pdt601DueDateCandidates trae y resuelve TODAS las actividades "pdt_601" del período — una sola
// consulta, reutilizada tanto por el filtro SQL del listado como por el desglose del dashboard.
func pdt601DueDateCandidates(periodYM string) []pdt601DueDateCandidate {
	var acts []models.FinanceCalendarActivity
	_ = database.DB.Table("finance_calendar_activities AS a").
		Select("a.*").
		Joins("INNER JOIN finance_calendars c ON c.id = a.calendar_id AND c.deleted_at IS NULL").
		Where("c.period_ym = ? AND a.activity_type_snapshot = ? AND a.deleted_at IS NULL", periodYM, models.CalendarActivityPDT601).
		Order("a.due_day ASC, a.id ASC").
		Find(&acts).Error
	out := make([]pdt601DueDateCandidate, 0, len(acts))
	for _, act := range acts {
		dueDate, err := dueDateForActivity(periodYM, act.DueDay)
		if err != nil {
			continue
		}
		deadline := dueDate
		if rule, err := LoadActiveActivityRule(act.ActivityRuleID); err == nil && rule != nil {
			deadline = BuildUploadDeadline(dueDate, rule)
		}
		out = append(out, pdt601DueDateCandidate{Start: act.RucDigitStartSnapshot, End: act.RucDigitEndSnapshot, Due: deadline})
	}
	return out
}

// pickDueDateCandidateByDigit elige, entre varios candidatos ya resueltos (pdt601DueDateCandidates/
// pdt621DueDateCandidates), el que le corresponde a `rucDigit` — mismo criterio que
// `PickCalendarActivityByDigit` (calendar_activity_timeliness.go) pero sobre fechas ya resueltas en
// vez de actividades crudas (usado por `companyCompliance`, §2.9, que ya tiene un `due` por defecto
// que solo se reemplaza si hay un candidato mejor para el dígito de la empresa).
func pickDueDateCandidateByDigit(candidates []pdt601DueDateCandidate, rucDigit *int) *pdt601DueDateCandidate {
	if len(candidates) == 0 {
		return nil
	}
	var wildcard *pdt601DueDateCandidate
	for i := range candidates {
		cand := &candidates[i]
		if cand.Start == nil || cand.End == nil {
			if wildcard == nil {
				wildcard = cand
			}
			continue
		}
		if rucDigit != nil && *rucDigit >= *cand.Start && *rucDigit <= *cand.End {
			return cand
		}
	}
	if wildcard != nil {
		return wildcard
	}
	if rucDigit == nil {
		return &candidates[0]
	}
	return nil
}

// pdt601DueDateSQLCase arma una expresión SQL `CASE` que resuelve la fecha límite que le corresponde
// a una empresa según su dígito de RUC (subconsulta correlacionada a `company_access_credentials`,
// contra `companyIDExpr` — la columna/expresión SQL que da el ID de empresa en el contexto de la
// consulta que la usa: `companies.id` en el listado, `c.company_id` en el dashboard) contra los
// grupos configurados en el calendario del período — o `NULL` si el dígito de la empresa no cae en
// ningún grupo y no hay comodín. `ok=false` si no hay ninguna actividad pdt_601 configurada (el
// caller debe tratarlo igual que antes: "a tiempo" sin castigar por falta de configuración). Los
// valores en el CASE son literales de constantes internas (nunca input del usuario), igual criterio
// que `pdtBucketsSelectSQL` en supervisor_service.go.
func pdt601DueDateSQLCase(periodYM, companyIDExpr string) (sqlExpr string, ok bool) {
	candidates := pdt601DueDateCandidates(periodYM)
	if len(candidates) == 0 {
		return "", false
	}
	sq := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	digExpr := fmt.Sprintf("(SELECT cac.dig FROM company_access_credentials cac WHERE cac.company_id = %s LIMIT 1)", companyIDExpr)
	var whens []string
	wildcard := "NULL"
	for _, c := range candidates {
		lit := sq(c.Due.Format("2006-01-02 15:04:05"))
		if c.Start == nil || c.End == nil {
			wildcard = lit
			continue
		}
		whens = append(whens, fmt.Sprintf(
			"WHEN CAST(%s AS UNSIGNED) BETWEEN %d AND %d THEN %s",
			digExpr, *c.Start, *c.End, lit,
		))
	}
	if len(whens) == 0 {
		// Solo hay comodín (sin ninguna plantilla agrupada por RUC) — no hace falta CASE, un `CASE
		// ELSE x END` sin ningún WHEN es sintácticamente inválido.
		return wildcard, true
	}
	return "(CASE " + strings.Join(whens, " ") + " ELSE " + wildcard + " END)", true
}

func maxInt0(n int) int {
	if n < 0 {
		return 0
	}
	return n
}

// pdt601PlanillaToDTO arma el DTO de salida (deriva total de trabajadores y total de aportes).
func pdt601PlanillaToDTO(p *models.SupervisorPdt601Planilla) *Pdt601PlanillaDTO {
	if p == nil {
		return nil
	}
	return &Pdt601PlanillaDTO{
		SinPlanilla:       p.SinPlanilla,
		Suspendida:        p.Suspendida,
		RegimenLaboral:    p.RegimenLaboral,
		TrabajadoresONP:   p.TrabajadoresONP,
		TrabajadoresAFP:   p.TrabajadoresAFP,
		TrabajadoresTotal: p.TrabajadoresONP + p.TrabajadoresAFP,
		Essalud:           p.Essalud,
		Onp:               p.Onp,
		Afp:               p.Afp,
		Sis:               p.Sis,
		Rta4ta:            p.Rta4ta,
		Rta5ta:            p.Rta5ta,
		Sctr:              p.Sctr,
		Rh:                p.Rh,
		// RH queda fuera de TotalAportes a pedido — no se suma junto con Essalud/Onp/Afp/Sis/Rta4ta/Rta5ta/Sctr.
		TotalAportes:                p.Essalud + p.Onp + p.Afp + p.Sis + p.Rta4ta + p.Rta5ta + p.Sctr,
		FechaEntrega:                pdt601DateString(p.FechaEntrega),
		HoraEntrega:                 p.HoraEntrega,
		Observaciones:               p.Observaciones,
		FechaDeclaracionPdt:         pdt601DateString(p.FechaDeclaracionPdt),
		NPS:                         p.NPS,
		TicketAFP:                   p.TicketAFP,
		EstadoEnvioBoletas:          p.EstadoEnvioBoletas,
		FechaEnvioNpsTicketsBoletas: pdt601DateString(p.FechaEnvioNpsTicketsBoletas),
	}
}

type pdt601ListResult struct {
	Rows       []Pdt601ListRow
	Total      int64
	Page       int
	PerPage    int
	TotalPages int
}

func pdt601ResolveDueDate(declDue, controlDue *time.Time) *time.Time {
	if declDue != nil {
		return declDue
	}
	return controlDue
}

func pdt601DueMeta(status string, due *time.Time) (isOverdue bool, daysRemaining *int) {
	if due == nil {
		return false, nil
	}
	switch status {
	case models.SupervisorDeclEntregado, models.SupervisorDeclObservado,
		models.SupervisorDeclAprobado, models.SupervisorDeclPresentado, models.SupervisorDeclCerrado:
		return false, nil
	}
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	d := time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, time.Local)
	diff := int(d.Sub(today).Hours() / 24)
	daysRemaining = &diff
	if diff < 0 {
		return true, daysRemaining
	}
	return false, daysRemaining
}

func pdt601DueDateString(due *time.Time) *string {
	if due == nil {
		return nil
	}
	s := due.Format("2006-01-02")
	return &s
}

// GetPdt601PlanillaOnly lee la planilla PDT 601 del período sin crear control/declaración
// (a diferencia de EnsurePdt601). Pensado para "jalar" datos desde otras pantallas (p. ej.
// liquidaciones) sin el efecto secundario de crear un registro de seguimiento PDT 601.
// Devuelve nil si no existe control o planilla para ese período.
func (s *SupervisorService) GetPdt601PlanillaOnly(companyID uint, periodYM string) (*Pdt601PlanillaDTO, error) {
	periodYM = strings.TrimSpace(periodYM)
	if !validPeriodYM(periodYM) {
		return nil, errors.New("período inválido (YYYY-MM)")
	}
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	var pl models.SupervisorPdt601Planilla
	if err := database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&pl).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return pdt601PlanillaToDTO(&pl), nil
}

// EnsurePdt601 crea control y declaración pdt_601 al abrir detalle; reutiliza registro de bootstrap si existe.
func (s *SupervisorService) EnsurePdt601(companyID uint, periodYM string) (*Pdt601Detail, error) {
	if err := s.validateOpenPeriod(periodYM); err != nil {
		return nil, err
	}
	var company models.Company
	if err := database.DB.Preload("Assistant").First(&company, companyID).Error; err != nil {
		return nil, errors.New("empresa no encontrada")
	}
	if company.ClientType != models.CompanyClientTypeEstudio || company.Status != "activo" {
		return nil, errors.New("empresa no disponible")
	}

	var ctrl models.SupervisorMonthlyControl
	var decl models.SupervisorDeclaration
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			due := periodDefaultDueDate(periodYM)
			ctrl = models.SupervisorMonthlyControl{
				CompanyID:         companyID,
				PeriodYM:          periodYM,
				ResponsibleUserID: company.AccountantUserID,
				SupervisorUserID:  company.SupervisorUserID,
				DueDate:           &due,
				GeneralStatus:     models.SupervisorControlPendiente,
				RiskLevel:         models.SupervisorRiskBajo,
			}
			if err := tx.Create(&ctrl).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("monthly_control_id = ? AND declaration_type = ?", ctrl.ID, models.SupervisorDeclPDT601).
			First(&decl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			decl = models.SupervisorDeclaration{
				MonthlyControlID: ctrl.ID,
				DeclarationType:  models.SupervisorDeclPDT601,
				Status:           models.SupervisorDeclPendiente,
				Priority:         models.SupervisorPriorityMedia,
			}
			return tx.Create(&decl).Error
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	var planilla models.SupervisorPdt601Planilla
	var planillaDTO *Pdt601PlanillaDTO
	if err := database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&planilla).Error; err == nil {
		planillaDTO = pdt601PlanillaToDTO(&planilla)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// Mismo cálculo que pdt601BuildRows (lista/export) — ver comentario en Pdt601Detail.Timeliness.
	exempt := planillaDTO != nil && (planillaDTO.SinPlanilla || planillaDTO.Suspendida)
	var deliveredAt *time.Time
	if planillaDTO != nil && planillaDTO.FechaEntrega != nil {
		deliveredAt = pdt601ParseDate(*planillaDTO.FechaEntrega)
	}
	dig := s.companyDig(company.ID)
	timeliness := ComputeCalendarActivityTimeliness(periodYM, findPdt601CalendarActivity(periodYM, dig), deliveredAt, exempt).Timeliness

	return &Pdt601Detail{
		PeriodYM:          periodYM,
		CompanyID:         company.ID,
		Code:              strings.TrimSpace(company.InternalCode),
		Dig:               dig,
		BusinessName:      strings.TrimSpace(company.BusinessName),
		RUC:               strings.TrimSpace(company.RUC),
		AssistantUsername: assistantUsername(company.Assistant),
		ControlID:         ctrl.ID,
		ControlDueDate:    ctrl.DueDate,
		Declaration:       decl,
		Planilla:          planillaDTO,
		Timeliness:        timeliness,
	}, nil
}

// SavePdt601Planilla crea o actualiza la planilla PDT 601 del período (empresa+periodo).
// Reutiliza EnsurePdt601 para garantizar que exista el control mensual y validar acceso/periodo.
func (s *SupervisorService) SavePdt601Planilla(companyID uint, periodYM string, in Pdt601PlanillaInput) (*Pdt601Detail, error) {
	// RegimenLaboral: obligatorio en la UI (Pdt601DetailPage.tsx exige elegirlo antes de habilitar
	// "Guardar planilla", mismo patrón que NPS/TicketAFP). Acá solo se rechaza un valor inválido —
	// NO se exige no-vacío, para no romper syncPdt601Planilla (SupervisorLiquidacionCreatePage.tsx),
	// que sincroniza importes en segundo plano y puede correr antes de que alguien haya fijado el
	// régimen para esa empresa/período.
	regimen := strings.TrimSpace(in.RegimenLaboral)
	if regimen != "" && regimen != models.Pdt601RegimenGeneral && regimen != models.Pdt601RegimenRemype {
		return nil, errors.New("régimen laboral inválido")
	}

	detail, err := s.EnsurePdt601(companyID, periodYM)
	if err != nil {
		return nil, err
	}
	if detail.Declaration.Status == models.SupervisorDeclEntregado {
		return nil, errors.New("esta declaración ya fue entregada; no se puede editar (use Reabrir si corresponde)")
	}

	var pl models.SupervisorPdt601Planilla
	err = database.DB.Where("monthly_control_id = ?", detail.ControlID).First(&pl).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		pl = models.SupervisorPdt601Planilla{MonthlyControlID: detail.ControlID}
	}

	pl.RegimenLaboral = regimen

	// "Suspendida" es más restrictivo que "sin planilla" y mutuamente excluyente con ella: mientras
	// esté marcada, no se permite registrar NADA más (ver Pdt601DetailPage.tsx, SUSPENDIDA_RESET) —
	// reforzado acá server-side para que quede así incluso si el cliente no lo aplicara. El campo
	// Observaciones se fuerza a la nota fija, para que quede visible en el listado y el Excel.
	pl.Suspendida = in.Suspendida
	if pl.Suspendida {
		pl.SinPlanilla = false
		pl.TrabajadoresONP = 0
		pl.TrabajadoresAFP = 0
		pl.Essalud = 0
		pl.Onp = 0
		pl.Afp = 0
		pl.Sis = 0
		pl.Rta4ta = 0
		pl.Rta5ta = 0
		pl.Sctr = 0
		pl.Rh = 0
		pl.FechaEntrega = nil
		pl.HoraEntrega = ""
		pl.Observaciones = supervisorSuspendidaNote
		pl.FechaDeclaracionPdt = nil
		pl.NPS = ""
		pl.TicketAFP = ""
		pl.EstadoEnvioBoletas = ""
		pl.FechaEnvioNpsTicketsBoletas = nil
	} else {
		pl.SinPlanilla = in.SinPlanilla
		pl.TrabajadoresONP = maxInt0(in.TrabajadoresONP)
		pl.TrabajadoresAFP = maxInt0(in.TrabajadoresAFP)
		pl.Essalud = in.Essalud
		pl.Onp = in.Onp
		pl.Afp = in.Afp
		pl.Sis = in.Sis
		pl.Rta4ta = in.Rta4ta
		pl.Rta5ta = in.Rta5ta
		pl.Sctr = in.Sctr
		pl.Rh = in.Rh
		pl.FechaEntrega = pdt601ParseDate(in.FechaEntrega)
		pl.HoraEntrega = strings.TrimSpace(in.HoraEntrega)
		pl.Observaciones = strings.TrimSpace(in.Observaciones)
		pl.FechaDeclaracionPdt = pdt601ParseDate(in.FechaDeclaracionPdt)
		pl.NPS = strings.TrimSpace(in.NPS)
		pl.TicketAFP = strings.TrimSpace(in.TicketAFP)
		pl.EstadoEnvioBoletas = strings.TrimSpace(in.EstadoEnvioBoletas)
		pl.FechaEnvioNpsTicketsBoletas = pdt601ParseDate(in.FechaEnvioNpsTicketsBoletas)
	}

	declStatus := detail.Declaration.Status
	declID := detail.Declaration.ID
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&pl).Error; err != nil {
			return err
		}
		// Entregar automático (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §9): guardar con
		// fecha de entrega cargada es en sí mismo la acción de "entregar" — no hay selector de
		// estado manual. Solo aplica desde Pendiente/Observado, nunca desde Por revisar (ya está
		// ahí) ni Entregado (bloqueado más arriba, antes de llegar acá).
		if pl.FechaEntrega != nil &&
			(declStatus == models.SupervisorDeclPendiente || declStatus == models.SupervisorDeclObservado) {
			return tx.Model(&models.SupervisorDeclaration{}).
				Where("id = ?", declID).
				Updates(map[string]interface{}{
					"status":       models.SupervisorDeclPorRevisar,
					"progress_pct": declarationProgressFromStatus(models.SupervisorDeclPorRevisar),
				}).Error
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if pl.FechaEntrega != nil &&
		(declStatus == models.SupervisorDeclPendiente || declStatus == models.SupervisorDeclObservado) {
		// Refleja en memoria lo que ya se guardó en la transacción de arriba — SavePdt601Planilla no
		// vuelve a recargar detail desde la base (a diferencia de SavePdt621Record, que sí re-consulta
		// al final vía EnsurePdt621), así que sin esto la respuesta devolvería el estado viejo.
		detail.Declaration.Status = models.SupervisorDeclPorRevisar
		detail.Declaration.ProgressPct = declarationProgressFromStatus(models.SupervisorDeclPorRevisar)
	}
	detail.Planilla = pdt601PlanillaToDTO(&pl)
	// Recalcula con los datos recién guardados — el valor de EnsurePdt601 al principio de esta función
	// quedó desactualizado (se calculó antes de este guardado).
	exempt := pl.SinPlanilla || pl.Suspendida
	detail.Timeliness = ComputeCalendarActivityTimeliness(periodYM, findPdt601CalendarActivity(periodYM, detail.Dig), pl.FechaEntrega, exempt).Timeliness
	return detail, nil
}

// pdt601FilteredCompaniesQuery arma el query de empresas con TODOS los filtros del listado
// (Dig, Q, Status, AssistantUserID) salvo AllowedCompanyIDs vacío-no-nil (ese caso especial —
// "sin empresas permitidas" — lo maneja cada caller antes de llamar acá, con un retorno vacío
// inmediato, para no distinguir "sin filtro" de "cero resultados" dentro del propio builder).
// Compartido por ListPdt601 (pagina en SQL) y ExportPdt601 (trae todo, para el reporte Excel).
func pdt601FilteredCompaniesQuery(p Pdt601ListParams) *gorm.DB {
	q := database.DB.Model(&models.Company{}).
		Where("companies.client_type = ? AND companies.status = ?", models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant")

	if len(p.AllowedCompanyIDs) > 0 {
		q = q.Where("companies.id IN ?", p.AllowedCompanyIDs)
	}

	if p.AssistantUserID > 0 {
		q = q.Where("companies.assistant_user_id = ?", p.AssistantUserID)
	}

	if dig := strings.TrimSpace(p.Dig); dig != "" {
		q = q.Where(`EXISTS (
			SELECT 1 FROM company_access_credentials cac
			WHERE cac.company_id = companies.id AND cac.dig = ?
		)`, dig)
	}

	term := strings.TrimSpace(p.Q)
	if len(term) >= 2 {
		like := "%" + term + "%"
		// El código interno del estudio NO es criterio de búsqueda: puede reasignarse a otra
		// empresa (ver services/company_service.go), así que RUC/razón social son la única
		// fuente de verdad para filtrar.
		q = q.Where(
			"companies.ruc LIKE ? OR companies.business_name LIKE ?",
			like, like,
		)
	}

	statusFilter := strings.TrimSpace(p.Status)
	if statusFilter == models.SupervisorSunatSinRegistro {
		q = q.Where(`NOT EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
		)`, models.SupervisorDeclPDT601, p.PeriodYM)
	} else if statusFilter == pdt601StatusFilterSinPlanilla {
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_pdt601_planillas pl ON pl.monthly_control_id = c.id AND pl.deleted_at IS NULL
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND pl.sin_planilla = ?
		)`, p.PeriodYM, true)
	} else if statusFilter == pdt601StatusFilterSuspendida {
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_pdt601_planillas pl ON pl.monthly_control_id = c.id AND pl.deleted_at IS NULL
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND pl.suspendida = ?
		)`, p.PeriodYM, true)
	} else if statusFilter == pdt601StatusFilterEntregadoATiempo {
		// Sin ninguna actividad pdt_601 configurada, cualquier "entregado" cuenta como a tiempo — no
		// se castiga por falta de configuración (mismo criterio que el label calculado, ver §5/§11 del
		// diseño). Con actividades configuradas, la fecha límite varía por grupo de RUC de la empresa
		// (§2.7b) — dueCase es un CASE SQL, no un valor único, resuelto una vez por período.
		dueCase, hasAny := pdt601DueDateSQLCase(p.PeriodYM, "companies.id")
		if !hasAny {
			q = q.Where(`EXISTS (
				SELECT 1 FROM supervisor_monthly_controls c
				INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
				WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
			)`, models.SupervisorDeclPDT601, models.SupervisorDeclEntregado, p.PeriodYM)
		} else {
			q = q.Where(fmt.Sprintf(`EXISTS (
				SELECT 1 FROM supervisor_monthly_controls c
				INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
				INNER JOIN supervisor_pdt601_planillas pl ON pl.monthly_control_id = c.id AND pl.deleted_at IS NULL
				WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
				AND (pl.fecha_entrega IS NULL OR %s IS NULL OR pl.fecha_entrega <= %s)
			)`, dueCase, dueCase), models.SupervisorDeclPDT601, models.SupervisorDeclEntregado, p.PeriodYM)
		}
	} else if statusFilter == pdt601StatusFilterEntregadoFueraDeFecha {
		dueCase, hasAny := pdt601DueDateSQLCase(p.PeriodYM, "companies.id")
		if !hasAny {
			// Sin ninguna actividad pdt_601 configurada no hay "fuera de fecha" posible.
			q = q.Where("1 = 0")
		} else {
			q = q.Where(fmt.Sprintf(`EXISTS (
				SELECT 1 FROM supervisor_monthly_controls c
				INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
				INNER JOIN supervisor_pdt601_planillas pl ON pl.monthly_control_id = c.id AND pl.deleted_at IS NULL
				WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
				AND pl.fecha_entrega IS NOT NULL AND %s IS NOT NULL AND pl.fecha_entrega > %s
			)`, dueCase, dueCase), models.SupervisorDeclPDT601, models.SupervisorDeclEntregado, p.PeriodYM)
		}
	} else if statusFilter != "" {
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
		)`, models.SupervisorDeclPDT601, statusFilter, p.PeriodYM)
	}

	return q
}

// pdt601BuildRows arma las filas (empresa+control+declaración+planilla+cumplimiento) para un
// conjunto de empresas YA filtrado — sin volver a tocar paginación ni filtros. Compartido por
// ListPdt601 y ExportPdt601 para no duplicar el resto del armado de fila.
func (s *SupervisorService) pdt601BuildRows(companies []models.Company, periodYM string) ([]Pdt601ListRow, error) {
	rows := make([]Pdt601ListRow, 0, len(companies))
	if len(companies) == 0 {
		return rows, nil
	}

	ids := make([]uint, 0, len(companies))
	for _, c := range companies {
		ids = append(ids, c.ID)
	}

	type declRow struct {
		CompanyID      uint
		ControlID      uint
		DeclarationID  uint
		Status         string
		DeclDueDate    *time.Time
		ControlDueDate *time.Time
	}
	var decls []declRow
	_ = database.DB.Table("supervisor_monthly_controls AS c").
		Select("c.company_id, c.id AS control_id, d.id AS declaration_id, d.status, d.due_date AS decl_due_date, c.due_date AS control_due_date").
		Joins("INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.deleted_at IS NULL", models.SupervisorDeclPDT601).
		Where("c.company_id IN ? AND c.period_ym = ? AND c.deleted_at IS NULL", ids, periodYM).
		Scan(&decls).Error

	declByCompany := make(map[uint]declRow, len(decls))
	declIDs := make([]uint, 0, len(decls))
	for _, d := range decls {
		declByCompany[d.CompanyID] = d
		declIDs = append(declIDs, d.DeclarationID)
	}

	type attStat struct {
		DeclarationID uint
		Cnt           int64
		LastAt        *time.Time
	}
	statsByDecl := map[uint]attStat{}
	if len(declIDs) > 0 {
		var stats []attStat
		_ = database.DB.Model(&models.SupervisorAttachment{}).
			Select("declaration_id, COUNT(*) AS cnt, MAX(created_at) AS last_at").
			Where("declaration_id IN ?", declIDs).
			Group("declaration_id").
			Scan(&stats).Error
		for _, st := range stats {
			statsByDecl[st.DeclarationID] = st
		}
	}

	credDig := map[uint]string{}
	var creds []models.CompanyAccessCredential
	_ = database.DB.Where("company_id IN ?", ids).Find(&creds).Error
	for _, cr := range creds {
		credDig[cr.CompanyID] = strings.TrimSpace(cr.Dig)
	}

	// Planilla PDT 601 del período por empresa (LEFT JOIN vía control mensual).
	type planillaRow struct {
		CompanyID uint
		models.SupervisorPdt601Planilla
	}
	planillaByCompany := map[uint]*Pdt601PlanillaDTO{}
	var planillas []planillaRow
	_ = database.DB.Table("supervisor_pdt601_planillas AS p").
		Select("c.company_id, p.*").
		Joins("INNER JOIN supervisor_monthly_controls c ON c.id = p.monthly_control_id AND c.deleted_at IS NULL").
		Where("c.company_id IN ? AND c.period_ym = ? AND p.deleted_at IS NULL", ids, periodYM).
		Scan(&planillas).Error
	for i := range planillas {
		pl := planillas[i].SupervisorPdt601Planilla
		planillaByCompany[planillas[i].CompanyID] = pdt601PlanillaToDTO(&pl)
	}

	// Instancias "PDT 601" del calendario financiero del período (una sola consulta, no por empresa)
	// — puede haber varias agrupadas por rango de RUC (§2.7b); se elige la que corresponde a cada
	// empresa dentro del loop, por su dígito (`credDig`).
	pdt601Acts, _ := CalendarActivitiesForType(periodYM, models.CalendarActivityPDT601)

	for _, co := range companies {
		row := Pdt601ListRow{
			CompanyID:         co.ID,
			Code:              strings.TrimSpace(co.InternalCode),
			Dig:               credDig[co.ID],
			BusinessName:      strings.TrimSpace(co.BusinessName),
			RUC:               strings.TrimSpace(co.RUC),
			AssistantUsername: assistantUsername(co.Assistant),
			Status:            models.SupervisorSunatSinRegistro,
			Planilla:          planillaByCompany[co.ID],
		}
		if d, ok := declByCompany[co.ID]; ok {
			cid, did := d.ControlID, d.DeclarationID
			row.ControlID = &cid
			row.DeclarationID = &did
			row.Status = d.Status
			resolved := pdt601ResolveDueDate(d.DeclDueDate, d.ControlDueDate)
			row.DueDate = pdt601DueDateString(resolved)
			row.IsOverdue, row.DaysRemaining = pdt601DueMeta(d.Status, resolved)
			if st, ok := statsByDecl[d.DeclarationID]; ok {
				row.AttachmentCount = st.Cnt
				row.LastStoredAt = st.LastAt
			}
		}
		exempt := row.Planilla != nil && (row.Planilla.SinPlanilla || row.Planilla.Suspendida)
		if exempt {
			row.IsOverdue = false
			row.DaysRemaining = nil
		}
		var deliveredAt *time.Time
		if row.Planilla != nil && row.Planilla.FechaEntrega != nil {
			deliveredAt = pdt601ParseDate(*row.Planilla.FechaEntrega)
		}
		pdt601Act := PickCalendarActivityByDigit(pdt601Acts, pdt601DigitFromString(credDig[co.ID]))
		row.Timeliness = ComputeCalendarActivityTimeliness(periodYM, pdt601Act, deliveredAt, exempt).Timeliness
		rows = append(rows, row)
	}

	return rows, nil
}

// ListPdt601 listado empresa+período; sin lazy create.
func (s *SupervisorService) ListPdt601(p Pdt601ListParams) (*pdt601ListResult, error) {
	p.PeriodYM = strings.TrimSpace(p.PeriodYM)
	if err := s.validateOpenPeriod(p.PeriodYM); err != nil {
		return nil, err
	}
	page := p.Page
	if page < 1 {
		page = 1
	}
	perPage := p.PerPage
	if perPage < 1 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}

	if p.AllowedCompanyIDs != nil && len(p.AllowedCompanyIDs) == 0 {
		return &pdt601ListResult{
			Rows: []Pdt601ListRow{}, Total: 0, Page: page, PerPage: perPage, TotalPages: 0,
		}, nil
	}

	q := pdt601FilteredCompaniesQuery(p)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var companies []models.Company
	offset := (page - 1) * perPage
	if err := q.Order("companies.internal_code ASC").Offset(offset).Limit(perPage).Find(&companies).Error; err != nil {
		return nil, err
	}

	rows, err := s.pdt601BuildRows(companies, p.PeriodYM)
	if err != nil {
		return nil, err
	}

	return &pdt601ListResult{
		Rows: rows, Total: total, Page: page, PerPage: perPage,
		TotalPages: sunatInboxTotalPages(total, perPage),
	}, nil
}

// ExportPdt601 arma el listado COMPLETO (todas las empresas que matchean los filtros, sin paginar)
// para el reporte Excel — misma lógica de filtrado y armado de fila que ListPdt601, sin el límite
// de página.
func (s *SupervisorService) ExportPdt601(p Pdt601ListParams) ([]Pdt601ListRow, error) {
	p.PeriodYM = strings.TrimSpace(p.PeriodYM)
	if err := s.validateOpenPeriod(p.PeriodYM); err != nil {
		return nil, err
	}
	if p.AllowedCompanyIDs != nil && len(p.AllowedCompanyIDs) == 0 {
		return []Pdt601ListRow{}, nil
	}

	q := pdt601FilteredCompaniesQuery(p)
	var companies []models.Company
	if err := q.Order("companies.internal_code ASC").Find(&companies).Error; err != nil {
		return nil, err
	}

	return s.pdt601BuildRows(companies, p.PeriodYM)
}
