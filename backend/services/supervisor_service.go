package services

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type SupervisorService struct {
	access *AccessService
}

func NewSupervisorService() *SupervisorService {
	return &SupervisorService{access: NewAccessService()}
}

type SupervisorListParams struct {
	PeriodYM           string
	CompanyID          uint
	GeneralStatus      string
	RiskLevel          string
	ResponsibleUserID  uint
	SupervisorUserID   uint
	AllowedCompanyIDs  []uint
	Q                  string
	Page               int
	PerPage            int
}

type SupervisorAlert struct {
	Kind      string `json:"kind"`
	Message   string `json:"message"`
	CompanyID uint   `json:"company_id,omitempty"`
	ControlID uint   `json:"control_id,omitempty"`
	PeriodYM  string `json:"period_ym,omitempty"`
}

type SupervisorDashboard struct {
	TotalActiveCompanies   int64                       `json:"total_active_companies"`
	CompaniesAlDia         int64                       `json:"companies_al_dia"`
	CompaniesPendiente     int64                       `json:"companies_pendiente"`
	CompaniesVencido       int64                       `json:"companies_vencido"`
	CompaniesWithoutControl int64                      `json:"companies_without_control"`
	ControlsAlDia          int64                       `json:"controls_al_dia"`
	ControlsPendiente      int64                       `json:"controls_pendiente"`
	ControlsVencido        int64                       `json:"controls_vencido"`
	ControlsObservado      int64                       `json:"controls_observado"`
	DeclarationsObserved   int64                       `json:"declarations_observed"`
	NPSPending             int64                       `json:"nps_pending"`
	PaymentsPending        int64                       `json:"payments_pending"`
	MonthlyCompliancePct   float64                     `json:"monthly_compliance_pct"`
	ByStatus               map[string]int64            `json:"by_status"`
	Alerts                 []SupervisorAlert           `json:"alerts"`
	Productivity           []SupervisorProductivityRow `json:"productivity"`
}

type SupervisorBootstrapResult struct {
	Created int `json:"created"`
	Skipped int `json:"skipped"`
}

func validPeriodYM(ym string) bool {
	return len(ym) == 7 && ym[4] == '-'
}

func periodDefaultDueDate(ym string) time.Time {
	y, m := 0, 0
	fmt.Sscanf(ym, "%d-%d", &y, &m)
	nm, ny := m+1, y
	if nm > 12 {
		nm = 1
		ny++
	}
	return time.Date(ny, time.Month(nm), 20, 0, 0, 0, 0, time.Local)
}

func (s *SupervisorService) applyCompanyScope(q *gorm.DB, allowed []uint) *gorm.DB {
	if len(allowed) == 0 {
		return q
	}
	return q.Where("supervisor_monthly_controls.company_id IN ?", allowed)
}

func (s *SupervisorService) CanAccessCompany(userID uint, companyID uint, studio bool) (bool, error) {
	if studio {
		return true, nil
	}
	return s.access.CanAccessCompany(userID, companyID)
}

// ControlIDForDeclaration devuelve el control mensual de una declaración.
func (s *SupervisorService) ControlIDForDeclaration(declarationID uint) (uint, error) {
	var d models.SupervisorDeclaration
	if err := database.DB.Select("monthly_control_id").First(&d, declarationID).Error; err != nil {
		return 0, err
	}
	return d.MonthlyControlID, nil
}

// ControlIDForNPS devuelve el control mensual de un registro NPS.
func (s *SupervisorService) ControlIDForNPS(npsID uint) (uint, error) {
	var nps models.SupervisorNPS
	if err := database.DB.Select("monthly_control_id").First(&nps, npsID).Error; err != nil {
		return 0, err
	}
	return nps.MonthlyControlID, nil
}

// CompanyIDForControl devuelve la empresa asociada a un control mensual.
func (s *SupervisorService) CompanyIDForControl(controlID uint) (uint, error) {
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.Select("company_id").First(&ctrl, controlID).Error; err != nil {
		return 0, err
	}
	return ctrl.CompanyID, nil
}

func (s *SupervisorService) ensureControlAccess(controlID uint, userID uint, studio bool) (*models.SupervisorMonthlyControl, error) {
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.First(&ctrl, controlID).Error; err != nil {
		return nil, err
	}
	ok, err := s.CanAccessCompany(userID, ctrl.CompanyID, studio)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("sin acceso a esta empresa")
	}
	return &ctrl, nil
}

func (s *SupervisorService) bootstrapControlChildren(tx *gorm.DB, controlID uint) error {
	types := []string{
		models.SupervisorDeclPDT601,
		models.SupervisorDeclPDT621,
		models.SupervisorDeclSIRE,
		models.SupervisorDeclRentaAnual,
	}
	for _, t := range types {
		d := models.SupervisorDeclaration{
			MonthlyControlID: controlID,
			DeclarationType:  t,
			Status:           models.SupervisorDeclPendiente,
			Priority:         models.SupervisorPriorityMedia,
		}
		if err := tx.Create(&d).Error; err != nil {
			return err
		}
	}
	now := time.Now()
	liq := models.SupervisorTaxLiquidation{
		MonthlyControlID: controlID,
		ValidationStatus: models.SupervisorLiqPendiente,
		CalculatedAt:   &now,
	}
	return tx.Create(&liq).Error
}

// ---- Dashboard ----

func (s *SupervisorService) SyncOverdueControls(periodYM string, allowed []uint) (int64, error) {
	if !validPeriodYM(periodYM) {
		return 0, errors.New("período inválido")
	}
	today := time.Now()
	q := database.DB.Model(&models.SupervisorMonthlyControl{}).
		Where("period_ym = ?", periodYM).
		Where("due_date IS NOT NULL AND due_date < ?", today).
		Where("general_status IN ?", []string{models.SupervisorControlPendiente, models.SupervisorControlAlDia})
	q = s.applyCompanyScope(q, allowed)
	res := q.Update("general_status", models.SupervisorControlVencido)
	return res.RowsAffected, res.Error
}

func (s *SupervisorService) buildDashboardAlerts(periodYM string, allowed []uint, out *SupervisorDashboard) {
	if out == nil {
		return
	}
	alerts := make([]SupervisorAlert, 0, 16)

	if out.ControlsVencido > 0 {
		alerts = append(alerts, SupervisorAlert{
			Kind: "overdue_controls", PeriodYM: periodYM,
			Message: fmt.Sprintf("%d empresa(s) con control vencido en %s", out.ControlsVencido, periodYM),
		})
	}
	if out.DeclarationsObserved > 0 {
		alerts = append(alerts, SupervisorAlert{
			Kind: "observed_declarations", PeriodYM: periodYM,
			Message: fmt.Sprintf("%d declaración(es) observadas", out.DeclarationsObserved),
		})
	}
	if out.NPSPending > 0 {
		alerts = append(alerts, SupervisorAlert{
			Kind: "nps_pending", PeriodYM: periodYM,
			Message: fmt.Sprintf("%d NPS pendiente(s) de gestión", out.NPSPending),
		})
	}

	var missing int64
	qMiss := database.DB.Model(&models.Company{}).Where("status = ?", "activo")
	if len(allowed) > 0 {
		qMiss = qMiss.Where("id IN ?", allowed)
	}
	sub := database.DB.Model(&models.SupervisorMonthlyControl{}).Select("company_id").Where("period_ym = ?", periodYM)
	if len(allowed) > 0 {
		sub = sub.Where("company_id IN ?", allowed)
	}
	_ = qMiss.Where("id NOT IN (?)", sub).Count(&missing).Error
	if missing > 0 {
		alerts = append(alerts, SupervisorAlert{
			Kind: "missing_controls", PeriodYM: periodYM,
			Message: fmt.Sprintf("%d empresa(s) activa(s) sin control en %s", missing, periodYM),
		})
	}

	var overdueRows []struct {
		ID        uint
		CompanyID uint
	}
	qOD := database.DB.Model(&models.SupervisorMonthlyControl{}).
		Select("id, company_id").
		Where("period_ym = ? AND general_status = ?", periodYM, models.SupervisorControlVencido).
		Limit(8)
	qOD = s.applyCompanyScope(qOD, allowed)
	_ = qOD.Scan(&overdueRows).Error
	for _, r := range overdueRows {
		alerts = append(alerts, SupervisorAlert{
			Kind: "overdue_control", PeriodYM: periodYM, ControlID: r.ID, CompanyID: r.CompanyID,
			Message: fmt.Sprintf("Control #%d vencido (empresa %d)", r.ID, r.CompanyID),
		})
	}
	out.Alerts = alerts
}

func (s *SupervisorService) dashboardControlsQuery(p SupervisorDashboardParams) *gorm.DB {
	q := database.DB.Model(&models.SupervisorMonthlyControl{}).Where("period_ym = ?", p.PeriodYM)
	if p.CompanyID > 0 {
		q = q.Where("company_id = ?", p.CompanyID)
	}
	if p.GeneralStatus != "" {
		q = q.Where("general_status = ?", p.GeneralStatus)
	}
	if p.RiskLevel != "" {
		q = q.Where("risk_level = ?", p.RiskLevel)
	}
	if p.ResponsibleUserID > 0 {
		q = q.Where("responsible_user_id = ?", p.ResponsibleUserID)
	}
	if p.SupervisorUserID > 0 {
		q = q.Where("supervisor_user_id = ?", p.SupervisorUserID)
	}
	return s.applyCompanyScope(q, p.AllowedCompanyIDs)
}

func (s *SupervisorService) Dashboard(p SupervisorDashboardParams) (*SupervisorDashboard, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	_, _ = s.SyncOverdueControls(p.PeriodYM, p.AllowedCompanyIDs)
	out := &SupervisorDashboard{ByStatus: map[string]int64{}, Alerts: []SupervisorAlert{}}

	qCompanies := database.DB.Model(&models.Company{}).Where("status = ?", "activo")
	if len(p.AllowedCompanyIDs) > 0 {
		qCompanies = qCompanies.Where("id IN ?", p.AllowedCompanyIDs)
	}
	if p.CompanyID > 0 {
		qCompanies = qCompanies.Where("id = ?", p.CompanyID)
	}
	_ = qCompanies.Count(&out.TotalActiveCompanies).Error

	base := s.dashboardControlsQuery(p)

	countStatus := func(st string, dest *int64) {
		q := s.dashboardControlsQuery(p).Where("general_status = ?", st)
		_ = q.Count(dest).Error
	}
	countStatus(models.SupervisorControlAlDia, &out.ControlsAlDia)
	countStatus(models.SupervisorControlPendiente, &out.ControlsPendiente)
	countStatus(models.SupervisorControlVencido, &out.ControlsVencido)
	countStatus(models.SupervisorControlObservado, &out.ControlsObservado)

	countDistinctCompanies := func(status string, dest *int64) {
		q := s.dashboardControlsQuery(p)
		if status != "" {
			q = q.Where("general_status = ?", status)
		}
		_ = q.Select("COUNT(DISTINCT company_id)").Scan(dest).Error
	}
	countDistinctCompanies(models.SupervisorControlAlDia, &out.CompaniesAlDia)
	var companiesCerrado int64
	countDistinctCompanies(models.SupervisorControlCerrado, &companiesCerrado)
	out.CompaniesAlDia += companiesCerrado
	countDistinctCompanies(models.SupervisorControlPendiente, &out.CompaniesPendiente)
	countDistinctCompanies(models.SupervisorControlVencido, &out.CompaniesVencido)

	subCtrl := database.DB.Model(&models.SupervisorMonthlyControl{}).Select("company_id").Where("period_ym = ?", p.PeriodYM)
	subCtrl = s.applyCompanyScope(subCtrl, p.AllowedCompanyIDs)
	if p.CompanyID > 0 {
		subCtrl = subCtrl.Where("company_id = ?", p.CompanyID)
	}
	_ = qCompanies.Where("id NOT IN (?)", subCtrl).Count(&out.CompaniesWithoutControl).Error

	var controlsCerrado int64
	countStatus(models.SupervisorControlCerrado, &controlsCerrado)
	out.ByStatus[models.SupervisorControlCerrado] = controlsCerrado

	var totalControls int64
	_ = base.Count(&totalControls).Error
	if totalControls > 0 {
		out.MonthlyCompliancePct = math.Round((float64(out.ControlsAlDia+controlsCerrado)/float64(totalControls))*1000) / 10
	}

	qDecl := database.DB.Model(&models.SupervisorDeclaration{}).
		Joins("JOIN supervisor_monthly_controls ON supervisor_monthly_controls.id = supervisor_declarations.monthly_control_id").
		Where("supervisor_monthly_controls.period_ym = ? AND supervisor_declarations.status = ?", p.PeriodYM, models.SupervisorDeclObservado)
	if p.CompanyID > 0 {
		qDecl = qDecl.Where("supervisor_monthly_controls.company_id = ?", p.CompanyID)
	}
	if p.GeneralStatus != "" {
		qDecl = qDecl.Where("supervisor_monthly_controls.general_status = ?", p.GeneralStatus)
	}
	qDecl = s.applyCompanyScope(qDecl, p.AllowedCompanyIDs)
	_ = qDecl.Count(&out.DeclarationsObserved).Error

	qNPS := database.DB.Model(&models.SupervisorNPS{}).
		Joins("JOIN supervisor_monthly_controls ON supervisor_monthly_controls.id = supervisor_nps.monthly_control_id").
		Where("supervisor_monthly_controls.period_ym = ? AND supervisor_nps.payment_status IN ?", p.PeriodYM,
			[]string{models.SupervisorNPSPendienteGenerar, models.SupervisorNPSGenerado, models.SupervisorNPSEnviadoCliente})
	qNPS = s.applyCompanyScope(qNPS, p.AllowedCompanyIDs)
	_ = qNPS.Count(&out.NPSPending).Error

	qPay := database.DB.Model(&models.SupervisorNPS{}).
		Joins("JOIN supervisor_monthly_controls ON supervisor_monthly_controls.id = supervisor_nps.monthly_control_id").
		Where("supervisor_monthly_controls.period_ym = ? AND supervisor_nps.payment_status IN ?", p.PeriodYM,
			[]string{models.SupervisorNPSPendientePago, models.SupervisorNPSVencido})
	qPay = s.applyCompanyScope(qPay, p.AllowedCompanyIDs)
	_ = qPay.Count(&out.PaymentsPending).Error
	out.ByStatus[models.SupervisorControlAlDia] = out.ControlsAlDia
	out.ByStatus[models.SupervisorControlPendiente] = out.ControlsPendiente
	out.ByStatus[models.SupervisorControlVencido] = out.ControlsVencido
	out.ByStatus[models.SupervisorControlObservado] = out.ControlsObservado
	s.buildDashboardAlerts(p.PeriodYM, p.AllowedCompanyIDs, out)
	if prod, err := s.ReportProductivity(p.PeriodYM, p.AllowedCompanyIDs); err == nil {
		out.Productivity = prod
	}
	if out.Productivity == nil {
		out.Productivity = []SupervisorProductivityRow{}
	}
	return out, nil
}

// ---- Periods ----

func (s *SupervisorService) ListPeriods(page, perPage int) ([]models.SupervisorPeriod, int64, error) {
	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}
	var total int64
	if err := database.DB.Model(&models.SupervisorPeriod{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []models.SupervisorPeriod
	err := database.DB.Order("period_ym DESC").Limit(perPage).Offset((page - 1) * perPage).Find(&rows).Error
	return rows, total, err
}

func (s *SupervisorService) CreatePeriod(periodYM, notes string) (*models.SupervisorPeriod, error) {
	periodYM = strings.TrimSpace(periodYM)
	if !validPeriodYM(periodYM) {
		return nil, errors.New("período inválido (YYYY-MM)")
	}
	var n int64
	if err := database.DB.Model(&models.SupervisorPeriod{}).Where("period_ym = ?", periodYM).Count(&n).Error; err != nil {
		return nil, err
	}
	if n > 0 {
		return nil, errors.New("ya existe ese período")
	}
	p := models.SupervisorPeriod{PeriodYM: periodYM, Status: models.SupervisorPeriodOpen, Notes: strings.TrimSpace(notes)}
	if err := database.DB.Create(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// BootstrapControlsForPeriod crea controles mensuales para empresas activas que aún no tienen control en el período.
func (s *SupervisorService) BootstrapControlsForPeriod(periodYM string, allowed []uint) (*SupervisorBootstrapResult, error) {
	periodYM = strings.TrimSpace(periodYM)
	if !validPeriodYM(periodYM) {
		return nil, errors.New("período inválido (YYYY-MM)")
	}
	var p models.SupervisorPeriod
	if err := database.DB.Where("period_ym = ?", periodYM).First(&p).Error; err != nil {
		return nil, errors.New("período no encontrado; créelo primero")
	}
	if p.Status == models.SupervisorPeriodClosed {
		return nil, errors.New("el período está cerrado")
	}

	q := database.DB.Model(&models.Company{}).Where("status = ?", "activo")
	if len(allowed) > 0 {
		q = q.Where("id IN ?", allowed)
	}
	var companies []models.Company
	if err := q.Order("business_name ASC").Find(&companies).Error; err != nil {
		return nil, err
	}

	due := periodDefaultDueDate(periodYM)
	res := &SupervisorBootstrapResult{}
	for _, co := range companies {
		var n int64
		if err := database.DB.Model(&models.SupervisorMonthlyControl{}).
			Where("company_id = ? AND period_ym = ?", co.ID, periodYM).Count(&n).Error; err != nil {
			return nil, err
		}
		if n > 0 {
			res.Skipped++
			continue
		}
		err := database.DB.Transaction(func(tx *gorm.DB) error {
			ctrl := models.SupervisorMonthlyControl{
				CompanyID:         co.ID,
				PeriodYM:          periodYM,
				ResponsibleUserID: co.AccountantUserID,
				SupervisorUserID:  co.SupervisorUserID,
				DueDate:           &due,
				GeneralStatus:     models.SupervisorControlPendiente,
				RiskLevel:         models.SupervisorRiskBajo,
			}
			if err := tx.Create(&ctrl).Error; err != nil {
				return err
			}
			return s.bootstrapControlChildren(tx, ctrl.ID)
		})
		if err != nil {
			return nil, err
		}
		res.Created++
	}
	return res, nil
}

func (s *SupervisorService) BootstrapControlsForPeriodID(periodID uint, allowed []uint) (*SupervisorBootstrapResult, error) {
	var p models.SupervisorPeriod
	if err := database.DB.First(&p, periodID).Error; err != nil {
		return nil, errors.New("período no encontrado")
	}
	return s.BootstrapControlsForPeriod(p.PeriodYM, allowed)
}

func (s *SupervisorService) UpdatePeriod(id uint, notes string) (*models.SupervisorPeriod, error) {
	var p models.SupervisorPeriod
	if err := database.DB.First(&p, id).Error; err != nil {
		return nil, err
	}
	if p.Status == models.SupervisorPeriodClosed {
		return nil, errors.New("el período está cerrado")
	}
	p.Notes = strings.TrimSpace(notes)
	if err := database.DB.Save(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *SupervisorService) DeletePeriod(id uint) error {
	var p models.SupervisorPeriod
	if err := database.DB.First(&p, id).Error; err != nil {
		return err
	}
	if p.Status == models.SupervisorPeriodClosed {
		return errors.New("no se puede eliminar un período cerrado")
	}
	var n int64
	if err := database.DB.Model(&models.SupervisorMonthlyControl{}).Where("period_ym = ?", p.PeriodYM).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return errors.New("hay controles mensuales en este período")
	}
	return database.DB.Delete(&p).Error
}

func (s *SupervisorService) ClosePeriod(id uint, userID uint) (*models.SupervisorPeriod, error) {
	var p models.SupervisorPeriod
	if err := database.DB.First(&p, id).Error; err != nil {
		return nil, err
	}
	if p.Status == models.SupervisorPeriodClosed {
		return nil, errors.New("el período ya está cerrado")
	}
	if err := s.validatePeriodCloseReady(p.PeriodYM); err != nil {
		return nil, err
	}
	var open int64
	if err := database.DB.Model(&models.SupervisorMonthlyControl{}).
		Where("period_ym = ? AND general_status NOT IN ?", p.PeriodYM, []string{models.SupervisorControlCerrado, models.SupervisorControlAlDia}).
		Count(&open).Error; err != nil {
		return nil, err
	}
	if open > 0 {
		return nil, errors.New("hay controles sin cerrar o al día; complete el cierre mensual")
	}
	now := time.Now()
	p.Status = models.SupervisorPeriodClosed
	p.ClosedAt = &now
	p.ClosedByUserID = &userID
	if err := database.DB.Save(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// ---- Controls ----

func (s *SupervisorService) ListControls(p SupervisorListParams) ([]models.SupervisorMonthlyControl, int64, error) {
	if p.PeriodYM != "" {
		_, _ = s.SyncOverdueControls(p.PeriodYM, p.AllowedCompanyIDs)
	}
	if p.Page <= 0 {
		p.Page = 1
	}
	if p.PerPage <= 0 {
		p.PerPage = 20
	}
	if p.PerPage > 200 {
		p.PerPage = 200
	}
	q := database.DB.Model(&models.SupervisorMonthlyControl{})
	if p.PeriodYM != "" {
		q = q.Where("period_ym = ?", p.PeriodYM)
	}
	if p.CompanyID > 0 {
		q = q.Where("company_id = ?", p.CompanyID)
	}
	if p.GeneralStatus != "" {
		q = q.Where("general_status = ?", p.GeneralStatus)
	}
	if p.RiskLevel != "" {
		q = q.Where("risk_level = ?", p.RiskLevel)
	}
	if p.ResponsibleUserID > 0 {
		q = q.Where("responsible_user_id = ?", p.ResponsibleUserID)
	}
	if p.SupervisorUserID > 0 {
		q = q.Where("supervisor_user_id = ?", p.SupervisorUserID)
	}
	if p.Q != "" {
		like := "%" + strings.TrimSpace(p.Q) + "%"
		q = q.Joins("JOIN companies ON companies.id = supervisor_monthly_controls.company_id").
			Where("companies.business_name LIKE ? OR companies.ruc LIKE ?", like, like)
	}
	q = s.applyCompanyScope(q, p.AllowedCompanyIDs)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []models.SupervisorMonthlyControl
	err := q.Preload("Company").Preload("Responsible").Preload("Supervisor").
		Order("supervisor_monthly_controls.id DESC").
		Limit(p.PerPage).Offset((p.Page - 1) * p.PerPage).
		Find(&rows).Error
	return rows, total, err
}

type SupervisorControlInput struct {
	CompanyID         uint
	PeriodYM          string
	TaxRegime         string
	ResponsibleUserID *uint
	SupervisorUserID  *uint
	DueDate           *time.Time
	GeneralStatus     string
	RiskLevel         string
	Observations      string
	InfoReceivedAt    *time.Time
}

func (s *SupervisorService) CreateControl(in SupervisorControlInput) (*models.SupervisorMonthlyControl, error) {
	in.PeriodYM = strings.TrimSpace(in.PeriodYM)
	if !validPeriodYM(in.PeriodYM) {
		return nil, errors.New("período inválido")
	}
	if in.CompanyID == 0 {
		return nil, errors.New("empresa requerida")
	}
	var n int64
	if err := database.DB.Model(&models.SupervisorMonthlyControl{}).
		Where("company_id = ? AND period_ym = ?", in.CompanyID, in.PeriodYM).Count(&n).Error; err != nil {
		return nil, err
	}
	if n > 0 {
		return nil, errors.New("ya existe control para esta empresa y período")
	}
	if in.GeneralStatus == "" {
		in.GeneralStatus = models.SupervisorControlPendiente
	}
	if in.RiskLevel == "" {
		in.RiskLevel = models.SupervisorRiskBajo
	}
	var created models.SupervisorMonthlyControl
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		ctrl := models.SupervisorMonthlyControl{
			CompanyID:         in.CompanyID,
			PeriodYM:          in.PeriodYM,
			TaxRegime:         strings.TrimSpace(in.TaxRegime),
			ResponsibleUserID: in.ResponsibleUserID,
			SupervisorUserID:  in.SupervisorUserID,
			DueDate:           in.DueDate,
			GeneralStatus:     in.GeneralStatus,
			RiskLevel:         in.RiskLevel,
			Observations:      strings.TrimSpace(in.Observations),
			InfoReceivedAt:    in.InfoReceivedAt,
		}
		if err := tx.Create(&ctrl).Error; err != nil {
			return err
		}
		if err := s.bootstrapControlChildren(tx, ctrl.ID); err != nil {
			return err
		}
		created = ctrl
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetControl(created.ID)
}

func (s *SupervisorService) GetControl(id uint) (*models.SupervisorMonthlyControl, error) {
	var ctrl models.SupervisorMonthlyControl
	err := database.DB.Preload("Company").Preload("Responsible").Preload("Supervisor").
		First(&ctrl, id).Error
	if err != nil {
		return nil, err
	}
	return &ctrl, nil
}

func (s *SupervisorService) RegisterInfoReceived(controlID uint) (*models.SupervisorMonthlyControl, error) {
	ctrl, err := s.GetControl(controlID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	ctrl.InfoReceivedAt = &now
	if ctrl.GeneralStatus == models.SupervisorControlPendiente {
		ctrl.GeneralStatus = models.SupervisorControlAlDia
	}
	if err := database.DB.Save(ctrl).Error; err != nil {
		return nil, err
	}
	return s.GetControl(controlID)
}

func (s *SupervisorService) UpdateControl(id uint, in SupervisorControlInput) (*models.SupervisorMonthlyControl, error) {
	ctrl, err := s.GetControl(id)
	if err != nil {
		return nil, err
	}
	ctrl.TaxRegime = strings.TrimSpace(in.TaxRegime)
	ctrl.ResponsibleUserID = in.ResponsibleUserID
	ctrl.SupervisorUserID = in.SupervisorUserID
	ctrl.DueDate = in.DueDate
	if in.GeneralStatus != "" {
		ctrl.GeneralStatus = in.GeneralStatus
	}
	if in.RiskLevel != "" {
		ctrl.RiskLevel = in.RiskLevel
	}
	ctrl.Observations = strings.TrimSpace(in.Observations)
	ctrl.InfoReceivedAt = in.InfoReceivedAt
	if err := database.DB.Save(ctrl).Error; err != nil {
		return nil, err
	}
	return s.GetControl(id)
}

func (s *SupervisorService) DeleteControl(id uint) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("monthly_control_id = ?", id).Delete(&models.SupervisorDeclaration{}).Error; err != nil {
			return err
		}
		if err := tx.Where("monthly_control_id = ?", id).Delete(&models.SupervisorTaxLiquidation{}).Error; err != nil {
			return err
		}
		if err := tx.Where("monthly_control_id = ?", id).Delete(&models.SupervisorNPS{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.SupervisorMonthlyControl{}, id).Error
	})
}

// ---- Declarations ----

func (s *SupervisorService) ListDeclarations(controlID uint) ([]models.SupervisorDeclaration, error) {
	var rows []models.SupervisorDeclaration
	err := database.DB.Where("monthly_control_id = ?", controlID).
		Preload("Responsible").Preload("Approver").
		Order("id ASC").Find(&rows).Error
	return rows, err
}

type SupervisorDeclarationInput struct {
	Status            string
	Notes             string
	ResponsibleUserID *uint
	ApproverUserID    *uint
	ProgressPct       *int
	Priority          string
	DueDate           *time.Time
}

func declarationProgressFromStatus(status string) int {
	switch status {
	case models.SupervisorDeclPendiente:
		return 0
	case models.SupervisorDeclEnElaboracion:
		return 35
	case models.SupervisorDeclEnRevision:
		return 65
	case models.SupervisorDeclObservado:
		return 40
	case models.SupervisorDeclAprobado:
		return 85
	case models.SupervisorDeclPresentado, models.SupervisorDeclCerrado:
		return 100
	default:
		return 0
	}
}

func (s *SupervisorService) UpdateDeclaration(id uint, in SupervisorDeclarationInput, userID uint) (*models.SupervisorDeclaration, error) {
	var d models.SupervisorDeclaration
	if err := database.DB.First(&d, id).Error; err != nil {
		return nil, err
	}
	oldStatus := d.Status
	if in.Status != "" && in.Status != oldStatus {
		if isDetraccionesDeclarationType(d.DeclarationType) {
			if err := s.validateDetraccionesStatusTransition(&d, oldStatus, in.Status, in.Notes); err != nil {
				return nil, err
			}
			d.Status = in.Status
			if in.ProgressPct == nil {
				d.ProgressPct = detraccionesProgressFromStatus(in.Status)
			}
		} else {
			d.Status = in.Status
			if in.ProgressPct == nil {
				d.ProgressPct = declarationProgressFromStatus(in.Status)
			}
		}
	} else if in.Status != "" {
		d.Status = in.Status
	}
	if in.Notes != "" {
		d.Notes = strings.TrimSpace(in.Notes)
	}
	if in.ResponsibleUserID != nil {
		if *in.ResponsibleUserID == 0 {
			d.ResponsibleUserID = nil
		} else {
			d.ResponsibleUserID = in.ResponsibleUserID
		}
	}
	if in.ApproverUserID != nil {
		if *in.ApproverUserID == 0 {
			d.ApproverUserID = nil
		} else {
			d.ApproverUserID = in.ApproverUserID
		}
	}
	if in.ProgressPct != nil {
		pct := *in.ProgressPct
		if pct < 0 {
			pct = 0
		}
		if pct > 100 {
			pct = 100
		}
		d.ProgressPct = pct
	}
	if in.Priority != "" {
		d.Priority = in.Priority
	}
	if in.DueDate != nil {
		d.DueDate = in.DueDate
	}
	if err := database.DB.Save(&d).Error; err != nil {
		return nil, err
	}
	if userID > 0 && in.Status != "" && in.Status != oldStatus {
		s.LogChange("declaration", id, "status", oldStatus, in.Status, userID)
	}
	if userID > 0 && in.ProgressPct != nil {
		s.LogChange("declaration", id, "progress_pct", fmt.Sprintf("%d", declarationProgressFromStatus(oldStatus)), fmt.Sprintf("%d", d.ProgressPct), userID)
	}
	return &d, nil
}

func (s *SupervisorService) ApproveDeclaration(id uint, approverID uint) (*models.SupervisorDeclaration, error) {
	pct := 85
	return s.UpdateDeclaration(id, SupervisorDeclarationInput{
		Status: models.SupervisorDeclAprobado, ApproverUserID: &approverID, ProgressPct: &pct,
	}, approverID)
}

func (s *SupervisorService) ObserveDeclaration(id uint, approverID uint, notes string) (*models.SupervisorDeclaration, error) {
	var d models.SupervisorDeclaration
	if err := database.DB.Select("declaration_type").First(&d, id).Error; err != nil {
		return nil, err
	}
	if isDetraccionesDeclarationType(d.DeclarationType) {
		return s.observeDetraccionesDeclaration(id, approverID, notes)
	}
	pct := 40
	updated, err := s.UpdateDeclaration(id, SupervisorDeclarationInput{
		Status: models.SupervisorDeclObservado, Notes: notes, ApproverUserID: &approverID, ProgressPct: &pct,
	}, approverID)
	if err != nil {
		return nil, err
	}
	_ = database.DB.Model(&models.SupervisorMonthlyControl{}).
		Where("id = ?", updated.MonthlyControlID).
		Update("general_status", models.SupervisorControlObservado).Error
	if strings.TrimSpace(notes) != "" {
		did := id
		_, _ = s.CreateObservation(updated.MonthlyControlID, did, approverID, notes)
	}
	return updated, nil
}

func (s *SupervisorService) DeleteDeclaration(id uint) error {
	return database.DB.Delete(&models.SupervisorDeclaration{}, id).Error
}

// ---- Liquidations ----

func (s *SupervisorService) GetLiquidationByControl(controlID uint) (*models.SupervisorTaxLiquidation, error) {
	var liq models.SupervisorTaxLiquidation
	err := database.DB.Where("monthly_control_id = ?", controlID).
		Preload("Responsible").Preload("Approver").First(&liq).Error
	if err != nil {
		return nil, err
	}
	return &liq, nil
}

type SupervisorLiquidationInput struct {
	IGV               float64
	RentaMensual      float64
	OtrosTributos     float64
	ResponsibleUserID *uint
	ApproverUserID    *uint
	ValidationStatus  string
	Notes             string
}

func (s *SupervisorService) recalcLiquidation(liq *models.SupervisorTaxLiquidation) {
	liq.TotalPagar = math.Round((liq.IGV+liq.RentaMensual+liq.OtrosTributos)*100) / 100
	now := time.Now()
	liq.CalculatedAt = &now
}

func (s *SupervisorService) UpdateLiquidation(controlID uint, in SupervisorLiquidationInput) (*models.SupervisorTaxLiquidation, error) {
	liq, err := s.GetLiquidationByControl(controlID)
	if err != nil {
		return nil, err
	}
	liq.IGV = in.IGV
	liq.RentaMensual = in.RentaMensual
	liq.OtrosTributos = in.OtrosTributos
	s.recalcLiquidation(liq)
	if in.ValidationStatus != "" {
		liq.ValidationStatus = in.ValidationStatus
	}
	liq.Notes = strings.TrimSpace(in.Notes)
	if in.ResponsibleUserID != nil {
		if *in.ResponsibleUserID == 0 {
			liq.ResponsibleUserID = nil
		} else {
			liq.ResponsibleUserID = in.ResponsibleUserID
		}
	}
	if in.ApproverUserID != nil {
		if *in.ApproverUserID == 0 {
			liq.ApproverUserID = nil
		} else {
			liq.ApproverUserID = in.ApproverUserID
		}
	}
	if err := database.DB.Save(liq).Error; err != nil {
		return nil, err
	}
	return liq, nil
}

func (s *SupervisorService) ApproveLiquidation(controlID uint, approverID uint) (*models.SupervisorTaxLiquidation, error) {
	liq, err := s.GetLiquidationByControl(controlID)
	if err != nil {
		return nil, err
	}
	liq.ValidationStatus = models.SupervisorLiqAprobada
	liq.ApproverUserID = &approverID
	if err := database.DB.Save(liq).Error; err != nil {
		return nil, err
	}
	return liq, nil
}

func (s *SupervisorService) ObserveLiquidation(controlID uint, approverID uint, notes string) (*models.SupervisorTaxLiquidation, error) {
	liq, err := s.GetLiquidationByControl(controlID)
	if err != nil {
		return nil, err
	}
	liq.ValidationStatus = models.SupervisorLiqObservada
	liq.ApproverUserID = &approverID
	if notes != "" {
		liq.Notes = strings.TrimSpace(notes)
	}
	if err := database.DB.Save(liq).Error; err != nil {
		return nil, err
	}
	_ = database.DB.Model(&models.SupervisorMonthlyControl{}).
		Where("id = ?", controlID).
		Update("general_status", models.SupervisorControlObservado).Error
	if strings.TrimSpace(notes) != "" {
		_, _ = s.CreateObservation(controlID, 0, approverID, notes)
	}
	return liq, nil
}

// ---- NPS ----

func (s *SupervisorService) ListNPS(controlID uint) ([]models.SupervisorNPS, error) {
	var rows []models.SupervisorNPS
	err := database.DB.Where("monthly_control_id = ?", controlID).Order("id DESC").Find(&rows).Error
	return rows, err
}

type SupervisorNPSInput struct {
	MonthlyControlID uint
	Tributo          string
	Importe          float64
	CodigoNPS        string
	PaymentDueDate   *time.Time
	PaymentStatus    string
	Notes            string
}

func (s *SupervisorService) CreateNPS(in SupervisorNPSInput) (*models.SupervisorNPS, error) {
	if in.MonthlyControlID == 0 {
		return nil, errors.New("control requerido")
	}
	if strings.TrimSpace(in.Tributo) == "" {
		return nil, errors.New("tributo requerido")
	}
	st := in.PaymentStatus
	if st == "" {
		st = models.SupervisorNPSPendienteGenerar
	}
	nps := models.SupervisorNPS{
		MonthlyControlID: in.MonthlyControlID,
		Tributo:          strings.TrimSpace(in.Tributo),
		Importe:          in.Importe,
		CodigoNPS:        strings.TrimSpace(in.CodigoNPS),
		PaymentDueDate:   in.PaymentDueDate,
		PaymentStatus:    st,
		Notes:            strings.TrimSpace(in.Notes),
	}
	if err := database.DB.Create(&nps).Error; err != nil {
		return nil, err
	}
	return &nps, nil
}

func (s *SupervisorService) UpdateNPS(id uint, in SupervisorNPSInput) (*models.SupervisorNPS, error) {
	var nps models.SupervisorNPS
	if err := database.DB.First(&nps, id).Error; err != nil {
		return nil, err
	}
	nps.Tributo = strings.TrimSpace(in.Tributo)
	nps.Importe = in.Importe
	nps.CodigoNPS = strings.TrimSpace(in.CodigoNPS)
	nps.PaymentDueDate = in.PaymentDueDate
	if in.PaymentStatus != "" {
		nps.PaymentStatus = in.PaymentStatus
	}
	nps.Notes = strings.TrimSpace(in.Notes)
	if err := database.DB.Save(&nps).Error; err != nil {
		return nil, err
	}
	return &nps, nil
}

func (s *SupervisorService) GenerateNPS(id uint) (*models.SupervisorNPS, error) {
	var nps models.SupervisorNPS
	if err := database.DB.First(&nps, id).Error; err != nil {
		return nil, err
	}
	now := time.Now()
	if nps.CodigoNPS == "" {
		nps.CodigoNPS = fmt.Sprintf("NPS-%d-%s", nps.MonthlyControlID, now.Format("20060102150405"))
	}
	nps.GeneratedAt = &now
	nps.PaymentStatus = models.SupervisorNPSGenerado
	if err := database.DB.Save(&nps).Error; err != nil {
		return nil, err
	}
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.First(&ctrl, nps.MonthlyControlID).Error; err == nil {
		uid := notifyUserIDForControl(&ctrl)
		cid := ctrl.ID
		s.notifyIfNew(uid, "nps_ready", "NPS generado",
			fmt.Sprintf("Código %s (%s) listo para gestión de pago", nps.CodigoNPS, strings.TrimSpace(nps.Tributo)),
			ctrl.PeriodYM, &cid)
	}
	return &nps, nil
}

// SyncOverdueNPS marca como vencidos los NPS con fecha límite pasada y aún no pagados.
func (s *SupervisorService) SyncOverdueNPS(periodYM string) (int64, error) {
	if !validPeriodYM(periodYM) {
		return 0, nil
	}
	today := time.Now()
	controlIDs := database.DB.Model(&models.SupervisorMonthlyControl{}).
		Select("id").Where("period_ym = ?", periodYM)
	res := database.DB.Model(&models.SupervisorNPS{}).
		Where("monthly_control_id IN (?)", controlIDs).
		Where("payment_due_date IS NOT NULL AND payment_due_date < ?", today).
		Where("payment_status IN ?", []string{
			models.SupervisorNPSPendientePago,
			models.SupervisorNPSEnviadoCliente,
			models.SupervisorNPSGenerado,
		}).
		Update("payment_status", models.SupervisorNPSVencido)
	return res.RowsAffected, res.Error
}

// EnsureMonthlyPeriodOpen crea el período del mes si no existe (automatización).
func (s *SupervisorService) EnsureMonthlyPeriodOpen(periodYM string) (*models.SupervisorPeriod, error) {
	periodYM = strings.TrimSpace(periodYM)
	if !validPeriodYM(periodYM) {
		return nil, errors.New("período inválido")
	}
	var p models.SupervisorPeriod
	err := database.DB.Where("period_ym = ?", periodYM).First(&p).Error
	if err == nil {
		return &p, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s.CreatePeriod(periodYM, "Período abierto automáticamente")
	}
	return nil, err
}

// RunMonthlyAutomations asegura período abierto, controles faltantes, vencidos y notificaciones.
func (s *SupervisorService) RunMonthlyAutomations(periodYM string) error {
	if !validPeriodYM(periodYM) {
		return nil
	}
	p, err := s.EnsureMonthlyPeriodOpen(periodYM)
	if err != nil {
		return err
	}
	if p.Status == models.SupervisorPeriodOpen {
		if _, err := s.BootstrapControlsForPeriod(periodYM, nil); err != nil {
			return err
		}
	}
	_, _ = s.SyncOverdueControls(periodYM, nil)
	_, _ = s.SyncOverdueNPS(periodYM)
	return s.RunAutomations(periodYM)
}

func notifyUserIDForControl(ctrl *models.SupervisorMonthlyControl) uint {
	if ctrl == nil {
		return 0
	}
	if ctrl.SupervisorUserID != nil && *ctrl.SupervisorUserID > 0 {
		return *ctrl.SupervisorUserID
	}
	if ctrl.ResponsibleUserID != nil && *ctrl.ResponsibleUserID > 0 {
		return *ctrl.ResponsibleUserID
	}
	return 0
}

func (s *SupervisorService) DeleteNPS(id uint) error {
	return database.DB.Delete(&models.SupervisorNPS{}, id).Error
}

// ---- Reports ----

type SupervisorReportRow struct {
	CompanyName      string  `json:"company_name"`
	CompanyRUC       string  `json:"company_ruc"`
	PeriodYM         string  `json:"period_ym"`
	GeneralStatus    string  `json:"general_status"`
	RiskLevel        string  `json:"risk_level"`
	CompliancePct    float64 `json:"compliance_pct"`
	TotalPagar       float64 `json:"total_pagar"`
	NPSPending       int64   `json:"nps_pending"`
	PaymentsPending  int64   `json:"payments_pending"`
	ControlID        uint    `json:"control_id,omitempty"`
}

type SupervisorReportListParams struct {
	PeriodYM          string
	Q                 string
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

func (s *SupervisorService) reportMonthlyQuery(p SupervisorReportListParams) *gorm.DB {
	npsPendingSQL := `(SELECT COUNT(*) FROM supervisor_nps sn WHERE sn.monthly_control_id = supervisor_monthly_controls.id AND sn.deleted_at IS NULL AND sn.payment_status IN ('pendiente_generar','generado','enviado_cliente'))`
	paymentsPendingSQL := `(SELECT COUNT(*) FROM supervisor_nps sn WHERE sn.monthly_control_id = supervisor_monthly_controls.id AND sn.deleted_at IS NULL AND sn.payment_status IN ('pendiente_pago','vencido'))`
	declAvgSQL := `(SELECT COALESCE(AVG(sd.progress_pct), 0) FROM supervisor_declarations sd WHERE sd.monthly_control_id = supervisor_monthly_controls.id AND sd.deleted_at IS NULL)`
	q := database.DB.Table("supervisor_monthly_controls").
		Select(`companies.business_name AS company_name, companies.ruc AS company_ruc,
			supervisor_monthly_controls.period_ym, supervisor_monthly_controls.general_status,
			supervisor_monthly_controls.risk_level,
			supervisor_monthly_controls.id AS control_id,
			`+declAvgSQL+` AS compliance_pct,
			COALESCE(supervisor_tax_liquidations.total_pagar, 0) AS total_pagar,
			`+npsPendingSQL+` AS nps_pending,
			`+paymentsPendingSQL+` AS payments_pending`).
		Joins("JOIN companies ON companies.id = supervisor_monthly_controls.company_id").
		Joins("LEFT JOIN supervisor_tax_liquidations ON supervisor_tax_liquidations.monthly_control_id = supervisor_monthly_controls.id").
		Where("supervisor_monthly_controls.period_ym = ?", p.PeriodYM)
	q = s.applyCompanyScope(q, p.AllowedCompanyIDs)
	if strings.TrimSpace(p.Q) != "" {
		like := "%" + strings.TrimSpace(p.Q) + "%"
		q = q.Where("companies.business_name LIKE ? OR companies.ruc LIKE ?", like, like)
	}
	return q
}

func (s *SupervisorService) ReportMonthly(p SupervisorReportListParams) ([]SupervisorReportRow, int64, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, 0, errors.New("período inválido (YYYY-MM)")
	}
	if p.Page <= 0 {
		p.Page = 1
	}
	if p.PerPage <= 0 {
		p.PerPage = 20
	}
	if p.PerPage > 500 {
		p.PerPage = 500
	}
	base := s.reportMonthlyQuery(p)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []SupervisorReportRow
	err := base.Order("companies.business_name ASC").
		Limit(p.PerPage).Offset((p.Page - 1) * p.PerPage).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	applyComplianceToReportRows(rows)
	return rows, total, nil
}

func applyComplianceToReportRows(rows []SupervisorReportRow) {
	for i := range rows {
		if rows[i].CompliancePct <= 0 {
			rows[i].CompliancePct = compliancePctFromControlStatus(rows[i].GeneralStatus)
		} else {
			rows[i].CompliancePct = math.Round(rows[i].CompliancePct*10) / 10
		}
	}
}

func compliancePctFromControlStatus(st string) float64 {
	switch st {
	case models.SupervisorControlAlDia, models.SupervisorControlCerrado:
		return 100
	case models.SupervisorControlPendiente:
		return 55
	case models.SupervisorControlObservado:
		return 35
	case models.SupervisorControlVencido:
		return 15
	default:
		return 0
	}
}

func (s *SupervisorService) ReportList(kind string, p SupervisorReportListParams) ([]SupervisorReportRow, int64, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, 0, errors.New("período inválido (YYYY-MM)")
	}
	if p.Page <= 0 {
		p.Page = 1
	}
	if p.PerPage <= 0 {
		p.PerPage = 20
	}
	if p.PerPage > 500 {
		p.PerPage = 500
	}
	base := s.reportMonthlyQuery(p)
	switch kind {
	case "monthly", "":
	case "overdue":
		base = base.Where("supervisor_monthly_controls.general_status = ?", models.SupervisorControlVencido)
	case "pending_declarations":
		base = base.Where(`EXISTS (
			SELECT 1 FROM supervisor_declarations sd
			WHERE sd.monthly_control_id = supervisor_monthly_controls.id
			AND sd.deleted_at IS NULL
			AND sd.status IN ?)`, []string{
			models.SupervisorDeclPendiente, models.SupervisorDeclEnElaboracion, models.SupervisorDeclEnRevision,
		})
	case "nps_pending":
		base = base.Where(`EXISTS (
			SELECT 1 FROM supervisor_nps sn
			WHERE sn.monthly_control_id = supervisor_monthly_controls.id
			AND sn.deleted_at IS NULL
			AND sn.payment_status IN ?)`, []string{
			models.SupervisorNPSPendienteGenerar, models.SupervisorNPSGenerado, models.SupervisorNPSEnviadoCliente,
		})
	case "payments_pending":
		base = base.Where(`EXISTS (
			SELECT 1 FROM supervisor_nps sn
			WHERE sn.monthly_control_id = supervisor_monthly_controls.id
			AND sn.deleted_at IS NULL
			AND sn.payment_status IN ?)`, []string{
			models.SupervisorNPSPendientePago, models.SupervisorNPSVencido,
		})
	default:
		return nil, 0, errors.New("tipo de reporte inválido")
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []SupervisorReportRow
	err := base.Order("companies.business_name ASC").Limit(p.PerPage).Offset((p.Page - 1) * p.PerPage).Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	applyComplianceToReportRows(rows)
	return rows, total, nil
}

func (s *SupervisorService) ReportProductivity(periodYM string, allowed []uint) ([]SupervisorProductivityRow, error) {
	if !validPeriodYM(periodYM) {
		return nil, errors.New("período inválido")
	}
	type agg struct {
		UserID uint
		Total  int64
		AlDia  int64
	}
	var raw []agg
	q := database.DB.Table("supervisor_monthly_controls").
		Select(`responsible_user_id AS user_id, COUNT(*) AS total,
			SUM(CASE WHEN general_status = ? THEN 1 ELSE 0 END) AS al_dia`, models.SupervisorControlAlDia).
		Where("period_ym = ? AND responsible_user_id IS NOT NULL", periodYM)
	q = s.applyCompanyScope(q, allowed)
	if err := q.Group("responsible_user_id").Scan(&raw).Error; err != nil {
		return nil, err
	}
	out := make([]SupervisorProductivityRow, 0, len(raw))
	for _, r := range raw {
		var u models.User
		_ = database.DB.Select("id", "name", "username").First(&u, r.UserID).Error
		name := u.Name
		if name == "" {
			name = u.Username
		}
		pct := float64(0)
		if r.Total > 0 {
			pct = math.Round((float64(r.AlDia)/float64(r.Total))*1000) / 10
		}
		out = append(out, SupervisorProductivityRow{
			UserID: r.UserID, UserName: name, Total: r.Total, AlDia: r.AlDia, CompliancePct: pct,
		})
	}
	return out, nil
}

func (s *SupervisorService) ReportObservationsHistory(p SupervisorReportListParams) ([]SupervisorObservationReportRow, int64, error) {
	if p.Page <= 0 {
		p.Page = 1
	}
	if p.PerPage <= 0 {
		p.PerPage = 20
	}
	q := database.DB.Table("supervisor_observations").
		Select(`supervisor_observations.id, supervisor_observations.body, supervisor_observations.created_at,
			supervisor_observations.monthly_control_id,
			companies.business_name AS company_name, companies.ruc AS company_ruc,
			supervisor_monthly_controls.period_ym,
			COALESCE(users.name, users.username) AS author_name`).
		Joins("LEFT JOIN supervisor_monthly_controls ON supervisor_monthly_controls.id = supervisor_observations.monthly_control_id").
		Joins("LEFT JOIN companies ON companies.id = supervisor_monthly_controls.company_id").
		Joins("LEFT JOIN users ON users.id = supervisor_observations.user_id").
		Where("supervisor_monthly_controls.period_ym = ?", p.PeriodYM)
	if strings.TrimSpace(p.Q) != "" {
		like := "%" + strings.TrimSpace(p.Q) + "%"
		q = q.Where("companies.business_name LIKE ? OR companies.ruc LIKE ? OR supervisor_observations.body LIKE ?", like, like, like)
	}
	q = s.applyCompanyScope(q, p.AllowedCompanyIDs)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []SupervisorObservationReportRow
	err := q.Order("supervisor_observations.id DESC").Limit(p.PerPage).Offset((p.Page - 1) * p.PerPage).Scan(&rows).Error
	return rows, total, err
}
