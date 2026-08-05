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
}

// Pdt621RecordDTO seguimiento manual PDT 621 del período (salida a UI).
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
	EnvioSire           string  `json:"envio_sire"`
	FechaEnvioSire      *string `json:"fecha_envio_sire,omitempty"`
	MotivoNoEnvio       string  `json:"motivo_no_envio"`
}

// Pdt621RecordInput datos enviados por el supervisor (fechas como AAAA-MM-DD).
type Pdt621RecordInput struct {
	PrimeraEntregaFecha string  `json:"primera_entrega_fecha"`
	PrimeraEntregaHora  string  `json:"primera_entrega_hora"`
	Observacion         string  `json:"observacion"`
	SegundaEntregaFecha string  `json:"segunda_entrega_fecha"`
	SegundaEntregaHora  string  `json:"segunda_entrega_hora"`
	FechaDeclaracion    string  `json:"fecha_declaracion"`
	TotalVentas         float64 `json:"total_ventas"`
	TotalCompras        float64 `json:"total_compras"`
	Igv                 float64 `json:"igv"`
	Rta                 float64 `json:"rta"`
	EnvioSire           string  `json:"envio_sire"`
	FechaEnvioSire      string  `json:"fecha_envio_sire"`
	MotivoNoEnvio       string  `json:"motivo_no_envio"`
}

func pdt621RecordToDTO(r *models.SupervisorPdt621Record) *Pdt621RecordDTO {
	if r == nil {
		return nil
	}
	return &Pdt621RecordDTO{
		PrimeraEntregaFecha: pdt601DateString(r.PrimeraEntregaFecha),
		PrimeraEntregaHora:  r.PrimeraEntregaHora,
		Observacion:         r.Observacion,
		SegundaEntregaFecha: pdt601DateString(r.SegundaEntregaFecha),
		SegundaEntregaHora:  r.SegundaEntregaHora,
		FechaDeclaracion:    pdt601DateString(r.FechaDeclaracion),
		TotalVentas:         r.TotalVentas,
		TotalCompras:        r.TotalCompras,
		Igv:                 r.Igv,
		Rta:                 r.Rta,
		EnvioSire:           r.EnvioSire,
		FechaEnvioSire:      pdt601DateString(r.FechaEnvioSire),
		MotivoNoEnvio:       r.MotivoNoEnvio,
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

	return &Pdt621Detail{
		PeriodYM:          periodYM,
		CompanyID:         company.ID,
		Code:              strings.TrimSpace(company.InternalCode),
		Dig:               s.companyDig(company.ID),
		BusinessName:      strings.TrimSpace(company.BusinessName),
		RUC:               strings.TrimSpace(company.RUC),
		TaxRegime:         strings.TrimSpace(company.TaxRegime),
		AssistantUsername: assistantUsername(company.Assistant),
		ControlID:         ctrl.ID,
		ControlDueDate:    ctrl.DueDate,
		Declaration:       decl,
		Record:            recordDTO,
	}, nil
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
	if _, err := s.EnsurePdt621(companyID, periodYM); err != nil {
		return nil, err
	}
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
		return nil, err
	}

	var record models.SupervisorPdt621Record
	err := database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	record.MonthlyControlID = ctrl.ID
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
	record.EnvioSire = strings.TrimSpace(in.EnvioSire)
	record.FechaEnvioSire = pdt601ParseDate(in.FechaEnvioSire)
	record.MotivoNoEnvio = strings.TrimSpace(in.MotivoNoEnvio)

	if record.ID == 0 {
		if err := database.DB.Create(&record).Error; err != nil {
			return nil, err
		}
	} else {
		if err := database.DB.Save(&record).Error; err != nil {
			return nil, err
		}
	}

	return s.EnsurePdt621(companyID, periodYM)
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

	q := database.DB.Model(&models.Company{}).
		Where("companies.client_type = ? AND companies.status = ?", models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant")

	if len(p.AllowedCompanyIDs) > 0 {
		q = q.Where("companies.id IN ?", p.AllowedCompanyIDs)
	} else if p.AllowedCompanyIDs != nil {
		return &pdt621ListResult{
			Rows: []Pdt621ListRow{}, Total: 0, Page: page, PerPage: perPage, TotalPages: 0,
		}, nil
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
		q = q.Where(
			"companies.ruc LIKE ? OR companies.business_name LIKE ? OR companies.internal_code LIKE ?",
			like, like, like,
		)
	}

	statusFilter := strings.TrimSpace(p.Status)
	if statusFilter == models.SupervisorSunatSinRegistro {
		q = q.Where(`NOT EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
		)`, models.SupervisorDeclPDT621, p.PeriodYM)
	} else if statusFilter != "" {
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
		)`, models.SupervisorDeclPDT621, statusFilter, p.PeriodYM)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var companies []models.Company
	offset := (page - 1) * perPage
	if err := q.Order("companies.internal_code ASC").Offset(offset).Limit(perPage).Find(&companies).Error; err != nil {
		return nil, err
	}

	rows := make([]Pdt621ListRow, 0, len(companies))
	if len(companies) == 0 {
		return &pdt621ListResult{
			Rows: rows, Total: total, Page: page, PerPage: perPage,
			TotalPages: sunatInboxTotalPages(total, perPage),
		}, nil
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
		Where("c.company_id IN ? AND c.period_ym = ? AND c.deleted_at IS NULL", ids, p.PeriodYM).
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
		Where("c.company_id IN ? AND c.period_ym = ? AND r.deleted_at IS NULL", ids, p.PeriodYM).
		Scan(&records).Error
	for i := range records {
		rec := records[i].SupervisorPdt621Record
		recordByCompany[records[i].CompanyID] = pdt621RecordToDTO(&rec)
	}

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

		scheduleDue := pdt621ScheduleDueDate(p.PeriodYM, row.Dig)
		row.ScheduleDueDate = pdt601DateString(scheduleDue)
		var declaredAt *time.Time
		if row.Record != nil && row.Record.FechaDeclaracion != nil {
			declaredAt = pdt601ParseDate(*row.Record.FechaDeclaracion)
		}
		if scheduleDue != nil {
			deadline := time.Date(scheduleDue.Year(), scheduleDue.Month(), scheduleDue.Day(), 23, 59, 59, 0, time.Local)
			row.DeclarationTimeliness = EvaluateUploadTimeliness(
				time.Now(), declaredAt, deadline, true, false, models.ActivityRuleCompareDate,
			)
		} else {
			row.DeclarationTimeliness = TimelinessNoRule
		}

		rows = append(rows, row)
	}

	return &pdt621ListResult{
		Rows: rows, Total: total, Page: page, PerPage: perPage,
		TotalPages: sunatInboxTotalPages(total, perPage),
	}, nil
}
