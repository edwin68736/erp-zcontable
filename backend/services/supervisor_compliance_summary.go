package services

import (
	"errors"
	"math"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// ComplianceSummary "Cumplimiento %" en vivo — docs/diseno-limpieza-control-detail-2026-09-16.md
// §5.9. Reemplaza el criterio antiguo basado en SupervisorMonthlyControl.general_status (campo
// manual, 0% de uso real, §5.5) por un cálculo agregado sobre los veredictos de puntualidad que
// cada módulo parametrizado ya calcula (UploadTimelinessDTO.Timeliness, upload_timeliness.go).
//
// Las 5 categorías (§5.9.3) coinciden 1 a 1 con on_time/late/missing/pending/exempt — "no_rule"
// (período sin calendario configurado) se pliega dentro de "Exempt" ("Exento o no aplica" en el
// donut, no hay categoría separada). CompliancePct = on_time / (on_time + late + missing); Pending
// y Exempt quedan fuera del denominador (§5.9.2 — no castigar por algo que todavía no vence, ni por
// algo que no aplica).
type ComplianceSummary struct {
	OnTime        int64   `json:"on_time"`
	Late          int64   `json:"late"`
	Missing       int64   `json:"missing"`
	Pending       int64   `json:"pending"`
	Exempt        int64   `json:"exempt"`
	Total         int64   `json:"total"`
	CompliancePct float64 `json:"compliance_pct"`
}

// addTimeliness suma un veredicto individual (Detracciones, fila por fila) a las 5 categorías.
func (cs *ComplianceSummary) addTimeliness(timeliness string) {
	switch timeliness {
	case TimelinessOnTime:
		cs.OnTime++
	case TimelinessLate:
		cs.Late++
	case TimelinessMissing:
		cs.Missing++
	case TimelinessPending:
		cs.Pending++
	default: // TimelinessExempt, TimelinessNoRule
		cs.Exempt++
	}
	cs.Total++
}

// addSummary combina el resumen de otro módulo (PDT 601/621, Detracciones) al total agregado.
func (cs *ComplianceSummary) addSummary(other ComplianceSummary) {
	cs.OnTime += other.OnTime
	cs.Late += other.Late
	cs.Missing += other.Missing
	cs.Pending += other.Pending
	cs.Exempt += other.Exempt
	cs.Total += other.Total
}

func (cs *ComplianceSummary) finalize() {
	denom := cs.OnTime + cs.Late + cs.Missing
	if denom > 0 {
		cs.CompliancePct = math.Round((float64(cs.OnTime)/float64(denom))*1000) / 10
	}
}

// complianceSummaryFromPdt traduce los buckets de PdtTypeSummary (pdtBucketsSelectSQL) a las 5
// categorías de ComplianceSummary — mapeo exacto acordado en §5.9.3: entregado_a_tiempo→on_time,
// entregado_fuera_de_fecha→late, vencido→missing, pendiente→pending, (sin_planilla +
// control.Suspendida)→exempt.
func complianceSummaryFromPdt(t PdtTypeSummary) ComplianceSummary {
	cs := ComplianceSummary{
		OnTime:  t.EntregadoATiempo,
		Late:    t.EntregadoFueraDeFecha,
		Missing: t.Vencido,
		Pending: t.Pendiente,
		Exempt:  t.SinPlanilla + t.Suspendida,
	}
	cs.Total = cs.OnTime + cs.Late + cs.Missing + cs.Pending + cs.Exempt
	return cs
}

// DetraccionesDashboardSummary agrega Detracciones del período en las 5 categorías de §5.9.3 — no
// existía función de agregado para este módulo (§5.9.1/§5.9.5). A diferencia de PDT 601/621, el
// plazo de Detracciones se resuelve en Go (LoadActiveActivityRule), no en un CASE SQL, así que esto
// no se arma como una sola consulta agrupada: trae los datos de todas las empresas del período con
// pocas consultas (mismo patrón que ListDetracciones) y clasifica fila por fila con
// computeDetraccionesTimeliness — para las ~300 empresas del estudio es el mismo costo que ya paga
// hoy el listado de Detracciones, no agrega trabajo nuevo.
//
// A diferencia de ListDetracciones/EnsureDetracciones, esta función NO exige período abierto
// (validateOpenPeriod) — la usan ComplianceTrend y el ranking por supervisor, que necesitan poder
// calcular sobre períodos cerrados/pasados.
func (s *SupervisorService) DetraccionesDashboardSummary(p SupervisorDashboardParams) (ComplianceSummary, error) {
	if !validPeriodYM(p.PeriodYM) {
		return ComplianceSummary{}, errors.New("período inválido (use YYYY-MM)")
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

	types := detraccionesDeclarationTypes()
	type declRow struct {
		CompanyID     uint
		DeclarationID uint
		Status        string
	}
	var decls []declRow
	_ = database.DB.Table("supervisor_monthly_controls AS c").
		Select("c.company_id, d.id AS declaration_id, d.status").
		Joins("INNER JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type IN ? AND d.deleted_at IS NULL", types).
		Where("c.company_id IN ? AND c.period_ym = ? AND c.deleted_at IS NULL", companyIDs, p.PeriodYM).
		Scan(&decls).Error
	declByCompany := make(map[uint]declRow, len(decls))
	declIDs := make([]uint, 0, len(decls))
	for _, d := range decls {
		declByCompany[d.CompanyID] = d
		declIDs = append(declIDs, d.DeclarationID)
	}

	// Última carga por declaración — trae las filas del modelo (no un MAX(created_at) crudo: ese
	// alias no escanea de forma consistente entre motores/drivers, ver detraccionesLatestStoredAt
	// arriba, que usa el mismo criterio de "primera fila ordenada DESC") y se queda con la más
	// reciente por declaración en memoria.
	lastUploadByDecl := map[uint]*time.Time{}
	if len(declIDs) > 0 {
		var atts []models.SupervisorAttachment
		_ = database.DB.Where("declaration_id IN ?", declIDs).
			Order("created_at DESC").
			Find(&atts).Error
		for _, a := range atts {
			if a.DeclarationID == nil {
				continue
			}
			if _, ok := lastUploadByDecl[*a.DeclarationID]; ok {
				continue
			}
			t := a.CreatedAt
			lastUploadByDecl[*a.DeclarationID] = &t
		}
	}

	// Suspendida es global por control desde §5.9.7 — se lee para TODAS las empresas del alcance,
	// tengan o no declaración de detracciones creada todavía (lazy create).
	suspendidaByCompany := map[uint]bool{}
	type suspendidaRow struct {
		CompanyID  uint
		Suspendida bool
	}
	var suspRows []suspendidaRow
	_ = database.DB.Table("supervisor_monthly_controls").
		Select("company_id, suspendida").
		Where("company_id IN ? AND period_ym = ? AND deleted_at IS NULL", companyIDs, p.PeriodYM).
		Scan(&suspRows).Error
	for _, r := range suspRows {
		suspendidaByCompany[r.CompanyID] = r.Suspendida
	}

	deadlineCtx := findDetraccionesCalendarActivity(p.PeriodYM)

	var cs ComplianceSummary
	for _, cid := range companyIDs {
		status := models.SupervisorDeclPendiente
		var uploadedAt *time.Time
		if d, ok := declByCompany[cid]; ok {
			status = normalizeDetraccionesDisplayStatus(d.Status)
			uploadedAt = lastUploadByDecl[d.DeclarationID]
		}
		tl := computeDetraccionesTimeliness(p.PeriodYM, status, suspendidaByCompany[cid], uploadedAt, deadlineCtx)
		cs.addTimeliness(tl.Timeliness)
	}
	cs.finalize()
	return cs, nil
}

// MonthlyComplianceSummary combina PDT 601 + PDT 621 + Detracciones en un solo ComplianceSummary de
// 5 categorías — **etapa 1** de §5.9.5 (Buzón SOL queda para la etapa 2, §5.9.6.5: su unidad de
// conteo — 16 independientes por empresa/mes — todavía no tiene función de agregado ni el
// calendario correctamente configurado). Reemplaza el uso de general_status en
// Dashboard/ComplianceTrend/SupervisorComplianceRanking. El rótulo del dashboard debe decir
// explícitamente "Cumplimiento (PDT 601/621, Detracciones)" mientras siga en esta etapa 1 — no
// mencionar Buzón SOL todavía (§5.9.5).
func (s *SupervisorService) MonthlyComplianceSummary(p SupervisorDashboardParams) (ComplianceSummary, error) {
	if !validPeriodYM(p.PeriodYM) {
		return ComplianceSummary{}, errors.New("período inválido (use YYYY-MM)")
	}

	var cs ComplianceSummary

	pdt, err := s.PdtDashboardSummary(p)
	if err != nil {
		return ComplianceSummary{}, err
	}
	cs.addSummary(complianceSummaryFromPdt(pdt[models.SupervisorDeclPDT601]))
	cs.addSummary(complianceSummaryFromPdt(pdt[models.SupervisorDeclPDT621]))

	det, err := s.DetraccionesDashboardSummary(p)
	if err != nil {
		return ComplianceSummary{}, err
	}
	cs.addSummary(det)

	cs.finalize()
	return cs, nil
}
