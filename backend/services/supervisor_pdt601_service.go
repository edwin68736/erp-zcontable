package services

import (
	"errors"
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
}

// pdt601StatusFilterSinPlanilla filtro sintético del listado: empresas marcadas sin planilla.
const pdt601StatusFilterSinPlanilla = "sin_planilla"

// Pdt601PlanillaDTO datos de planilla PDT 601 del período (salida a UI).
type Pdt601PlanillaDTO struct {
	SinPlanilla                 bool    `json:"sin_planilla"`
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

// findPdt601CalendarActivity busca la instancia "PDT 601" del calendario financiero
// para el período (tipo pdt_601), de donde se resuelve la regla de cumplimiento
// configurada en /settings/activity-configuration. Nil si aún no está en el calendario.
func findPdt601CalendarActivity(periodYM string) *models.FinanceCalendarActivity {
	act, err := FindCalendarActivityByType(periodYM, models.CalendarActivityPDT601)
	if err != nil {
		return nil
	}
	return act
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
		SinPlanilla:                 p.SinPlanilla,
		TrabajadoresONP:             p.TrabajadoresONP,
		TrabajadoresAFP:             p.TrabajadoresAFP,
		TrabajadoresTotal:           p.TrabajadoresONP + p.TrabajadoresAFP,
		Essalud:                     p.Essalud,
		Onp:                         p.Onp,
		Afp:                         p.Afp,
		Sis:                         p.Sis,
		Rta4ta:                      p.Rta4ta,
		Rta5ta:                      p.Rta5ta,
		Sctr:                        p.Sctr,
		Rh:                          p.Rh,
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
	case models.SupervisorDeclAprobado, models.SupervisorDeclPresentado, models.SupervisorDeclCerrado, models.SupervisorDeclObservado:
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

	return &Pdt601Detail{
		PeriodYM:          periodYM,
		CompanyID:         company.ID,
		Code:              strings.TrimSpace(company.InternalCode),
		Dig:               s.companyDig(company.ID),
		BusinessName:      strings.TrimSpace(company.BusinessName),
		RUC:               strings.TrimSpace(company.RUC),
		AssistantUsername: assistantUsername(company.Assistant),
		ControlID:         ctrl.ID,
		ControlDueDate:    ctrl.DueDate,
		Declaration:       decl,
		Planilla:          planillaDTO,
	}, nil
}

// SavePdt601Planilla crea o actualiza la planilla PDT 601 del período (empresa+periodo).
// Reutiliza EnsurePdt601 para garantizar que exista el control mensual y validar acceso/periodo.
func (s *SupervisorService) SavePdt601Planilla(companyID uint, periodYM string, in Pdt601PlanillaInput) (*Pdt601Detail, error) {
	detail, err := s.EnsurePdt601(companyID, periodYM)
	if err != nil {
		return nil, err
	}

	var pl models.SupervisorPdt601Planilla
	err = database.DB.Where("monthly_control_id = ?", detail.ControlID).First(&pl).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		pl = models.SupervisorPdt601Planilla{MonthlyControlID: detail.ControlID}
	}

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

	if err := database.DB.Save(&pl).Error; err != nil {
		return nil, err
	}
	detail.Planilla = pdt601PlanillaToDTO(&pl)
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

	// Instancia "PDT 601" del calendario financiero del período (una sola consulta,
	// no por empresa): trae la regla de cumplimiento asignada en Ajustes.
	pdt601Act := findPdt601CalendarActivity(periodYM)

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
		exempt := row.Planilla != nil && row.Planilla.SinPlanilla
		if exempt {
			row.IsOverdue = false
			row.DaysRemaining = nil
		}
		var deliveredAt *time.Time
		if row.Planilla != nil && row.Planilla.FechaEntrega != nil {
			deliveredAt = pdt601ParseDate(*row.Planilla.FechaEntrega)
		}
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
