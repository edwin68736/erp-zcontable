package services

import (
	"errors"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// DetraccionesListParams filtros del listado Control de Detracciones por empresa y período.
type DetraccionesListParams struct {
	PeriodYM          string
	Status            string
	Q                 string
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

// DetraccionesListRow fila del listado (empresa + período + módulo detracciones).
type DetraccionesListRow struct {
	CompanyID         uint       `json:"company_id"`
	Code              string     `json:"code"`
	Dig               string     `json:"dig"`
	BusinessName      string     `json:"business_name"`
	RUC               string     `json:"ruc"`
	AssistantUsername string     `json:"assistant_username"`
	ControlID         *uint      `json:"control_id,omitempty"`
	DeclarationID     *uint      `json:"declaration_id,omitempty"`
	Status            string     `json:"status"`
	AttachmentCount   int64      `json:"attachment_count"`
	LastStoredAt      *time.Time `json:"last_stored_at,omitempty"`
	FileName          string                    `json:"file_name,omitempty"`
	FileURL           string                    `json:"file_url,omitempty"`
	Timeliness        DetraccionesTimelinessDTO `json:"timeliness"`
}

// DetraccionesDetail detalle tras EnsureDetracciones (lazy create).
type DetraccionesDetail struct {
	PeriodYM          string                       `json:"period_ym"`
	CompanyID         uint                         `json:"company_id"`
	Code              string                       `json:"code"`
	Dig               string                       `json:"dig"`
	BusinessName      string                       `json:"business_name"`
	RUC               string                       `json:"ruc"`
	AssistantUsername string                       `json:"assistant_username"`
	ControlID         uint                         `json:"control_id"`
	Declaration       models.SupervisorDeclaration `json:"declaration"`
	Timeliness        DetraccionesTimelinessDTO    `json:"timeliness"`
}

type detraccionesListResult struct {
	Rows       []DetraccionesListRow
	Total      int64
	Page       int
	PerPage    int
	TotalPages int
}

func detraccionesDeclarationTypes() []string {
	return []string{models.SupervisorDeclDetracciones, models.SupervisorDeclDistractionsLegacy}
}

func isDetraccionesDeclarationType(t string) bool {
	return t == models.SupervisorDeclDetracciones || t == models.SupervisorDeclDistractionsLegacy
}

// EnsureDetracciones crea control y declaración detracciones solo al abrir detalle (lazy puro).
func (s *SupervisorService) EnsureDetracciones(companyID uint, periodYM string) (*DetraccionesDetail, error) {
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
		if err := tx.Where("monthly_control_id = ? AND declaration_type IN ?", ctrl.ID, detraccionesDeclarationTypes()).
			First(&decl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			decl = models.SupervisorDeclaration{
				MonthlyControlID: ctrl.ID,
				DeclarationType:  models.SupervisorDeclDetracciones,
				Status:           models.SupervisorDeclPendiente,
				ProgressPct:      detraccionesProgressFromStatus(models.SupervisorDeclPendiente),
				Priority:         models.SupervisorPriorityMedia,
			}
			return tx.Create(&decl).Error
		}
		if decl.DeclarationType == models.SupervisorDeclDistractionsLegacy {
			decl.DeclarationType = models.SupervisorDeclDetracciones
			return tx.Save(&decl).Error
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	detail := &DetraccionesDetail{
		PeriodYM:          periodYM,
		CompanyID:         company.ID,
		Code:              strings.TrimSpace(company.InternalCode),
		Dig:               s.companyDig(company.ID),
		BusinessName:      strings.TrimSpace(company.BusinessName),
		RUC:               strings.TrimSpace(company.RUC),
		AssistantUsername: assistantUsername(company.Assistant),
		ControlID:         ctrl.ID,
		Declaration:       decl,
	}
	enrichDetraccionesDetail(detail, s.detraccionesLatestStoredAt(decl.ID))
	return detail, nil
}

func (s *SupervisorService) detraccionesLatestStoredAt(declarationID uint) *time.Time {
	var att models.SupervisorAttachment
	if err := database.DB.Where("declaration_id = ?", declarationID).
		Order("created_at DESC").
		First(&att).Error; err != nil {
		return nil
	}
	t := att.CreatedAt
	return &t
}

// ListDetracciones listado empresa+período; sin lazy create.
func (s *SupervisorService) ListDetracciones(p DetraccionesListParams) (*detraccionesListResult, error) {
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

	types := detraccionesDeclarationTypes()

	q := database.DB.Model(&models.Company{}).
		Where("companies.client_type = ? AND companies.status = ?", models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant")

	if len(p.AllowedCompanyIDs) > 0 {
		q = q.Where("companies.id IN ?", p.AllowedCompanyIDs)
	} else if p.AllowedCompanyIDs != nil {
		return &detraccionesListResult{
			Rows: []DetraccionesListRow{}, Total: 0, Page: page, PerPage: perPage, TotalPages: 0,
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
	if statusFilter == models.SupervisorDeclPendiente {
		q = q.Where(`NOT EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type IN ? AND d.deleted_at IS NULL
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.status != ?
		)`, types, p.PeriodYM, models.SupervisorDeclPendiente)
	} else if statusFilter == models.SupervisorSunatSinRegistro {
		q = q.Where(`NOT EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type IN ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
		)`, types, p.PeriodYM)
	} else if statusFilter != "" {
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type IN ? AND d.status = ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
		)`, types, statusFilter, p.PeriodYM)
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

	rows := make([]DetraccionesListRow, 0, len(companies))
	if len(companies) == 0 {
		return &detraccionesListResult{
			Rows: rows, Total: total, Page: page, PerPage: perPage,
			TotalPages: sunatInboxTotalPages(total, perPage),
		}, nil
	}

	ids := make([]uint, 0, len(companies))
	for _, c := range companies {
		ids = append(ids, c.ID)
	}

	type declRow struct {
		CompanyID     uint
		ControlID     uint
		DeclarationID uint
		Status        string
	}
	var decls []declRow
	_ = database.DB.Table("supervisor_monthly_controls AS c").
		Select("c.company_id, c.id AS control_id, d.id AS declaration_id, d.status").
		Joins("INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type IN ? AND d.deleted_at IS NULL", types).
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
		FileName      string
		FileURL       string
	}
	statsByDecl := map[uint]attStat{}
	if len(declIDs) > 0 {
		var atts []models.SupervisorAttachment
		_ = database.DB.Where("declaration_id IN ?", declIDs).
			Order("created_at DESC").
			Find(&atts).Error
		for _, a := range atts {
			if a.DeclarationID == nil {
				continue
			}
			did := *a.DeclarationID
			if _, ok := statsByDecl[did]; ok {
				continue
			}
			statsByDecl[did] = attStat{
				DeclarationID: did,
				Cnt:           0,
				LastAt:        &a.CreatedAt,
				FileName:      a.FileName,
				FileURL:       a.FileURL,
			}
		}
		var stats []attStat
		_ = database.DB.Model(&models.SupervisorAttachment{}).
			Select("declaration_id, COUNT(*) AS cnt, MAX(created_at) AS last_at").
			Where("declaration_id IN ?", declIDs).
			Group("declaration_id").
			Scan(&stats).Error
		for _, st := range stats {
			cur := statsByDecl[st.DeclarationID]
			cur.Cnt = st.Cnt
			if st.LastAt != nil {
				cur.LastAt = st.LastAt
			}
			statsByDecl[st.DeclarationID] = cur
		}
	}

	credDig := map[uint]string{}
	var creds []models.CompanyAccessCredential
	_ = database.DB.Where("company_id IN ?", ids).Find(&creds).Error
	for _, cr := range creds {
		credDig[cr.CompanyID] = strings.TrimSpace(cr.Dig)
	}

	deadlineCtx := findDetraccionesCalendarActivity(p.PeriodYM)

	for _, co := range companies {
		row := DetraccionesListRow{
			CompanyID:         co.ID,
			Code:              strings.TrimSpace(co.InternalCode),
			Dig:               credDig[co.ID],
			BusinessName:      strings.TrimSpace(co.BusinessName),
			RUC:               strings.TrimSpace(co.RUC),
			AssistantUsername: assistantUsername(co.Assistant),
			Status:            models.SupervisorDeclPendiente,
		}
		if d, ok := declByCompany[co.ID]; ok {
			cid, did := d.ControlID, d.DeclarationID
			row.ControlID = &cid
			row.DeclarationID = &did
			row.Status = normalizeDetraccionesDisplayStatus(d.Status)
			if st, ok := statsByDecl[d.DeclarationID]; ok {
				row.AttachmentCount = st.Cnt
				row.LastStoredAt = st.LastAt
				row.FileName = st.FileName
				row.FileURL = st.FileURL
			}
		}
		row.Timeliness = enrichDetraccionesListRow(p.PeriodYM, row.Status, row.LastStoredAt, deadlineCtx)
		rows = append(rows, row)
	}

	return &detraccionesListResult{
		Rows: rows, Total: total, Page: page, PerPage: perPage,
		TotalPages: sunatInboxTotalPages(total, perPage),
	}, nil
}

// ValidateDetracciones marca la declaración detracciones como verificada (supervisor).
func (s *SupervisorService) ValidateDetracciones(declarationID uint, approverID uint) (*models.SupervisorDeclaration, error) {
	var d models.SupervisorDeclaration
	if err := database.DB.First(&d, declarationID).Error; err != nil {
		return nil, errors.New("declaración no encontrada")
	}
	if !isDetraccionesDeclarationType(d.DeclarationType) {
		return nil, errors.New("no es un registro de Control de Detracciones")
	}
	if d.DeclarationType == models.SupervisorDeclDistractionsLegacy {
		d.DeclarationType = models.SupervisorDeclDetracciones
	}
	if err := validateDetraccionesVerifyPreconditions(&d); err != nil {
		return nil, err
	}
	old := d.Status
	d.Status = models.SupervisorDetraccionVerificado
	d.ApproverUserID = &approverID
	d.ProgressPct = detraccionesProgressFromStatus(models.SupervisorDetraccionVerificado)
	if err := database.DB.Save(&d).Error; err != nil {
		return nil, err
	}
	s.LogChange("declaration", declarationID, "status", old, d.Status, approverID)
	return &d, nil
}

// UploadDetraccionesPDF sube el comprobante PDF y pasa el estado a cargado.
func (s *SupervisorService) UploadDetraccionesPDF(companyID uint, periodYM, fileName string, data []byte, userID uint) (*DetraccionesDetail, error) {
	if err := validateDetraccionesPDFFile(fileName, data); err != nil {
		return nil, err
	}
	detail, err := s.EnsureDetracciones(companyID, periodYM)
	if err != nil {
		return nil, err
	}
	decl := detail.Declaration
	if !detraccionesAllowsUpload(decl.Status) {
		return nil, errors.New("no se puede cargar PDF en el estado actual")
	}

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("declaration_id = ?", decl.ID).Delete(&models.SupervisorAttachment{}).Error; err != nil {
			return err
		}
		url, err := s.StoreSupervisorUpload(fileName, data)
		if err != nil {
			return err
		}
		att := models.SupervisorAttachment{
			FileName:         fileName,
			FileURL:          url,
			UploadedByUserID: userID,
			MonthlyControlID: &detail.ControlID,
			DeclarationID:    &decl.ID,
		}
		if err := tx.Create(&att).Error; err != nil {
			return err
		}
		old := decl.Status
		decl.Status = models.SupervisorDetraccionCargado
		decl.ProgressPct = detraccionesProgressFromStatus(models.SupervisorDetraccionCargado)
		if err := tx.Save(&decl).Error; err != nil {
			return err
		}
		s.LogChange("declaration", decl.ID, "status", old, decl.Status, userID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := database.DB.First(&decl, decl.ID).Error; err != nil {
		return nil, err
	}
	detail.Declaration = decl
	enrichDetraccionesDetail(detail, s.detraccionesLatestStoredAt(decl.ID))
	return detail, nil
}

// SetDetraccionesSupervisorStatus permite al supervisor marcar sin_clave o no_corresponde.
func (s *SupervisorService) SetDetraccionesSupervisorStatus(declarationID uint, status string, userID uint) (*models.SupervisorDeclaration, error) {
	status = strings.TrimSpace(status)
	var d models.SupervisorDeclaration
	if err := database.DB.First(&d, declarationID).Error; err != nil {
		return nil, errors.New("declaración no encontrada")
	}
	if !isDetraccionesDeclarationType(d.DeclarationType) {
		return nil, errors.New("no es un registro de Control de Detracciones")
	}
	if err := validateDetraccionesSupervisorStatusTransition(d.Status, status); err != nil {
		return nil, err
	}
	old := d.Status
	d.Status = status
	d.ProgressPct = detraccionesProgressFromStatus(status)
	if err := database.DB.Save(&d).Error; err != nil {
		return nil, err
	}
	s.LogChange("declaration", declarationID, "status", old, d.Status, userID)
	return &d, nil
}

// EnsureDetraccionesDeclarationType verifica declaration_type detracciones (o legacy).
func (s *SupervisorService) EnsureDetraccionesDeclarationType(declarationID uint) error {
	var d models.SupervisorDeclaration
	if err := database.DB.Select("declaration_type").First(&d, declarationID).Error; err != nil {
		return errors.New("declaración no encontrada")
	}
	if !isDetraccionesDeclarationType(d.DeclarationType) {
		return errors.New("no es un registro de Control de Detracciones")
	}
	return nil
}
