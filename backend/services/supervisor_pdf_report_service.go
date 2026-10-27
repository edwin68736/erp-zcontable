package services

import (
	"errors"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// Módulos de "informe en PDF": Informe detracciones y Siscont balances. Misma mecánica en ambos —
// el asistente carga UN solo PDF por empresa y período (el nuevo reemplaza al anterior), con su fecha
// de cumplimiento; la entrega queda "Por revisar" hasta que el supervisor la aprueba ("Entregado") u
// observa. Usan el enum reducido de estados de PDT 601/621 (pendiente → por_revisar → entregado /
// observado) y el calendario de actividades (/settings/activity-configuration) para evaluar si la
// fecha de cumplimiento fue a tiempo. Un único servicio parametrizado por módulo, en vez de dos
// copias, porque la lógica es idéntica.

// PdfReportModule identifica un módulo de informe en PDF.
type PdfReportModule struct {
	Slug         string // segmento de URL /activity-modules/:slug
	DeclType     string // declaration_type
	CalendarType string // activity_type del calendario financiero
	Label        string
}

var (
	PdfReportInformeDetracciones = PdfReportModule{
		Slug:         "informe-detracciones",
		DeclType:     models.SupervisorDeclInformeDetracciones,
		CalendarType: models.CalendarActivityInformeDetracciones,
		Label:        "Informe detracciones",
	}
	PdfReportSiscontBalances = PdfReportModule{
		Slug:         "siscont-balances",
		DeclType:     models.SupervisorDeclSiscontBalances,
		CalendarType: models.CalendarActivitySiscontBalances,
		Label:        "Siscont balances",
	}
)

// isPdfReportDeclarationType true para los tipos de declaración de los módulos de informe en PDF.
func isPdfReportDeclarationType(t string) bool {
	return t == models.SupervisorDeclInformeDetracciones || t == models.SupervisorDeclSiscontBalances
}

// isReducedStatusDeclarationType true para los tipos que usan el enum reducido de estados
// (pendiente/por_revisar/observado/entregado): PDT 601/621 y los informes en PDF. Las acciones
// dedicadas (Aprobar, Observar, Reabrir) y la regla "completa = entregado" cuelgan de este
// predicado.
func isReducedStatusDeclarationType(t string) bool {
	return isPdt601Pdt621DeclarationType(t) || isPdfReportDeclarationType(t)
}

// isSingleFileDeclarationType tipos de declaración con la regla "un solo archivo": al cargar uno
// nuevo, el anterior se reemplaza (ver replacePreviousSingleFileAttachments).
func isSingleFileDeclarationType(t string) bool {
	return isPdt601Pdt621DeclarationType(t) || isPdfReportDeclarationType(t)
}

// Filtros sintéticos del listado, además de los estados reales.
const pdfReportStatusFilterSuspendida = "suspendida"

type PdfReportListParams struct {
	PeriodYM          string
	Status            string
	Q                 string
	Dig               string
	AssistantUserID   uint
	// SupervisorUserID filtra por el supervisor asignado a la empresa (0 = todos).
	SupervisorUserID  uint
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

// PdfReportListRow fila del listado (empresa + período + módulo).
type PdfReportListRow struct {
	CompanyID         uint   `json:"company_id"`
	Code              string `json:"code"`
	Dig               string `json:"dig"`
	BusinessName      string `json:"business_name"`
	RUC               string `json:"ruc"`
	AssistantUsername string `json:"assistant_username"`
	ControlID         *uint  `json:"control_id,omitempty"`
	DeclarationID     *uint  `json:"declaration_id,omitempty"`
	// Status siempre un valor real del enum (pendiente cuando todavía no hay registro).
	Status string `json:"status"`
	// DueDate fecha límite del calendario de actividades para el grupo de RUC de la empresa (nil si el
	// período no tiene la actividad configurada).
	DueDate *string `json:"due_date,omitempty"`
	// FechaEntrega fecha de cumplimiento registrada al cargar el PDF.
	FechaEntrega *string `json:"fecha_entrega,omitempty"`
	// Timeliness cumplimiento vs. calendario (on_time | late | pending | missing | exempt | no_rule).
	Timeliness      string     `json:"timeliness"`
	Suspendida      bool       `json:"suspendida"`
	AttachmentCount int64      `json:"attachment_count"`
	FileName        string     `json:"file_name,omitempty"`
	FileURL         string     `json:"file_url,omitempty"`
	LastStoredAt    *time.Time `json:"last_stored_at,omitempty"`
	// Observacion motivo de la última observación del supervisor (solo con estado "observado").
	Observacion string `json:"observacion,omitempty"`
}

// PdfReportDetail detalle de un informe en PDF tras EnsurePdfReport.
type PdfReportDetail struct {
	PeriodYM          string                       `json:"period_ym"`
	CompanyID         uint                         `json:"company_id"`
	Code              string                       `json:"code"`
	Dig               string                       `json:"dig"`
	BusinessName      string                       `json:"business_name"`
	RUC               string                       `json:"ruc"`
	AssistantUsername string                       `json:"assistant_username"`
	ControlID         uint                         `json:"control_id"`
	ControlSuspendida bool                         `json:"control_suspendida"`
	Declaration       models.SupervisorDeclaration `json:"declaration"`
	FechaEntrega      *string                      `json:"fecha_entrega,omitempty"`
	Timeliness        string                       `json:"timeliness"`
	// CalendarDueDate fecha límite resuelta por el calendario de actividades para el grupo de RUC de
	// esta empresa — nil si el período no tiene la actividad configurada.
	CalendarDueDate *time.Time `json:"calendar_due_date,omitempty"`
}

type pdfReportListResult struct {
	Rows       []PdfReportListRow
	Total      int64
	Page       int
	PerPage    int
	TotalPages int
}

func pdfReportDateString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

// pdfReportTimeliness evalúa el cumplimiento de la fecha de entrega contra la actividad del
// calendario que le corresponde a la empresa. Suspendida es exenta.
func pdfReportTimeliness(periodYM string, act *models.FinanceCalendarActivity, deliveredAt *time.Time, suspendida bool) UploadTimelinessDTO {
	return ComputeCalendarActivityTimeliness(periodYM, act, deliveredAt, suspendida)
}

// EnsurePdfReport crea control y declaración del módulo al abrir el detalle (lazy, igual que PDT 601).
func (s *SupervisorService) EnsurePdfReport(mod PdfReportModule, companyID uint, periodYM string) (*PdfReportDetail, error) {
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
		if err := tx.Where("monthly_control_id = ? AND declaration_type = ?", ctrl.ID, mod.DeclType).
			First(&decl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			decl = models.SupervisorDeclaration{
				MonthlyControlID: ctrl.ID,
				DeclarationType:  mod.DeclType,
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

	dig := s.companyDig(company.ID)
	act := PickCalendarActivityByDigitFor(periodYM, mod.CalendarType, dig)
	timeliness := pdfReportTimeliness(periodYM, act, decl.DeliveredAt, ctrl.Suspendida)

	return &PdfReportDetail{
		PeriodYM:          periodYM,
		CompanyID:         company.ID,
		Code:              strings.TrimSpace(company.InternalCode),
		Dig:               dig,
		BusinessName:      strings.TrimSpace(company.BusinessName),
		RUC:               strings.TrimSpace(company.RUC),
		AssistantUsername: assistantUsername(company.Assistant),
		ControlID:         ctrl.ID,
		ControlSuspendida: ctrl.Suspendida,
		Declaration:       decl,
		FechaEntrega:      pdfReportDateString(decl.DeliveredAt),
		Timeliness:        timeliness.Timeliness,
		CalendarDueDate:   timeliness.DueAt,
	}, nil
}

// PickCalendarActivityByDigitFor trae las actividades del tipo y elige la del dígito de RUC dado
// (mismo criterio que findPdt601CalendarActivity, para cualquier tipo).
func PickCalendarActivityByDigitFor(periodYM, calendarType, dig string) *models.FinanceCalendarActivity {
	act, err := FindCalendarActivityByTypeAndDigit(periodYM, calendarType, pdt601DigitFromString(dig))
	if err != nil {
		return nil
	}
	return act
}

// CheckPdfReportSubmittable valida, ANTES de guardar el archivo, que el informe pueda recibir una
// entrega: no suspendida y no ya entregada (aprobada) — para entregar de nuevo hay que Reabrir.
func CheckPdfReportSubmittable(detail *PdfReportDetail) error {
	if detail.ControlSuspendida {
		return errors.New("esta empresa está suspendida en este período (marcado desde Control de Detracciones); no se puede cargar")
	}
	if detail.Declaration.Status == models.SupervisorDeclEntregado {
		return errors.New("esta entrega ya fue aprobada; no se puede reemplazar (use Reabrir si corresponde)")
	}
	return nil
}

// ParsePdfReportFechaEntrega interpreta la fecha de cumplimiento (AAAA-MM-DD): vacía = hoy; una
// fecha futura se rechaza. Exportada para que el controlador valide antes de guardar el archivo.
func ParsePdfReportFechaEntrega(raw string) (*time.Time, error) {
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	if strings.TrimSpace(raw) == "" {
		return &today, nil
	}
	d := pdt601ParseDate(raw)
	if d == nil {
		return nil, errors.New("fecha de cumplimiento inválida (use AAAA-MM-DD)")
	}
	if d.After(today) {
		return nil, errors.New("la fecha de cumplimiento no puede ser futura")
	}
	return d, nil
}

// SubmitPdfReport registra la entrega: guarda el adjunto (que reemplaza al anterior), fija la fecha
// de cumplimiento (hoy si viene vacía; no puede ser futura) y deja la declaración en "Por revisar"
// (desde Pendiente, Observado o un reemplazo mientras sigue por revisar).
func (s *SupervisorService) SubmitPdfReport(
	mod PdfReportModule, detail *PdfReportDetail, userID uint, fileName, relURL, fechaEntrega string,
) (*PdfReportDetail, error) {
	if err := CheckPdfReportSubmittable(detail); err != nil {
		return nil, err
	}
	delivered, err := ParsePdfReportFechaEntrega(fechaEntrega)
	if err != nil {
		return nil, err
	}

	declID := detail.Declaration.ID
	oldStatus := detail.Declaration.Status
	if _, err := s.SaveAttachment(detail.ControlID, declID, userID, fileName, relURL); err != nil {
		return nil, err
	}
	if err := database.DB.Model(&models.SupervisorDeclaration{}).
		Where("id = ?", declID).
		Updates(map[string]interface{}{
			"status":       models.SupervisorDeclPorRevisar,
			"progress_pct": declarationProgressFromStatus(models.SupervisorDeclPorRevisar),
			"delivered_at": delivered,
		}).Error; err != nil {
		return nil, err
	}
	if oldStatus != models.SupervisorDeclPorRevisar {
		s.LogChange("declaration", declID, "status", oldStatus, models.SupervisorDeclPorRevisar, userID)
	}
	return s.EnsurePdfReport(mod, detail.CompanyID, detail.PeriodYM)
}

// pdfReportFilteredCompaniesQuery arma el query de empresas con los filtros del listado (salvo
// AllowedCompanyIDs vacío-no-nil, que cada caller resuelve antes). Compartido por listado y export.
func pdfReportFilteredCompaniesQuery(mod PdfReportModule, p PdfReportListParams) *gorm.DB {
	q := database.DB.Model(&models.Company{}).
		Where("companies.client_type = ? AND companies.status = ?", models.CompanyClientTypeEstudio, "activo").
		Preload("Assistant")

	if len(p.AllowedCompanyIDs) > 0 {
		q = q.Where("companies.id IN ?", p.AllowedCompanyIDs)
	}
	q = applyCompanyOwnerFilters(q, "companies", p.AssistantUserID, p.SupervisorUserID)
	if dig := strings.TrimSpace(p.Dig); dig != "" {
		q = q.Where(`EXISTS (
			SELECT 1 FROM company_access_credentials cac
			WHERE cac.company_id = companies.id AND cac.dig = ?
		)`, dig)
	}
	if term := strings.TrimSpace(p.Q); len(term) >= 2 {
		like := "%" + term + "%"
		q = q.Where("companies.ruc LIKE ? OR companies.business_name LIKE ?", like, like)
	}

	switch status := strings.TrimSpace(p.Status); status {
	case "":
	case pdfReportStatusFilterSuspendida:
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND c.suspendida = ?
		)`, p.PeriodYM, true)
	case models.SupervisorDeclPendiente:
		// Pendiente incluye a las empresas que todavía no tienen registro del módulo.
		q = q.Where(`NOT EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
			AND d.status IN (?, ?, ?)
		)`, mod.DeclType, p.PeriodYM,
			models.SupervisorDeclPorRevisar, models.SupervisorDeclObservado, models.SupervisorDeclEntregado)
	default:
		q = q.Where(`EXISTS (
			SELECT 1 FROM supervisor_monthly_controls c
			INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.status = ?
			WHERE c.company_id = companies.id AND c.period_ym = ? AND c.deleted_at IS NULL AND d.deleted_at IS NULL
		)`, mod.DeclType, status, p.PeriodYM)
	}
	return q
}

// pdfReportBuildRows arma las filas para un conjunto de empresas YA filtrado.
func (s *SupervisorService) pdfReportBuildRows(mod PdfReportModule, companies []models.Company, periodYM string) []PdfReportListRow {
	rows := make([]PdfReportListRow, 0, len(companies))
	if len(companies) == 0 {
		return rows
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
		DeliveredAt   *time.Time
		Notes         string
		Suspendida    bool
	}
	var decls []declRow
	_ = database.DB.Table("supervisor_monthly_controls AS c").
		Select("c.company_id, c.id AS control_id, d.id AS declaration_id, d.status, d.delivered_at, d.notes, c.suspendida").
		Joins("INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.deleted_at IS NULL", mod.DeclType).
		Where("c.company_id IN ? AND c.period_ym = ? AND c.deleted_at IS NULL", ids, periodYM).
		Scan(&decls).Error
	declByCompany := make(map[uint]declRow, len(decls))
	declIDs := make([]uint, 0, len(decls))
	for _, d := range decls {
		declByCompany[d.CompanyID] = d
		declIDs = append(declIDs, d.DeclarationID)
	}

	// Suspendida es del control (existe aunque todavía no haya declaración de este módulo).
	suspendidaByCompany := map[uint]bool{}
	type suspRow struct {
		CompanyID  uint
		Suspendida bool
	}
	var susp []suspRow
	_ = database.DB.Table("supervisor_monthly_controls").
		Select("company_id, suspendida").
		Where("company_id IN ? AND period_ym = ? AND deleted_at IS NULL", ids, periodYM).
		Scan(&susp).Error
	for _, r := range susp {
		suspendidaByCompany[r.CompanyID] = r.Suspendida
	}

	// Archivo vigente por declaración (la regla de un solo archivo deja uno; si hubiera más por datos
	// anteriores, se toma el más reciente).
	type attRow struct {
		DeclarationID uint
		FileName      string
		FileURL       string
		CreatedAt     time.Time
	}
	attByDecl := map[uint]attRow{}
	attCount := map[uint]int64{}
	if len(declIDs) > 0 {
		var atts []attRow
		_ = database.DB.Model(&models.SupervisorAttachment{}).
			Select("declaration_id, file_name, file_url, created_at").
			Where("declaration_id IN ?", declIDs).
			Order("id ASC").
			Scan(&atts).Error
		for _, a := range atts {
			attByDecl[a.DeclarationID] = a // el último (id mayor) sobrescribe
			attCount[a.DeclarationID]++
		}
	}

	credDig := map[uint]string{}
	var creds []models.CompanyAccessCredential
	_ = database.DB.Where("company_id IN ?", ids).Find(&creds).Error
	for _, cr := range creds {
		credDig[cr.CompanyID] = strings.TrimSpace(cr.Dig)
	}

	acts, _ := CalendarActivitiesForType(periodYM, mod.CalendarType)

	for _, co := range companies {
		row := PdfReportListRow{
			CompanyID:         co.ID,
			Code:              strings.TrimSpace(co.InternalCode),
			Dig:               credDig[co.ID],
			BusinessName:      strings.TrimSpace(co.BusinessName),
			RUC:               strings.TrimSpace(co.RUC),
			AssistantUsername: assistantUsername(co.Assistant),
			Status:            models.SupervisorDeclPendiente,
			Suspendida:        suspendidaByCompany[co.ID],
		}
		var deliveredAt *time.Time
		if d, ok := declByCompany[co.ID]; ok {
			cid, did := d.ControlID, d.DeclarationID
			row.ControlID = &cid
			row.DeclarationID = &did
			row.Status = d.Status
			deliveredAt = d.DeliveredAt
			row.FechaEntrega = pdfReportDateString(d.DeliveredAt)
			if d.Status == models.SupervisorDeclObservado {
				row.Observacion = strings.TrimSpace(d.Notes)
			}
			if a, ok := attByDecl[did]; ok {
				row.FileName = a.FileName
				row.FileURL = a.FileURL
				at := a.CreatedAt
				row.LastStoredAt = &at
				row.AttachmentCount = attCount[did]
			}
		}
		act := PickCalendarActivityByDigit(acts, pdt601DigitFromString(credDig[co.ID]))
		tl := pdfReportTimeliness(periodYM, act, deliveredAt, row.Suspendida)
		row.Timeliness = tl.Timeliness
		row.DueDate = pdfReportDateString(tl.DueAt)
		rows = append(rows, row)
	}
	return rows
}

// ListPdfReport listado empresa+período del módulo; sin lazy create.
func (s *SupervisorService) ListPdfReport(mod PdfReportModule, p PdfReportListParams) (*pdfReportListResult, error) {
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
		return &pdfReportListResult{Rows: []PdfReportListRow{}, Page: page, PerPage: perPage}, nil
	}

	q := pdfReportFilteredCompaniesQuery(mod, p)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}
	var companies []models.Company
	if err := q.Order("companies.internal_code ASC").
		Offset((page - 1) * perPage).Limit(perPage).
		Find(&companies).Error; err != nil {
		return nil, err
	}
	return &pdfReportListResult{
		Rows: s.pdfReportBuildRows(mod, companies, p.PeriodYM), Total: total, Page: page, PerPage: perPage,
		TotalPages: sunatInboxTotalPages(total, perPage),
	}, nil
}

// ExportPdfReport arma el listado COMPLETO (sin paginar) para el reporte Excel.
func (s *SupervisorService) ExportPdfReport(mod PdfReportModule, p PdfReportListParams) ([]PdfReportListRow, error) {
	p.PeriodYM = strings.TrimSpace(p.PeriodYM)
	if err := s.validateOpenPeriod(p.PeriodYM); err != nil {
		return nil, err
	}
	if p.AllowedCompanyIDs != nil && len(p.AllowedCompanyIDs) == 0 {
		return []PdfReportListRow{}, nil
	}
	var companies []models.Company
	if err := pdfReportFilteredCompaniesQuery(mod, p).Order("companies.internal_code ASC").Find(&companies).Error; err != nil {
		return nil, err
	}
	return s.pdfReportBuildRows(mod, companies, p.PeriodYM), nil
}
