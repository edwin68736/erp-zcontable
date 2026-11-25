package services

// «No corresponde»: una empresa que no realiza una actividad se marca en cada periodo y deja de evaluarse en esa actividad
// (cuenta como «no aplica», igual que una suspendida pero solo en esa actividad). No es un estado nuevo: es el mismo
// «no_corresponde» de Estado cta. detracciones puesto en el registro mensual de cada actividad; en PDT 601 es «sin planilla».
//
// La marca vale para su periodo. Al abrir el siguiente, el módulo pregunta qué empresas la mantienen (arrastre).

import (
	"errors"
	"sort"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var notApplicableActivityKeys = map[string]bool{
	models.SupervisorDeclPDT601:              true,
	models.SupervisorDeclPDT621:              true,
	models.SupervisorDeclDetracciones:        true,
	models.SupervisorDeclSunatInbox:          true,
	models.SupervisorDeclInformeDetracciones: true,
	models.SupervisorDeclSiscontBalances:     true,
	models.SupervisorDeclPreliminarVentas:    true,
}

var errNotApplicableLocked = errors.New("esta empresa está marcada como «No corresponde» en este periodo; quite la marca para registrar")

// IsNotApplicableActivity la actividad admite «No corresponde».
func IsNotApplicableActivity(activity string) bool { return notApplicableActivityKeys[activity] }

// NotApplicablePeriodEnabled Estado cta. detracciones solo admite registros de periodos ya terminados (su propia regla); las
// demás actividades se pueden marcar en cualquier periodo abierto (Buzón SOL y Preliminar se trabajan en el mes en curso).
func NotApplicablePeriodEnabled(activity, periodYM string) bool {
	if activity == models.SupervisorDeclDetracciones {
		return ActivityPeriodEnabled(periodYM)
	}
	return validPeriodYM(periodYM)
}

func notApplicableDeclTypes(activity string) []string {
	if activity == models.SupervisorDeclDetracciones {
		return detraccionesDeclarationTypes()
	}
	return []string{activity}
}

// notApplicableCompanies empresas marcadas en la actividad en el periodo (companyIDs nil = todas).
func notApplicableCompanies(periodYM, activity string, companyIDs []uint) map[uint]bool {
	out := map[uint]bool{}
	if companyIDs != nil && len(companyIDs) == 0 {
		return out
	}
	q := database.DB.Table("supervisor_monthly_controls AS c").
		Where("c.period_ym = ? AND c.deleted_at IS NULL", periodYM)
	if activity == models.SupervisorDeclPDT601 {
		q = q.Joins("INNER JOIN supervisor_pdt601_planillas p ON p.monthly_control_id = c.id AND p.deleted_at IS NULL AND p.sin_planilla = ?", true)
	} else {
		q = q.Joins("INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type IN ? AND d.status = ? AND d.deleted_at IS NULL",
			notApplicableDeclTypes(activity), models.SupervisorDetraccionNoCorresponde)
	}
	if companyIDs != nil {
		q = q.Where("c.company_id IN ?", companyIDs)
	}
	var ids []uint
	_ = q.Pluck("c.company_id", &ids).Error
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// declarationNotApplicable el control tiene la actividad marcada «No corresponde».
func declarationNotApplicable(controlID uint, activity string) bool {
	var n int64
	_ = database.DB.Model(&models.SupervisorDeclaration{}).
		Where("monthly_control_id = ? AND declaration_type IN ? AND status = ?", controlID, notApplicableDeclTypes(activity), models.SupervisorDetraccionNoCorresponde).
		Count(&n).Error
	return n > 0
}

// DeclarationIsNotApplicable la declaración está marcada «No corresponde» (para bloquear cargas de archivos).
func (s *SupervisorService) DeclarationIsNotApplicable(declarationID uint) bool {
	var d models.SupervisorDeclaration
	if err := database.DB.Select("status").First(&d, declarationID).Error; err != nil {
		return false
	}
	return d.Status == models.SupervisorDetraccionNoCorresponde
}

func (s *SupervisorService) notApplicableTarget(activity string, companyID uint, periodYM string) (*models.SupervisorMonthlyControl, *models.SupervisorDeclaration, error) {
	var company models.Company
	if err := database.DB.First(&company, companyID).Error; err != nil {
		return nil, nil, errors.New("empresa no encontrada")
	}
	if company.ClientType != models.CompanyClientTypeEstudio || company.Status != "activo" {
		return nil, nil, errors.New("empresa no disponible")
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
		if err := tx.Where("monthly_control_id = ? AND declaration_type IN ?", ctrl.ID, notApplicableDeclTypes(activity)).
			First(&decl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			decl = models.SupervisorDeclaration{
				MonthlyControlID: ctrl.ID,
				DeclarationType:  activity,
				Status:           models.SupervisorDeclPendiente,
				Priority:         models.SupervisorPriorityMedia,
			}
			return tx.Create(&decl).Error
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return &ctrl, &decl, nil
}

// notApplicableBlockReason por qué la actividad ya no se puede marcar en este periodo ("" = se puede): lo ya entregado no se
// puede sacar de la evaluación.
func notApplicableBlockReason(activity string, controlID uint, decl *models.SupervisorDeclaration) string {
	status := models.SupervisorDeclPendiente
	var declID uint
	if decl != nil {
		declID = decl.ID
		if decl.Status != "" {
			status = decl.Status
		}
	}
	count := func(model any, query string, args ...any) int64 {
		var n int64
		_ = database.DB.Model(model).Where(query, args...).Count(&n).Error
		return n
	}
	switch activity {
	case models.SupervisorDeclPDT601:
		if status != models.SupervisorDeclPendiente {
			return "ya tiene la planilla entregada"
		}
		// Find y no First: lo normal es que todavía no haya planilla y no debe quedar como «record not found» en el registro.
		var found []models.SupervisorPdt601Planilla
		if err := database.DB.Where("monthly_control_id = ?", controlID).Limit(1).Find(&found).Error; err == nil && len(found) > 0 {
			p := found[0]
			money := p.Essalud + p.Onp + p.Afp + p.Sis + p.Rta4ta + p.Rta5ta + p.Sctr + p.Rh
			if p.FechaEntrega != nil || p.FechaDeclaracionPdt != nil || p.TrabajadoresONP+p.TrabajadoresAFP > 0 || money > 0 {
				return "ya tiene datos de planilla registrados"
			}
		}
	case models.SupervisorDeclPDT621:
		if status != models.SupervisorDeclPendiente {
			return "ya tiene el archivador entregado"
		}
		if count(&models.SupervisorPdt621Record{}, "monthly_control_id = ? AND (primera_entrega_fecha IS NOT NULL OR fecha_declaracion IS NOT NULL)", controlID) > 0 {
			return "ya tiene entrega o declaración registrada"
		}
	case models.SupervisorDeclDetracciones:
		if status != models.SupervisorDeclPendiente && status != models.SupervisorDetraccionCargado {
			return "ya tiene el estado de cuenta cerrado"
		}
	case models.SupervisorDeclSunatInbox:
		if count(&models.SupervisorMailboxCaptureSlot{}, "monthly_control_id = ? AND (sunat_uploaded_at IS NOT NULL OR sunafil_uploaded_at IS NOT NULL)", controlID) > 0 {
			return "ya tiene capturas subidas en este periodo"
		}
	case models.SupervisorDeclPreliminarVentas:
		if count(&models.SupervisorPreliminarVentasRecord{}, "monthly_control_id = ? AND status IN ?", controlID,
			[]string{models.PreliminarVentasRegistrado, models.PreliminarVentasEnviado}) > 0 {
			return "ya tiene entregas registradas"
		}
	default: // informes en PDF
		if status != models.SupervisorDeclPendiente || (declID > 0 && count(&models.SupervisorAttachment{}, "declaration_id = ?", declID) > 0) {
			return "ya tiene un archivo entregado"
		}
	}
	return ""
}

// SetNotApplicable marca (o quita la marca) «No corresponde» de una actividad para una empresa en un periodo.
func (s *SupervisorService) SetNotApplicable(activity string, companyID uint, periodYM string, notApplicable bool, userID uint) error {
	if !IsNotApplicableActivity(activity) {
		return errors.New("actividad no válida")
	}
	if err := s.validateOpenPeriod(periodYM); err != nil {
		return err
	}
	ctrl, decl, err := s.notApplicableTarget(activity, companyID, periodYM)
	if err != nil {
		return err
	}
	if ctrl.Suspendida {
		return errors.New("esta empresa está suspendida en este periodo; no se puede editar")
	}
	if activity == models.SupervisorDeclPDT601 {
		err = s.setSinPlanilla(companyID, periodYM, ctrl.ID, decl, notApplicable, userID)
	} else {
		err = s.setDeclarationNotApplicable(activity, ctrl.ID, decl, notApplicable, userID)
	}
	if err != nil {
		return err
	}
	if !notApplicable {
		// Quitar la marca es una decisión: el arrastre no vuelve a proponer la empresa en este periodo.
		return saveNotApplicableReview(periodYM, activity, companyID, false, userID)
	}
	return nil
}

func (s *SupervisorService) setDeclarationNotApplicable(activity string, controlID uint, decl *models.SupervisorDeclaration, mark bool, userID uint) error {
	old := decl.Status
	next := models.SupervisorDetraccionNoCorresponde
	progress := 100
	if mark {
		if old == models.SupervisorDetraccionNoCorresponde {
			return nil
		}
		if reason := notApplicableBlockReason(activity, controlID, decl); reason != "" {
			return errors.New("no se puede marcar «No corresponde»: " + reason)
		}
	} else {
		// En Estado cta. detracciones el mismo botón quita también «Sin clave».
		marked := old == models.SupervisorDetraccionNoCorresponde ||
			(activity == models.SupervisorDeclDetracciones && old == models.SupervisorDetraccionSinClave)
		if !marked {
			return nil
		}
		next, progress = models.SupervisorDeclPendiente, 0
		if activity == models.SupervisorDeclDetracciones {
			if n, err := countDeclarationAttachments(decl.ID); err != nil {
				return err
			} else if n > 0 {
				next = models.SupervisorDetraccionCargado
				progress = detraccionesProgressFromStatus(next)
			}
		}
	}
	if err := database.DB.Model(&models.SupervisorDeclaration{}).Where("id = ?", decl.ID).
		Updates(map[string]any{"status": next, "progress_pct": progress}).Error; err != nil {
		return err
	}
	s.LogChange("declaration", decl.ID, "status", old, next, userID)
	decl.Status = next
	return nil
}

// setSinPlanilla en PDT 601 la marca es «sin planilla» (la misma casilla del detalle).
func (s *SupervisorService) setSinPlanilla(companyID uint, periodYM string, controlID uint, decl *models.SupervisorDeclaration, mark bool, userID uint) error {
	var p models.SupervisorPdt601Planilla
	if err := database.DB.Where("monthly_control_id = ?", controlID).First(&p).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		p = models.SupervisorPdt601Planilla{MonthlyControlID: controlID}
	}
	if p.SinPlanilla == mark {
		return nil
	}
	if decl.Status == models.SupervisorDeclEntregado {
		return errors.New("esta declaración ya fue entregada; no se puede editar (use Reabrir si corresponde)")
	}
	if mark {
		if reason := notApplicableBlockReason(models.SupervisorDeclPDT601, controlID, decl); reason != "" {
			return errors.New("no se puede marcar «Sin planilla»: " + reason)
		}
		if p.RegimenLaboral == "" {
			p.RegimenLaboral = previousRegimenLaboral(companyID, periodYM)
		}
	}
	p.SinPlanilla = mark
	if err := database.DB.Save(&p).Error; err != nil {
		return err
	}
	s.LogChange("declaration", decl.ID, "sin_planilla", siNo(!mark), siNo(mark), userID)
	return nil
}

func siNo(v bool) string {
	if v {
		return "sí"
	}
	return "no"
}

func previousRegimenLaboral(companyID uint, periodYM string) string {
	var regimen string
	_ = database.DB.Table("supervisor_pdt601_planillas AS p").
		Select("p.regimen_laboral").
		Joins("INNER JOIN supervisor_monthly_controls c ON c.id = p.monthly_control_id AND c.deleted_at IS NULL").
		Where("c.company_id = ? AND c.period_ym < ? AND p.deleted_at IS NULL AND p.regimen_laboral <> ''", companyID, periodYM).
		Order("c.period_ym DESC").Limit(1).
		Scan(&regimen).Error
	return regimen
}

func saveNotApplicableReview(periodYM, activity string, companyID uint, kept bool, userID uint) error {
	row := models.SupervisorNotApplicableReview{PeriodYM: periodYM, Activity: activity, CompanyID: companyID, Kept: kept, UserID: userID}
	return database.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "period_ym"}, {Name: "activity"}, {Name: "company_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"kept", "user_id"}),
	}).Create(&row).Error
}

// NotApplicableCarryOver empresas marcadas en el periodo anterior que todavía no se revisaron en este.
type NotApplicableCarryOver struct {
	Pending          bool                     `json:"pending"`
	PreviousPeriodYM string                   `json:"previous_period_ym"`
	Companies        []SuspensionCarryOverRow `json:"companies"`
}

// notApplicableNow hora actual; variable para fijarla en los tests.
var notApplicableNow = time.Now

// GetNotApplicableCarryOver propone mantener la marca del periodo anterior. Solo se pregunta por el mes en curso y el anterior
// (los periodos viejos que alguien abre para consultar no se tocan). Quedan fuera las empresas ya marcadas, suspendidas,
// ya revisadas o que en este periodo ya tienen algo entregado.
func (s *SupervisorService) GetNotApplicableCarryOver(activity, periodYM string, allowedCompanyIDs []uint) (*NotApplicableCarryOver, error) {
	empty := &NotApplicableCarryOver{Companies: []SuspensionCarryOverRow{}}
	if !IsNotApplicableActivity(activity) {
		return nil, errors.New("actividad no válida")
	}
	if !validPeriodYM(periodYM) {
		return nil, errors.New("período inválido (use YYYY-MM)")
	}
	now := notApplicableNow()
	oldest := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local).AddDate(0, -1, 0).Format("2006-01")
	if periodYM < oldest || s.validateOpenPeriod(periodYM) != nil {
		return empty, nil
	}
	prevYM, ok := previousPeriodYM(periodYM)
	if !ok {
		return empty, nil
	}
	empty.PreviousPeriodYM = prevYM
	if allowedCompanyIDs != nil && len(allowedCompanyIDs) == 0 {
		return empty, nil
	}
	marked := notApplicableCompanies(prevYM, activity, allowedCompanyIDs)
	if len(marked) == 0 {
		return empty, nil
	}
	ids := make([]uint, 0, len(marked))
	for id := range marked {
		ids = append(ids, id)
	}

	done := notApplicableCompanies(periodYM, activity, ids)
	var reviewed []uint
	if err := database.DB.Model(&models.SupervisorNotApplicableReview{}).
		Where("period_ym = ? AND activity = ? AND company_id IN ?", periodYM, activity, ids).
		Pluck("company_id", &reviewed).Error; err != nil {
		return nil, err
	}
	for _, id := range reviewed {
		done[id] = true
	}

	var ctrls []models.SupervisorMonthlyControl
	if err := database.DB.Where("company_id IN ? AND period_ym = ?", ids, periodYM).Find(&ctrls).Error; err != nil {
		return nil, err
	}
	for i := range ctrls {
		c := &ctrls[i]
		if done[c.CompanyID] {
			continue
		}
		if c.Suspendida {
			done[c.CompanyID] = true
			continue
		}
		var decl *models.SupervisorDeclaration
		var found []models.SupervisorDeclaration
		_ = database.DB.Where("monthly_control_id = ? AND declaration_type IN ?", c.ID, notApplicableDeclTypes(activity)).Limit(1).Find(&found).Error
		if len(found) > 0 {
			decl = &found[0]
		}
		// «Sin clave» ya es una decisión tomada sobre el estado de cuenta de este periodo.
		if notApplicableBlockReason(activity, c.ID, decl) != "" {
			done[c.CompanyID] = true
		}
	}

	candidates := make([]uint, 0, len(ids))
	for _, id := range ids {
		if !done[id] {
			candidates = append(candidates, id)
		}
	}
	if len(candidates) == 0 {
		return empty, nil
	}
	var rows []SuspensionCarryOverRow
	if err := database.DB.Table("companies").
		Select(`companies.id AS company_id, companies.internal_code AS code, companies.business_name,
			companies.ruc, COALESCE(cred.dig, '') AS dig`).
		Joins("LEFT JOIN company_access_credentials cred ON cred.company_id = companies.id").
		Where("companies.id IN ? AND companies.client_type = ? AND companies.status = ? AND companies.deleted_at IS NULL",
			candidates, models.CompanyClientTypeEstudio, "activo").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].Code = strings.TrimSpace(rows[i].Code)
		rows[i].BusinessName = strings.TrimSpace(rows[i].BusinessName)
		rows[i].RUC = strings.TrimSpace(rows[i].RUC)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Code < rows[j].Code })
	if rows == nil {
		rows = []SuspensionCarryOverRow{}
	}
	return &NotApplicableCarryOver{Pending: len(rows) > 0, PreviousPeriodYM: prevYM, Companies: rows}, nil
}

// NotApplicableCarryOverResult cuántas se marcaron y cuáles no se pudieron.
type NotApplicableCarryOverResult struct {
	Applied int      `json:"applied"`
	Skipped []string `json:"skipped"`
}

// ApplyNotApplicableCarryOver aplica la decisión: de las empresas mostradas (review), las de keep mantienen la marca y el
// resto no se vuelve a preguntar en este periodo. Solo se aceptan candidatas reales dentro del alcance del usuario.
func (s *SupervisorService) ApplyNotApplicableCarryOver(activity, periodYM string, keep, review []uint, allowedCompanyIDs []uint, userID uint) (*NotApplicableCarryOverResult, error) {
	status, err := s.GetNotApplicableCarryOver(activity, periodYM, allowedCompanyIDs)
	if err != nil {
		return nil, err
	}
	keepSet, reviewSet := idSet(keep), idSet(review)
	out := &NotApplicableCarryOverResult{Skipped: []string{}}
	for _, row := range status.Companies {
		id := row.CompanyID
		if !reviewSet[id] && !keepSet[id] {
			continue
		}
		if keepSet[id] {
			if err := s.SetNotApplicable(activity, id, periodYM, true, userID); err != nil {
				out.Skipped = append(out.Skipped, row.BusinessName+": "+err.Error())
				continue
			}
			out.Applied++
		}
		if err := saveNotApplicableReview(periodYM, activity, id, keepSet[id], userID); err != nil {
			return nil, err
		}
	}
	return out, nil
}
