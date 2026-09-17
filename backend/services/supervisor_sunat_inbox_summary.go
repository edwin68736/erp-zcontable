package services

import (
	"errors"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// SunatInboxDashboardSummary agrega Buzón SOL del período en las 5 categorías de §5.9.3 — **etapa 2**
// de §5.9.5/§5.9.6.5, no existía ninguna función de agregado para este módulo. A diferencia de PDT
// 601/PDT 621/Detracciones (1 veredicto por empresa/período), cada empresa aporta hasta 16 unidades
// (una por cada actividad de calendario real del período × SUNAT/SUNAFIL, §5.9.6.4 — típicamente 8
// actividades × 2 buzones) con el mismo peso que las demás, porque el % se calcula sobre unidades,
// no sobre empresas.
//
// Sin ninguna actividad sunat_inbox configurada en el calendario del período (retipeo pendiente,
// §5.9.6.5), devuelve un ComplianceSummary vacío — ni suma ni resta, no hay ninguna obligación real
// que evaluar todavía.
func (s *SupervisorService) SunatInboxDashboardSummary(p SupervisorDashboardParams) (ComplianceSummary, error) {
	if !validPeriodYM(p.PeriodYM) {
		return ComplianceSummary{}, errors.New("período inválido (use YYYY-MM)")
	}

	realSlots := sunatInboxRealSlotsForPeriod(p.PeriodYM)
	if len(realSlots) == 0 {
		return ComplianceSummary{}, nil
	}

	q := database.DB.Model(&models.Company{}).
		Where("client_type = ? AND status = ?", models.CompanyClientTypeEstudio, "activo")
	if p.AllowedCompanyIDs != nil {
		if len(p.AllowedCompanyIDs) == 0 {
			return ComplianceSummary{}, nil
		}
		q = q.Where("id IN ?", p.AllowedCompanyIDs)
	}
	if p.CompanyID > 0 {
		q = q.Where("id = ?", p.CompanyID)
	}
	if p.GeneralStatus != "" || p.RiskLevel != "" || p.ResponsibleUserID > 0 || p.SupervisorUserID > 0 {
		sub := database.DB.Model(&models.SupervisorMonthlyControl{}).Select("company_id").Where("period_ym = ?", p.PeriodYM)
		if p.GeneralStatus != "" {
			sub = sub.Where("general_status = ?", p.GeneralStatus)
		}
		if p.RiskLevel != "" {
			sub = sub.Where("risk_level = ?", p.RiskLevel)
		}
		if p.ResponsibleUserID > 0 {
			sub = sub.Where("responsible_user_id = ?", p.ResponsibleUserID)
		}
		if p.SupervisorUserID > 0 {
			sub = sub.Where("supervisor_user_id = ?", p.SupervisorUserID)
		}
		q = q.Where("id IN (?)", sub)
	}

	var companyIDs []uint
	if err := q.Pluck("id", &companyIDs).Error; err != nil {
		return ComplianceSummary{}, err
	}
	if len(companyIDs) == 0 {
		return ComplianceSummary{}, nil
	}

	// Suspendida es global por control desde §5.9.7 — se lee para todas las empresas del alcance,
	// tengan o no control todavía (lazy create en los otros módulos).
	type ctrlRow struct {
		CompanyID  uint
		ControlID  uint
		Suspendida bool
	}
	var ctrls []ctrlRow
	_ = database.DB.Table("supervisor_monthly_controls").
		Select("company_id, id AS control_id, suspendida").
		Where("company_id IN ? AND period_ym = ? AND deleted_at IS NULL", companyIDs, p.PeriodYM).
		Scan(&ctrls).Error
	ctrlByCompany := make(map[uint]ctrlRow, len(ctrls))
	controlIDs := make([]uint, 0, len(ctrls))
	for _, c := range ctrls {
		ctrlByCompany[c.CompanyID] = c
		controlIDs = append(controlIDs, c.ControlID)
	}

	type slotKey struct {
		controlID uint
		weekStart string
		slotIndex int
	}
	slotByKey := map[slotKey]*models.SupervisorMailboxCaptureSlot{}
	if len(controlIDs) > 0 {
		var dbSlots []models.SupervisorMailboxCaptureSlot
		_ = database.DB.Where("monthly_control_id IN ?", controlIDs).Find(&dbSlots).Error
		for i := range dbSlots {
			sl := &dbSlots[i]
			slotByKey[slotKey{sl.MonthlyControlID, formatWeekStart(sl.WeekStart), sl.SlotIndex}] = sl
		}
	}

	// Las reglas se precargan UNA vez por id distinto (normalmente 1 sola — las 8 actividades reales
	// del mes comparten la misma "CONTROL DE HORA") en vez de una consulta por cada una de las hasta
	// ~16 unidades × empresa que evalúa el loop de abajo — con 328 empresas × 16 unidades,
	// ComputeActivityRuleTimeliness (que hace su propio LoadActiveActivityRule por llamada, sin
	// cache) generaba más de 5000 consultas individuales dentro de un solo request y hacía fallar el
	// dashboard en la práctica (§5.9.4, confirmado con datos reales: el costo NO era aceptable).
	ruleByID := map[uint]*models.ActivityRule{}
	for _, rs := range realSlots {
		if rs.ruleID == nil {
			continue
		}
		if _, ok := ruleByID[*rs.ruleID]; ok {
			continue
		}
		rule, _ := LoadActiveActivityRule(rs.ruleID)
		ruleByID[*rs.ruleID] = rule
	}

	var cs ComplianceSummary
	for _, cid := range companyIDs {
		ctrl, hasCtrl := ctrlByCompany[cid]
		exempt := hasCtrl && ctrl.Suspendida
		for _, rs := range realSlots {
			var dbSlot *models.SupervisorMailboxCaptureSlot
			if hasCtrl {
				dbSlot = slotByKey[slotKey{ctrl.ControlID, formatWeekStart(rs.weekStart), rs.slotIndex}]
			}
			var sunatUploaded, sunafilUploaded *time.Time
			if dbSlot != nil {
				sunatUploaded = dbSlot.SunatUploadedAt
				sunafilUploaded = dbSlot.SunafilUploadedAt
			}
			var rule *models.ActivityRule
			if rs.ruleID != nil {
				rule = ruleByID[*rs.ruleID]
			}
			cs.addTimeliness(sunatInboxSlotTimeliness(rs.dueDate, rule, sunatUploaded, exempt))
			cs.addTimeliness(sunatInboxSlotTimeliness(rs.dueDate, rule, sunafilUploaded, exempt))
		}
	}
	cs.finalize()
	return cs, nil
}

// sunatInboxSlotTimeliness misma lógica que ComputeActivityRuleTimeliness (calendar_activity_
// timeliness.go) pero recibe la regla ya cargada en vez de buscarla en BD — ver comentario arriba
// sobre por qué el agregado no puede darse el lujo de una consulta por unidad.
func sunatInboxSlotTimeliness(dueDate time.Time, rule *models.ActivityRule, uploadedAt *time.Time, exempt bool) string {
	hasRule := rule != nil
	var deadline time.Time
	compareMode := models.ActivityRuleCompareDate
	if hasRule {
		deadline = BuildUploadDeadline(dueDate, rule)
		compareMode = rule.CompareMode
	}
	return EvaluateUploadTimeliness(time.Now(), uploadedAt, deadline, hasRule, exempt, compareMode)
}
