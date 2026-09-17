package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

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
	ControlID         uint                         `json:"control_id"`
	ControlDueDate    *time.Time                   `json:"control_due_date,omitempty"`
	Declaration       models.SupervisorDeclaration `json:"declaration"`
	Record            *Pdt621RecordDTO             `json:"record,omitempty"`
	// AssistantTimeliness mismo criterio que Pdt621ListRow.AssistantTimeliness — plazo interno del
	// estudio (no el cronograma SUNAT), presente acá para que el detalle pueda mostrar "Entregado" vs
	// "Entregado fuera de fecha" (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §5/§12).
	AssistantTimeliness string `json:"assistant_timeliness"`
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

// Pdt621RecordDTO seguimiento manual PDT 621 del período (salida a UI).
type Pdt621RecordDTO struct {
	Suspendida          bool    `json:"suspendida"`
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

// Pdt621RecordInput datos enviados por el supervisor (fechas como AAAA-MM-DD).
type Pdt621RecordInput struct {
	Suspendida                 bool    `json:"suspendida"`
	PrimeraEntregaFecha        string  `json:"primera_entrega_fecha"`
	PrimeraEntregaHora         string  `json:"primera_entrega_hora"`
	Observacion                string  `json:"observacion"`
	SegundaEntregaFecha        string  `json:"segunda_entrega_fecha"`
	SegundaEntregaHora         string  `json:"segunda_entrega_hora"`
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
		Suspendida:                 r.Suspendida,
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
		deadline := dueDate
		if rule, err := LoadActiveActivityRule(act.ActivityRuleID); err == nil && rule != nil {
			deadline = BuildUploadDeadline(dueDate, rule)
		}
		out = append(out, pdt601DueDateCandidate{Start: act.RucDigitStartSnapshot, End: act.RucDigitEndSnapshot, Due: deadline})
	}
	return out
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
	return &Pdt621Detail{
		PeriodYM:            periodYM,
		CompanyID:           company.ID,
		Code:                strings.TrimSpace(company.InternalCode),
		Dig:                 dig,
		BusinessName:        strings.TrimSpace(company.BusinessName),
		RUC:                 strings.TrimSpace(company.RUC),
		TaxRegime:           strings.TrimSpace(company.TaxRegime),
		AssistantUsername:   assistantUsername(company.Assistant),
		ControlID:           ctrl.ID,
		ControlDueDate:      ctrl.DueDate,
		Declaration:         decl,
		Record:              recordDTO,
		AssistantTimeliness: pdt621AssistantTimeliness(periodYM, dig, recordDTO),
	}, nil
}

// pdt621AssistantTimeliness plazo interno del estudio (calendario de actividades, no el cronograma
// SUNAT) — extraído para reutilizarse tanto en EnsurePdt621 (detalle) como en SavePdt621Record
// (recalcular tras guardar) sin duplicar la lógica de exempt/deliveredAt. `dig` es el dígito de RUC
// de la empresa (§2.7b) — elige la actividad correcta entre las 6 agrupadas por rango.
func pdt621AssistantTimeliness(periodYM, dig string, recordDTO *Pdt621RecordDTO) string {
	exempt := recordDTO != nil && recordDTO.Suspendida
	var primeraEntregaAt *time.Time
	if recordDTO != nil && recordDTO.PrimeraEntregaFecha != nil {
		primeraEntregaAt = pdt601ParseDate(*recordDTO.PrimeraEntregaFecha)
	}
	return ComputeCalendarActivityTimeliness(periodYM, findPdt621CalendarActivity(periodYM, dig), primeraEntregaAt, exempt).Timeliness
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
	// "Suspendida" bloquea CUALQUIER otro dato — mismo criterio que SavePdt601Planilla, reforzado
	// acá server-side. Observacion se fuerza a la nota fija para que quede visible en el listado y
	// el Excel.
	record.Suspendida = in.Suspendida
	if record.Suspendida {
		record.PrimeraEntregaFecha = nil
		record.PrimeraEntregaHora = ""
		record.Observacion = supervisorSuspendidaNote
		record.SegundaEntregaFecha = nil
		record.SegundaEntregaHora = ""
		record.FechaDeclaracion = nil
		record.TotalVentas = 0
		record.TotalCompras = 0
		record.Igv = 0
		record.Rta = 0
		record.CantidadComprobantesVenta = 0
		record.CantidadComprobantesCompra = 0
		record.EnvioSire = ""
		record.FechaEnvioSire = nil
		record.MotivoNoEnvio = ""
	} else {
		record.PrimeraEntregaFecha = pdt601ParseDate(in.PrimeraEntregaFecha)
		record.PrimeraEntregaHora = strings.TrimSpace(in.PrimeraEntregaHora)
		record.Observacion = strings.TrimSpace(in.Observacion)
		record.SegundaEntregaFecha = pdt601ParseDate(in.SegundaEntregaFecha)
		record.SegundaEntregaHora = strings.TrimSpace(in.SegundaEntregaHora)
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
	}

	declStatus := detail.Declaration.Status
	declID := detail.Declaration.ID
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if record.ID == 0 {
			if err := tx.Create(&record).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Save(&record).Error; err != nil {
				return err
			}
		}
		// Entregar automático (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §9): guardar con
		// fecha de entrega cargada es en sí mismo la acción de "entregar" — no hay selector de
		// estado manual. Solo aplica desde Pendiente/Observado, nunca desde Por revisar (ya está
		// ahí) ni Entregado (bloqueado más arriba, antes de llegar acá).
		if record.PrimeraEntregaFecha != nil &&
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

	return s.EnsurePdt621(companyID, periodYM)
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
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_pdt621_records r ON r.monthly_control_id = c.id AND r.deleted_at IS NULL
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND r.suspendida = ?
		)`, p.PeriodYM, true)
	} else if statusFilter == pdt621StatusFilterEntregadoATiempo {
		dueCase, hasAny := pdt621DueDateSQLCase(p.PeriodYM, "companies.id")
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
				AND (r.primera_entrega_fecha IS NULL OR %s IS NULL OR r.primera_entrega_fecha <= %s)
			)`, dueCase, dueCase), models.SupervisorDeclPDT621, models.SupervisorDeclEntregado, p.PeriodYM)
		}
	} else if statusFilter == pdt621StatusFilterEntregadoFueraDeFecha {
		dueCase, hasAny := pdt621DueDateSQLCase(p.PeriodYM, "companies.id")
		if !hasAny {
			q = q.Where("1 = 0")
		} else {
			q = q.Where(fmt.Sprintf(`EXISTS (
				SELECT 1 FROM supervisor_monthly_controls c
				INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
				INNER JOIN supervisor_pdt621_records r ON r.monthly_control_id = c.id AND r.deleted_at IS NULL
				WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
				AND r.primera_entrega_fecha IS NOT NULL AND %s IS NOT NULL AND r.primera_entrega_fecha > %s
			)`, dueCase, dueCase), models.SupervisorDeclPDT621, models.SupervisorDeclEntregado, p.PeriodYM)
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
			Status:            models.SupervisorSunatSinRegistro,
			Record:            recordByCompany[co.ID],
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
		// interna del asistente), igual que "sin planilla" en PDT 601 — ver
		// pdt601BuildRows/exempt más arriba.
		exempt := row.Record != nil && row.Record.Suspendida
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
		if row.Record != nil && row.Record.PrimeraEntregaFecha != nil {
			primeraEntregaAt = pdt601ParseDate(*row.Record.PrimeraEntregaFecha)
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
