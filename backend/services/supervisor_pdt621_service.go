package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	"miappfiber/rbac"

	"gorm.io/gorm"
)

// Pdt621ListParams filtros del listado PDT 621 por empresa y período.
type Pdt621ListParams struct {
	PeriodYM          string
	Status            string
	Q                 string
	Dig               string
	AssistantUserID   uint
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

// Pdt621ListRow fila del listado (empresa + período + módulo pdt_621).
type Pdt621ListRow struct {
	CompanyID         uint             `json:"company_id"`
	Code              string           `json:"code"`
	Dig               string           `json:"dig"`
	BusinessName      string           `json:"business_name"`
	RUC               string           `json:"ruc"`
	TaxRegime         string           `json:"tax_regime"`
	AssistantUsername string           `json:"assistant_username"`
	// SupervisorUserID supervisor asignado a la empresa (companies.supervisor_user_id) — el único que
	// puede Recepcionar el archivador (RecepcionarPdt621); la UI lo usa para mostrar el botón.
	SupervisorUserID  *uint            `json:"supervisor_user_id,omitempty"`
	ControlID         *uint            `json:"control_id,omitempty"`
	DeclarationID     *uint            `json:"declaration_id,omitempty"`
	Status            string           `json:"status"`
	DueDate           *string          `json:"due_date,omitempty"`
	IsOverdue         bool             `json:"is_overdue"`
	DaysRemaining     *int             `json:"days_remaining"`
	AttachmentCount   int64            `json:"attachment_count"`
	LastStoredAt      *time.Time       `json:"last_stored_at,omitempty"`
	Record            *Pdt621RecordDTO `json:"record,omitempty"`
	// ScheduleDueDate fecha del cronograma SUNAT (por dígito de RUC y mes del período) contra la
	// que se compara fecha_declaracion. Timeliness: on_time | late | pending | missing | no_rule.
	ScheduleDueDate       *string `json:"schedule_due_date,omitempty"`
	DeclarationTimeliness string  `json:"declaration_timeliness"`
	// AssistantTimeliness cumplimiento del PLAZO INTERNO del estudio (calendario de actividades,
	// /settings/activity-configuration, tipo "pdt_621") para que el asistente entregue su parte
	// (record.primera_entrega_fecha) — distinto de DeclarationTimeliness, que valida la fecha de
	// declaración ante SUNAT contra el cronograma oficial por dígito de RUC. No evalúa si SUNAT
	// aceptó o no la declaración: solo mide la entrega interna del asistente vs. el calendario.
	AssistantTimeliness string `json:"assistant_timeliness"`
	// Suspendida: SupervisorMonthlyControl.Suspendida (§5.9.7) — global, siempre presente aunque
	// `Record` sea nil (empresa sin registro todavía).
	Suspendida bool `json:"suspendida"`
}

// Pdt621Detail detalle tras EnsurePdt621 (lazy create o reutiliza bootstrap).
type Pdt621Detail struct {
	PeriodYM          string                       `json:"period_ym"`
	CompanyID         uint                         `json:"company_id"`
	Code              string                       `json:"code"`
	Dig               string                       `json:"dig"`
	BusinessName      string                       `json:"business_name"`
	RUC               string                       `json:"ruc"`
	TaxRegime         string                       `json:"tax_regime"`
	AssistantUsername string                       `json:"assistant_username"`
	// SupervisorUserID mismo criterio que Pdt621ListRow.SupervisorUserID.
	SupervisorUserID  *uint                        `json:"supervisor_user_id,omitempty"`
	ControlID         uint                         `json:"control_id"`
	ControlDueDate    *time.Time                   `json:"control_due_date,omitempty"`
	// ControlSuspendida: SupervisorMonthlyControl.Suspendida (docs/diseno-limpieza-control-detail-
	// 2026-09-16.md §5.9.7) — global, de solo lectura acá; se marca/desmarca únicamente desde Control
	// de Detracciones. Siempre presente (a diferencia de Record, que puede ser nil).
	ControlSuspendida bool                         `json:"control_suspendida"`
	Declaration       models.SupervisorDeclaration `json:"declaration"`
	Record            *Pdt621RecordDTO             `json:"record,omitempty"`
	// AssistantTimeliness mismo criterio que Pdt621ListRow.AssistantTimeliness — plazo interno del
	// estudio (no el cronograma SUNAT), presente acá para que el detalle pueda mostrar "Entregado" vs
	// "Entregado fuera de fecha" (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §5/§12).
	AssistantTimeliness string `json:"assistant_timeliness"`
	// CalendarDueDate fecha límite resuelta por el calendario interno del estudio para el grupo de
	// RUC de esta empresa (docs/diseno-limpieza-control-detail-2026-09-16.md §5.7b) — nil si el
	// período no tiene ninguna actividad "pdt_621" configurada. Reemplaza a `declaration.due_date`
	// (0% de uso real, §3.1) como fuente para mostrar "Vencimiento" en el frontend.
	CalendarDueDate *time.Time `json:"calendar_due_date,omitempty"`
}

// pdt621StatusFilterSuspendida filtro sintético del listado: empresas marcadas suspendidas.
const pdt621StatusFilterSuspendida = "suspendida"

// Filtros sintéticos de puntualidad — mismo criterio que pdt601StatusFilterEntregadoATiempo/
// FueraDeFecha, ver docs/diseno-estados-pdt601-pdt621-2026-09-16.md §11. Comparan contra
// pdt621PeriodDueDate (calendario interno), nunca contra el cronograma SUNAT.
const (
	pdt621StatusFilterEntregadoATiempo      = "entregado_a_tiempo"
	pdt621StatusFilterEntregadoFueraDeFecha = "entregado_fuera_de_fecha"
)

// Pdt621RecordDTO seguimiento manual PDT 621 del período (salida a UI). Suspendida ya no es parte de
// este DTO — es global por control, ver Pdt621Detail.ControlSuspendida (§5.9.7).
type Pdt621RecordDTO struct {
	PrimeraEntregaFecha *string `json:"primera_entrega_fecha,omitempty"`
	PrimeraEntregaHora  string  `json:"primera_entrega_hora"`
	Observacion         string  `json:"observacion"`
	SegundaEntregaFecha *string `json:"segunda_entrega_fecha,omitempty"`
	SegundaEntregaHora  string  `json:"segunda_entrega_hora"`
	FechaDeclaracion    *string `json:"fecha_declaracion,omitempty"`
	TotalVentas         float64 `json:"total_ventas"`
	TotalCompras        float64 `json:"total_compras"`
	Igv                 float64 `json:"igv"`
	Rta                 float64 `json:"rta"`
	// Cantidad de comprobantes (NO montos) — solo registro manual, nunca se sincroniza desde la
	// liquidación (ver comentario en models.SupervisorPdt621Record).
	CantidadComprobantesVenta  int     `json:"cantidad_comprobantes_venta"`
	CantidadComprobantesCompra int     `json:"cantidad_comprobantes_compra"`
	EnvioSire                  string  `json:"envio_sire"`
	FechaEnvioSire             *string `json:"fecha_envio_sire,omitempty"`
	MotivoNoEnvio              string  `json:"motivo_no_envio"`
}

// Pdt621RecordInput datos enviados por el supervisor (fechas como AAAA-MM-DD). Suspendida ya no es
// parte de este input — se marca/desmarca solo desde Control de Detracciones (§5.9.7). Tampoco trae
// fecha/hora de 1ra/2da entrega: esas las fija el servidor al Recepcionar (RecepcionarPdt621); si un
// cliente las manda, el JSON las descarta.
type Pdt621RecordInput struct {
	Observacion                string  `json:"observacion"`
	FechaDeclaracion           string  `json:"fecha_declaracion"`
	TotalVentas                float64 `json:"total_ventas"`
	TotalCompras               float64 `json:"total_compras"`
	Igv                        float64 `json:"igv"`
	Rta                        float64 `json:"rta"`
	CantidadComprobantesVenta  int     `json:"cantidad_comprobantes_venta"`
	CantidadComprobantesCompra int     `json:"cantidad_comprobantes_compra"`
	EnvioSire                  string  `json:"envio_sire"`
	FechaEnvioSire             string  `json:"fecha_envio_sire"`
	MotivoNoEnvio              string  `json:"motivo_no_envio"`
}

func pdt621RecordToDTO(r *models.SupervisorPdt621Record) *Pdt621RecordDTO {
	if r == nil {
		return nil
	}
	return &Pdt621RecordDTO{
		PrimeraEntregaFecha:        pdt601DateString(r.PrimeraEntregaFecha),
		PrimeraEntregaHora:         r.PrimeraEntregaHora,
		Observacion:                r.Observacion,
		SegundaEntregaFecha:        pdt601DateString(r.SegundaEntregaFecha),
		SegundaEntregaHora:         r.SegundaEntregaHora,
		FechaDeclaracion:           pdt601DateString(r.FechaDeclaracion),
		TotalVentas:                r.TotalVentas,
		TotalCompras:               r.TotalCompras,
		Igv:                        r.Igv,
		Rta:                        r.Rta,
		CantidadComprobantesVenta:  r.CantidadComprobantesVenta,
		CantidadComprobantesCompra: r.CantidadComprobantesCompra,
		EnvioSire:                  r.EnvioSire,
		FechaEnvioSire:             pdt601DateString(r.FechaEnvioSire),
		MotivoNoEnvio:              r.MotivoNoEnvio,
	}
}

// pdt621ScheduleDueDate resuelve la fecha del cronograma SUNAT (por mes del período y dígito de
// RUC) contra la que se valida la fecha de declaración PDT 621. Nil si el dígito no es válido
// (0-9), el período no parsea, o el cronograma de ese mes aún no tiene esa fecha cargada.
func pdt621ScheduleDueDate(periodYM, dig string) *time.Time {
	dig = strings.TrimSpace(dig)
	if len(dig) != 1 || dig[0] < '0' || dig[0] > '9' {
		return nil
	}
	idx := int(dig[0] - '0')
	var month int
	if _, err := fmtSscanfMonth(periodYM, &month); err != nil || month < 1 || month > 12 {
		return nil
	}
	var row models.SunatDueDateCalendarRow
	if err := database.DB.Where("month = ?", month).First(&row).Error; err != nil {
		return nil
	}
	var dates [10]string
	if err := json.Unmarshal([]byte(row.DatesJSON), &dates); err != nil {
		return nil
	}
	return pdt601ParseDate(dates[idx])
}

func fmtSscanfMonth(periodYM string, month *int) (int, error) {
	var year int
	return fmt.Sscanf(periodYM, "%d-%d", &year, month)
}

// findPdt621CalendarActivity busca la instancia "PDT 621" del calendario financiero para el período
// (tipo pdt_621) que le corresponde al dígito de RUC de la empresa — puede haber varias agrupadas por
// rango de dígitos (docs/diseno-limpieza-control-detail-2026-09-16.md §2.2/§2.7b, 6 grupos hoy), cada
// una con su propia fecha límite. `dig=""` no distingue (usa la primera/comodín). Distinto de
// pdt621ScheduleDueDate (cronograma SUNAT por dígito de RUC), que valida la fecha de declaración; acá
// no se evalúa nada contra SUNAT, solo la entrega interna del asistente.
func findPdt621CalendarActivity(periodYM, dig string) *models.FinanceCalendarActivity {
	act, err := FindCalendarActivityByTypeAndDigit(periodYM, models.CalendarActivityPDT621, pdt601DigitFromString(dig))
	if err != nil {
		return nil
	}
	return act
}

// pdt621PeriodDueDate fecha límite para PDT 621 según el calendario INTERNO de actividades, **para
// el dígito de RUC de una empresa específica** (§2.7b) — nunca el cronograma SUNAT (ver
// findPdt621CalendarActivity arriba). Mismo criterio que pdt601PeriodDueDate.
func pdt621PeriodDueDate(periodYM, dig string) *time.Time {
	act := findPdt621CalendarActivity(periodYM, dig)
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

// pdt621DueDateCandidates trae y resuelve TODAS las actividades "pdt_621" del período — mismo patrón
// que pdt601DueDateCandidates (supervisor_pdt601_service.go), reutilizado por el filtro SQL del
// listado y el desglose del dashboard.
func pdt621DueDateCandidates(periodYM string) []pdt601DueDateCandidate {
	var acts []models.FinanceCalendarActivity
	_ = database.DB.Table("finance_calendar_activities AS a").
		Select("a.*").
		Joins("INNER JOIN finance_calendars c ON c.id = a.calendar_id AND c.deleted_at IS NULL").
		Where("c.period_ym = ? AND a.activity_type_snapshot = ? AND a.deleted_at IS NULL", periodYM, models.CalendarActivityPDT621).
		Order("a.due_day ASC, a.id ASC").
		Find(&acts).Error
	out := make([]pdt601DueDateCandidate, 0, len(acts))
	for _, act := range acts {
		dueDate, err := dueDateForActivity(periodYM, act.DueDay)
		if err != nil {
			continue
		}
		// Sin regla = fin del día programado (23:59:59): ahora se compara fecha+hora de la recepción
		// (pdt621PuntualidadSQL), y con la medianoche una entrega del mismo día saldría tarde.
		var rule *models.ActivityRule
		if r, err := LoadActiveActivityRule(act.ActivityRuleID); err == nil {
			rule = r
		}
		deadline := BuildUploadDeadline(dueDate, rule)
		out = append(out, pdt601DueDateCandidate{Start: act.RucDigitStartSnapshot, End: act.RucDigitEndSnapshot, Due: deadline})
	}
	return out
}

// pdt621PrimeraEntregaAt fecha + hora de la 1ra entrega (recepción del supervisor), para evaluar el
// plazo interno con reglas de fecha y hora (p. ej. "hasta las 15:00 del día programado"). La hora es
// la de Lima que grabó el servidor al recepcionar; se arma como hora "de pared" en time.Local, igual
// que BuildUploadDeadline arma el límite, así ambos se comparan en la misma escala sin importar la
// zona del servidor. Sin hora (registros viejos) queda a las 00:00, como antes.
func pdt621PrimeraEntregaAt(fecha *string, hora string) *time.Time {
	if fecha == nil {
		return nil
	}
	d := pdt601ParseDate(*fecha)
	if d == nil {
		return nil
	}
	if h, err := time.ParseInLocation("15:04", strings.TrimSpace(hora), time.Local); err == nil {
		t := time.Date(d.Year(), d.Month(), d.Day(), h.Hour(), h.Minute(), 0, 0, time.Local)
		return &t
	}
	return d
}

// pdt621PuntualidadSQL condiciones SQL "entregado a tiempo" / "fuera de plazo" de la 1ra entrega
// (alias `r` = supervisor_pdt621_records) contra el límite del calendario interno, con FECHA + HORA —
// mismo criterio que pdt621PrimeraEntregaAt en Go: fuera de plazo si el día de la recepción es
// posterior al programado, o es el mismo día y la hora (HH:MM) pasa la hora límite de la regla
// ("23:59" si la regla compara solo fecha o no hay regla). Sin hora (registros viejos) cuenta como
// 00:00. Se compara DATE() + texto HH:MM (y no TIMESTAMP) para que funcione igual en MySQL y SQLite.
// ok=false si el período no tiene ninguna actividad PDT 621 en el calendario.
func pdt621PuntualidadSQL(periodYM, companyIDExpr string) (onTime, late string, ok bool) {
	candidates := pdt621DueDateCandidates(periodYM)
	if len(candidates) == 0 {
		return "", "", false
	}
	sq := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	digExpr := fmt.Sprintf("(SELECT cac.dig FROM company_access_credentials cac WHERE cac.company_id = %s LIMIT 1)", companyIDExpr)
	build := func(format string) string {
		var whens []string
		wildcard := "NULL"
		for _, c := range candidates {
			lit := sq(c.Due.Format(format))
			if c.Start == nil || c.End == nil {
				wildcard = lit
				continue
			}
			whens = append(whens, fmt.Sprintf("WHEN CAST(%s AS UNSIGNED) BETWEEN %d AND %d THEN %s", digExpr, *c.Start, *c.End, lit))
		}
		if len(whens) == 0 {
			return wildcard
		}
		return "(CASE " + strings.Join(whens, " ") + " ELSE " + wildcard + " END)"
	}
	dueDay, dueTime := build("2006-01-02"), build("15:04")
	tarde := fmt.Sprintf("(DATE(r.primera_entrega_fecha) > %s OR (DATE(r.primera_entrega_fecha) = %s AND COALESCE(r.primera_entrega_hora, '') > %s))",
		dueDay, dueDay, dueTime)
	onTime = fmt.Sprintf("(r.primera_entrega_fecha IS NULL OR %s IS NULL OR NOT %s)", dueDay, tarde)
	late = fmt.Sprintf("(r.primera_entrega_fecha IS NOT NULL AND %s IS NOT NULL AND %s)", dueDay, tarde)
	return onTime, late, true
}

// pdt621DueDateSQLCase mismo mecanismo que pdt601DueDateSQLCase (supervisor_pdt601_service.go), para
// PDT 621.
func pdt621DueDateSQLCase(periodYM, companyIDExpr string) (sqlExpr string, ok bool) {
	candidates := pdt621DueDateCandidates(periodYM)
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
		return wildcard, true
	}
	return "(CASE " + strings.Join(whens, " ") + " ELSE " + wildcard + " END)", true
}

type pdt621ListResult struct {
	Rows       []Pdt621ListRow
	Total      int64
	Page       int
	PerPage    int
	TotalPages int
}

// EnsurePdt621 crea control y declaración pdt_621 al abrir detalle; reutiliza registro de bootstrap si existe.
func (s *SupervisorService) EnsurePdt621(companyID uint, periodYM string) (*Pdt621Detail, error) {
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
		if err := tx.Where("monthly_control_id = ? AND declaration_type = ?", ctrl.ID, models.SupervisorDeclPDT621).
			First(&decl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			decl = models.SupervisorDeclaration{
				MonthlyControlID: ctrl.ID,
				DeclarationType:  models.SupervisorDeclPDT621,
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

	var record models.SupervisorPdt621Record
	var recordDTO *Pdt621RecordDTO
	if err := database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&record).Error; err == nil {
		recordDTO = pdt621RecordToDTO(&record)
	}

	dig := s.companyDig(company.ID)
	assistantTimeliness := pdt621AssistantTimelinessDTO(periodYM, dig, ctrl.Suspendida, recordDTO)
	return &Pdt621Detail{
		PeriodYM:            periodYM,
		CompanyID:           company.ID,
		Code:                strings.TrimSpace(company.InternalCode),
		Dig:                 dig,
		BusinessName:        strings.TrimSpace(company.BusinessName),
		RUC:                 strings.TrimSpace(company.RUC),
		TaxRegime:           strings.TrimSpace(company.TaxRegime),
		AssistantUsername:   assistantUsername(company.Assistant),
		SupervisorUserID:    company.SupervisorUserID,
		ControlID:           ctrl.ID,
		ControlDueDate:      ctrl.DueDate,
		ControlSuspendida:   ctrl.Suspendida,
		Declaration:         decl,
		Record:              recordDTO,
		AssistantTimeliness: assistantTimeliness.Timeliness,
		CalendarDueDate:     assistantTimeliness.DueAt,
	}, nil
}

// pdt621AssistantTimelinessDTO plazo interno del estudio (calendario de actividades, no el
// cronograma SUNAT) — extraído para reutilizarse tanto en EnsurePdt621 (detalle) como en
// SavePdt621Record (recalcular tras guardar, vía el propio EnsurePdt621) sin duplicar la lógica de
// exempt/deliveredAt. `dig` es el dígito de RUC de la empresa (§2.7b) — elige la actividad correcta
// entre las 6 agrupadas por rango. `controlSuspendida` es SupervisorMonthlyControl.Suspendida (§5.9.7,
// global, ya no vive en Pdt621RecordDTO). Devuelve el DTO completo (no solo el label) para que el
// caller también pueda exponer la fecha límite resuelta (`CalendarDueDate`, §5.7b).
func pdt621AssistantTimelinessDTO(periodYM, dig string, controlSuspendida bool, recordDTO *Pdt621RecordDTO) UploadTimelinessDTO {
	exempt := controlSuspendida
	var primeraEntregaAt *time.Time
	if recordDTO != nil {
		primeraEntregaAt = pdt621PrimeraEntregaAt(recordDTO.PrimeraEntregaFecha, recordDTO.PrimeraEntregaHora)
	}
	return ComputeCalendarActivityTimeliness(periodYM, findPdt621CalendarActivity(periodYM, dig), primeraEntregaAt, exempt)
}

// GetPdt621Record lectura pura del seguimiento PDT 621 del período (sin crear control/declaración).
func (s *SupervisorService) GetPdt621Record(companyID uint, periodYM string) (*Pdt621RecordDTO, error) {
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
	var record models.SupervisorPdt621Record
	if err := database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&record).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return pdt621RecordToDTO(&record), nil
}

// SavePdt621Record crea/actualiza (upsert) el seguimiento PDT 621 del período; asegura
// control+declaración primero (mismo lazy-create que EnsurePdt621).
func (s *SupervisorService) SavePdt621Record(companyID uint, periodYM string, in Pdt621RecordInput) (*Pdt621Detail, error) {
	detail, err := s.EnsurePdt621(companyID, periodYM)
	if err != nil {
		return nil, err
	}
	if detail.Declaration.Status == models.SupervisorDeclEntregado {
		return nil, errors.New("esta declaración ya fue entregada; no se puede editar (use Reabrir si corresponde)")
	}
	// Suspendida ahora es global por control y solo se marca/desmarca desde Control de Detracciones
	// (docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.7) — mientras esté marcada, PDT 621
	// queda de solo lectura.
	if detail.ControlSuspendida {
		return nil, errors.New("esta empresa está suspendida en este período (marcado desde Control de Detracciones); no se puede editar")
	}
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
		return nil, err
	}

	var record models.SupervisorPdt621Record
	err = database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	record.MonthlyControlID = ctrl.ID
	// Fecha/hora de 1ra y 2da entrega NO se toman del input (aunque vengan): solo las fija el
	// servidor al Recepcionar (RecepcionarPdt621). Así nadie puede "acomodar" la fecha de entrega
	// al calendario editándola a mano o llamando a la API directo — el registro existente las
	// conserva tal cual.
	record.Observacion = strings.TrimSpace(in.Observacion)
	record.FechaDeclaracion = pdt601ParseDate(in.FechaDeclaracion)
	record.TotalVentas = in.TotalVentas
	record.TotalCompras = in.TotalCompras
	record.Igv = in.Igv
	record.Rta = in.Rta
	record.CantidadComprobantesVenta = in.CantidadComprobantesVenta
	record.CantidadComprobantesCompra = in.CantidadComprobantesCompra
	record.EnvioSire = strings.TrimSpace(in.EnvioSire)
	record.FechaEnvioSire = pdt601ParseDate(in.FechaEnvioSire)
	record.MotivoNoEnvio = strings.TrimSpace(in.MotivoNoEnvio)

	// Guardar ya no "entrega" (antes: guardar con fecha de 1ra entrega pasaba a Por revisar, ver
	// docs/diseno-estados-pdt601-pdt621-2026-09-16.md §9) — esa transición ahora la hace únicamente
	// RecepcionarPdt621, con la hora del servidor.
	if record.ID == 0 {
		err = database.DB.Create(&record).Error
	} else {
		err = database.DB.Save(&record).Error
	}
	if err != nil {
		return nil, err
	}

	return s.EnsurePdt621(companyID, periodYM)
}

// ErrPdt621RecepcionNoAsignado el usuario no es el supervisor asignado a la empresa — el controlador
// lo traduce a 403.
var ErrPdt621RecepcionNoAsignado = errors.New("solo el supervisor asignado a esta empresa (o un administrador) puede recepcionar el archivador")

// pdt621Now hora actual del servidor; variable para poder fijarla en tests.
var pdt621Now = time.Now

// Pdt621ServerNow hora actual del servidor en Lima — la misma fuente que usa RecepcionarPdt621, para
// que el modal de recepción muestre la fecha/hora que se va a registrar sin depender del reloj de la PC.
func Pdt621ServerNow() time.Time { return pdt621Now().In(limaLoc) }

// RecepcionarPdt621 el supervisor asignado a la empresa recibe físicamente el archivador del
// asistente. Fecha y hora salen SIEMPRE del servidor (hora de Lima), nunca del cliente — así el
// asistente no puede acomodar la fecha al calendario. Deja la declaración igual que antes la dejaba
// la entrega del asistente (Por revisar), para que después se apruebe u observe como siempre:
//   - Pendiente → graba la 1ra entrega. Es la que mide el cumplimiento y queda como historial.
//   - Observado → graba la 2da entrega; la 1ra no se toca.
//
// Cualquier otro estado (Por revisar, Entregado) se rechaza: no se recepciona dos veces.
func (s *SupervisorService) RecepcionarPdt621(companyID uint, periodYM string, userID uint) (*Pdt621Detail, error) {
	if userID == 0 {
		return nil, ErrPdt621RecepcionNoAsignado
	}
	detail, err := s.EnsurePdt621(companyID, periodYM)
	if err != nil {
		return nil, err
	}
	asignado := detail.SupervisorUserID != nil && *detail.SupervisorUserID == userID
	if !asignado && !Authz().HasPermission(userID, rbac.SupervisorsPdt621ReceiveAny) {
		return nil, ErrPdt621RecepcionNoAsignado
	}
	if detail.ControlSuspendida {
		return nil, errors.New("esta empresa está suspendida en este período (marcado desde Control de Detracciones); no se recepciona")
	}
	declStatus := detail.Declaration.Status
	if declStatus != models.SupervisorDeclPendiente && declStatus != models.SupervisorDeclObservado {
		return nil, errors.New("el archivador ya fue recepcionado (solo se recepciona en estado Pendiente u Observado)")
	}

	lt := pdt621Now().In(limaLoc)
	fecha := time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, time.Local)
	hora := lt.Format("15:04")
	uid := userID
	nuevo := fecha.Format("2006-01-02") + " " + hora
	campo, anterior := "pdt621_primera_entrega", ""

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		var record models.SupervisorPdt621Record
		if err := tx.Where("monthly_control_id = ?", detail.ControlID).First(&record).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			record = models.SupervisorPdt621Record{MonthlyControlID: detail.ControlID}
		}
		if declStatus == models.SupervisorDeclPendiente {
			if record.PrimeraEntregaFecha != nil {
				anterior = strings.TrimSpace(record.PrimeraEntregaFecha.Format("2006-01-02") + " " + record.PrimeraEntregaHora)
			}
			record.PrimeraEntregaFecha = &fecha
			record.PrimeraEntregaHora = hora
			record.PrimeraRecepcionPor = &uid
		} else {
			// Si ya hubo una 2da recepción (observado más de una vez) se reemplaza por la última;
			// el valor anterior queda en el historial de cambios.
			campo = "pdt621_segunda_entrega"
			if record.SegundaEntregaFecha != nil {
				anterior = strings.TrimSpace(record.SegundaEntregaFecha.Format("2006-01-02") + " " + record.SegundaEntregaHora)
			}
			record.SegundaEntregaFecha = &fecha
			record.SegundaEntregaHora = hora
			record.SegundaRecepcionPor = &uid
		}
		if record.ID == 0 {
			if err := tx.Create(&record).Error; err != nil {
				return err
			}
		} else if err := tx.Save(&record).Error; err != nil {
			return err
		}
		// Condición sobre el estado en el UPDATE: si dos clics llegan a la vez, solo uno pasa.
		res := tx.Model(&models.SupervisorDeclaration{}).
			Where("id = ? AND status = ?", detail.Declaration.ID, declStatus).
			Updates(map[string]interface{}{
				"status":       models.SupervisorDeclPorRevisar,
				"progress_pct": declarationProgressFromStatus(models.SupervisorDeclPorRevisar),
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errors.New("el archivador ya fue recepcionado")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.LogChange("declaration", detail.Declaration.ID, "status", declStatus, models.SupervisorDeclPorRevisar, userID)
	s.LogChange("declaration", detail.Declaration.ID, campo, anterior, nuevo, userID)
	return s.EnsurePdt621(companyID, periodYM)
}

// IsPdt621Declaration true si la declaración es un PDT 621 (para restringir quién carga su archivo).
func (s *SupervisorService) IsPdt621Declaration(id uint) bool {
	var d models.SupervisorDeclaration
	if err := database.DB.Select("declaration_type").First(&d, id).Error; err != nil {
		return false
	}
	return d.DeclarationType == models.SupervisorDeclPDT621
}

// pdt621FilteredCompaniesQuery arma el query de empresas (sin paginar) para un conjunto de
// filtros — compartido por ListPdt621 (pagina en SQL) y ExportPdt621 (trae todo, para el reporte
// Excel). Mismo patrón que pdt601FilteredCompaniesQuery.
func pdt621FilteredCompaniesQuery(p Pdt621ListParams) *gorm.DB {
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
		)`, models.SupervisorDeclPDT621, p.PeriodYM)
	} else if statusFilter == pdt621StatusFilterSuspendida {
		// Suspendida es global por control desde §5.9.7 — ya no requiere join con
		// supervisor_pdt621_records (esa tabla perdió su propio campo suspendida).
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND c.suspendida = ?
		)`, p.PeriodYM, true)
	} else if statusFilter == pdt621StatusFilterEntregadoATiempo {
		onTime, _, hasAny := pdt621PuntualidadSQL(p.PeriodYM, "companies.id")
		if !hasAny {
			q = q.Where(`EXISTS (
				SELECT 1 FROM supervisor_monthly_controls c
				INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
				WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
			)`, models.SupervisorDeclPDT621, models.SupervisorDeclEntregado, p.PeriodYM)
		} else {
			q = q.Where(fmt.Sprintf(`EXISTS (
				SELECT 1 FROM supervisor_monthly_controls c
				INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
				INNER JOIN supervisor_pdt621_records r ON r.monthly_control_id = c.id AND r.deleted_at IS NULL
				WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
				AND %s
			)`, onTime), models.SupervisorDeclPDT621, models.SupervisorDeclEntregado, p.PeriodYM)
		}
	} else if statusFilter == pdt621StatusFilterEntregadoFueraDeFecha {
		_, late, hasAny := pdt621PuntualidadSQL(p.PeriodYM, "companies.id")
		if !hasAny {
			q = q.Where("1 = 0")
		} else {
			q = q.Where(fmt.Sprintf(`EXISTS (
				SELECT 1 FROM supervisor_monthly_controls c
				INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
				INNER JOIN supervisor_pdt621_records r ON r.monthly_control_id = c.id AND r.deleted_at IS NULL
				WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
				AND %s
			)`, late), models.SupervisorDeclPDT621, models.SupervisorDeclEntregado, p.PeriodYM)
		}
	} else if statusFilter != "" {
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
		)`, models.SupervisorDeclPDT621, statusFilter, p.PeriodYM)
	}

	return q
}

// pdt621BuildRows arma las filas (empresa+control+declaración+registro+cumplimiento) para un
// conjunto de empresas YA filtrado — sin volver a tocar paginación ni filtros. Compartido por
// ListPdt621 y ExportPdt621 para no duplicar el resto del armado de fila.
func (s *SupervisorService) pdt621BuildRows(companies []models.Company, periodYM string) ([]Pdt621ListRow, error) {
	rows := make([]Pdt621ListRow, 0, len(companies))
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
		Joins("INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.deleted_at IS NULL", models.SupervisorDeclPDT621).
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

	// Suspendida es global por control desde §5.9.7 — una sola consulta para todas las empresas del
	// listado, en vez de leerla desde el record (que ya no la tiene).
	suspendidaByCompany := map[uint]bool{}
	type suspendidaRow struct {
		CompanyID  uint
		Suspendida bool
	}
	var suspRows []suspendidaRow
	_ = database.DB.Table("supervisor_monthly_controls").
		Select("company_id, suspendida").
		Where("company_id IN ? AND period_ym = ? AND deleted_at IS NULL", ids, periodYM).
		Scan(&suspRows).Error
	for _, r := range suspRows {
		suspendidaByCompany[r.CompanyID] = r.Suspendida
	}

	// Seguimiento PDT 621 del período por empresa (LEFT JOIN vía control mensual).
	type recordRow struct {
		CompanyID uint
		models.SupervisorPdt621Record
	}
	recordByCompany := map[uint]*Pdt621RecordDTO{}
	var records []recordRow
	_ = database.DB.Table("supervisor_pdt621_records AS r").
		Select("c.company_id, r.*").
		Joins("INNER JOIN supervisor_monthly_controls c ON c.id = r.monthly_control_id AND c.deleted_at IS NULL").
		Where("c.company_id IN ? AND c.period_ym = ? AND r.deleted_at IS NULL", ids, periodYM).
		Scan(&records).Error
	for i := range records {
		rec := records[i].SupervisorPdt621Record
		recordByCompany[records[i].CompanyID] = pdt621RecordToDTO(&rec)
	}

	// Instancias "PDT 621" del calendario financiero del período (una sola consulta, no por
	// empresa) — puede haber varias agrupadas por rango de RUC (§2.7b, 6 grupos hoy); se elige la
	// que corresponde a cada empresa dentro del loop, por su dígito (`row.Dig`).
	pdt621Acts, _ := CalendarActivitiesForType(periodYM, models.CalendarActivityPDT621)

	for _, co := range companies {
		row := Pdt621ListRow{
			CompanyID:         co.ID,
			Code:              strings.TrimSpace(co.InternalCode),
			Dig:               credDig[co.ID],
			BusinessName:      strings.TrimSpace(co.BusinessName),
			RUC:               strings.TrimSpace(co.RUC),
			TaxRegime:         strings.TrimSpace(co.TaxRegime),
			AssistantUsername: assistantUsername(co.Assistant),
			SupervisorUserID:  co.SupervisorUserID,
			Status:            models.SupervisorSunatSinRegistro,
			Record:            recordByCompany[co.ID],
			Suspendida:        suspendidaByCompany[co.ID],
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

		// Empresa suspendida en el período: exime ambos cumplimientos (declaración SUNAT y entrega
		// interna del asistente) — global por control desde §5.9.7, ya no depende de que exista
		// Record.
		exempt := row.Suspendida
		if exempt {
			row.IsOverdue = false
			row.DaysRemaining = nil
		}

		scheduleDue := pdt621ScheduleDueDate(periodYM, row.Dig)
		row.ScheduleDueDate = pdt601DateString(scheduleDue)
		var declaredAt *time.Time
		if row.Record != nil && row.Record.FechaDeclaracion != nil {
			declaredAt = pdt601ParseDate(*row.Record.FechaDeclaracion)
		}
		if scheduleDue != nil {
			deadline := time.Date(scheduleDue.Year(), scheduleDue.Month(), scheduleDue.Day(), 23, 59, 59, 0, time.Local)
			row.DeclarationTimeliness = EvaluateUploadTimeliness(
				time.Now(), declaredAt, deadline, true, exempt, models.ActivityRuleCompareDate,
			)
		} else if exempt {
			row.DeclarationTimeliness = TimelinessExempt
		} else {
			row.DeclarationTimeliness = TimelinessNoRule
		}

		// Plazo interno del estudio (calendario de actividades): cuándo el asistente hizo la
		// primera entrega, sin importar si SUNAT terminó aceptando la declaración o no — eso ya lo
		// cubre DeclarationTimeliness arriba, contra el cronograma oficial.
		var primeraEntregaAt *time.Time
		if row.Record != nil {
			primeraEntregaAt = pdt621PrimeraEntregaAt(row.Record.PrimeraEntregaFecha, row.Record.PrimeraEntregaHora)
		}
		pdt621Act := PickCalendarActivityByDigit(pdt621Acts, pdt601DigitFromString(row.Dig))
		row.AssistantTimeliness = ComputeCalendarActivityTimeliness(periodYM, pdt621Act, primeraEntregaAt, exempt).Timeliness

		rows = append(rows, row)
	}

	return rows, nil
}

// ListPdt621 listado empresa+período; sin lazy create.
func (s *SupervisorService) ListPdt621(p Pdt621ListParams) (*pdt621ListResult, error) {
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
		return &pdt621ListResult{
			Rows: []Pdt621ListRow{}, Total: 0, Page: page, PerPage: perPage, TotalPages: 0,
		}, nil
	}

	q := pdt621FilteredCompaniesQuery(p)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var companies []models.Company
	offset := (page - 1) * perPage
	if err := q.Order("companies.internal_code ASC").Offset(offset).Limit(perPage).Find(&companies).Error; err != nil {
		return nil, err
	}

	rows, err := s.pdt621BuildRows(companies, p.PeriodYM)
	if err != nil {
		return nil, err
	}

	return &pdt621ListResult{
		Rows: rows, Total: total, Page: page, PerPage: perPage,
		TotalPages: sunatInboxTotalPages(total, perPage),
	}, nil
}

// ExportPdt621 arma el listado COMPLETO (todas las empresas que matchean los filtros, sin paginar)
// para el reporte Excel — misma lógica de filtrado y armado de fila que ListPdt621, sin el límite
// de página.
func (s *SupervisorService) ExportPdt621(p Pdt621ListParams) ([]Pdt621ListRow, error) {
	p.PeriodYM = strings.TrimSpace(p.PeriodYM)
	if err := s.validateOpenPeriod(p.PeriodYM); err != nil {
		return nil, err
	}
	if p.AllowedCompanyIDs != nil && len(p.AllowedCompanyIDs) == 0 {
		return []Pdt621ListRow{}, nil
	}

	q := pdt621FilteredCompaniesQuery(p)
	var companies []models.Company
	if err := q.Order("companies.internal_code ASC").Find(&companies).Error; err != nil {
		return nil, err
	}

	return s.pdt621BuildRows(companies, p.PeriodYM)
}
