package services

import (
	"errors"
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
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

// Pdt621ListRow fila del listado (empresa + período + módulo pdt_621).
type Pdt621ListRow struct {
	CompanyID         uint       `json:"company_id"`
	Code              string     `json:"code"`
	Dig               string     `json:"dig"`
	BusinessName      string     `json:"business_name"`
	RUC               string     `json:"ruc"`
	AssistantUsername string     `json:"assistant_username"`
	ControlID         *uint      `json:"control_id,omitempty"`
	DeclarationID     *uint      `json:"declaration_id,omitempty"`
	Status            string     `json:"status"`
	DueDate           *string    `json:"due_date,omitempty"`
	IsOverdue         bool       `json:"is_overdue"`
	DaysRemaining     *int       `json:"days_remaining"`
	AttachmentCount   int64      `json:"attachment_count"`
	LastStoredAt      *time.Time `json:"last_stored_at,omitempty"`
}

// Pdt621Detail detalle tras EnsurePdt621 (lazy create o reutiliza bootstrap).
type Pdt621Detail struct {
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

	return &Pdt621Detail{
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
	}, nil
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

	for _, co := range companies {
		row := Pdt621ListRow{
			CompanyID:         co.ID,
			Code:              strings.TrimSpace(co.InternalCode),
			Dig:               credDig[co.ID],
			BusinessName:      strings.TrimSpace(co.BusinessName),
			RUC:               strings.TrimSpace(co.RUC),
			AssistantUsername: assistantUsername(co.Assistant),
			Status:            models.SupervisorSunatSinRegistro,
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
		rows = append(rows, row)
	}

	return &pdt621ListResult{
		Rows: rows, Total: total, Page: page, PerPage: perPage,
		TotalPages: sunatInboxTotalPages(total, perPage),
	}, nil
}
