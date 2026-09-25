package services

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// PreliminarVentasSinRegistro filtro sintético del listado: empresas sin declaración creada todavía
// para este período (nunca se abrió su detalle) — mismo criterio que SupervisorSunatSinRegistro.
const PreliminarVentasSinRegistro = "sin_registro"

// PreliminarVentasListParams filtros del listado Preliminar de Ventas por empresa y período.
type PreliminarVentasListParams struct {
	PeriodYM          string
	Q                 string
	Status            string
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

// PreliminarVentasListRow fila del listado (empresa + período + módulo preliminar_ventas).
type PreliminarVentasListRow struct {
	CompanyID         uint   `json:"company_id"`
	Code              string `json:"code"`
	Dig               string `json:"dig"`
	BusinessName      string `json:"business_name"`
	RUC               string `json:"ruc"`
	AssistantUsername string `json:"assistant_username"`
	Status            string `json:"status"`
	Suspendida        bool   `json:"suspendida"`
}

// PreliminarVentasRecordInput datos que registra el asistente — solo Ventas (Facturas/Boletas/Notas
// de crédito, Base Imponible + No Gravadas) y, opcionalmente, un importe aproximado de Compras. Todo
// lo demás (IGV por fila, IGV resultante, crédito arrastrado, montos aproximados a pagar) se calcula
// — ver computePreliminarVentasSummary. Se reusa la misma forma como DTO de lectura: no hay fechas ni
// campos opcionales que obliguen a separar input/salida, a diferencia de Pdt621RecordInput/DTO.
type PreliminarVentasRecordInput struct {
	FacturasBase           float64 `json:"facturas_base"`
	FacturasNoGravadas     float64 `json:"facturas_no_gravadas"`
	BoletasBase            float64 `json:"boletas_base"`
	BoletasNoGravadas      float64 `json:"boletas_no_gravadas"`
	NotasCreditoBase       float64 `json:"notas_credito_base"`
	NotasCreditoNoGravadas float64 `json:"notas_credito_no_gravadas"`
	ComprasBase            float64 `json:"compras_base"`
}

// PreliminarVentasSummaryRow una fila de la tabla "Ventas" (Facturas/Boletas/Notas de crédito/Total).
type PreliminarVentasSummaryRow struct {
	Label      string  `json:"label"`
	Base       float64 `json:"base"`
	NoGravadas float64 `json:"no_gravadas"`
	Igv        float64 `json:"igv"`
	Total      float64 `json:"total"`
}

// PreliminarVentasSummary importes calculados a partir de PreliminarVentasRecordInput y de la
// configuración vigente de la empresa (igv_rate, tax_regime) — nunca se persisten, se recalculan
// siempre que se lee o se guarda el registro, igual que el resto del sistema calcula IGV/Renta.
type PreliminarVentasSummary struct {
	Rows                   []PreliminarVentasSummaryRow `json:"rows"`
	IgvRatePct             float64                      `json:"igv_rate_pct"`
	IgvResultante          float64                      `json:"igv_resultante"`
	CreditoPeriodoAnterior float64                      `json:"credito_periodo_anterior"`
	IgvAPagar              float64                      `json:"igv_a_pagar"`
	// MontoAproximadoIgv nil cuando IgvAPagar <= 0 (crédito a favor o neutral) — el PDF y la UI lo
	// dejan en blanco, igual que la plantilla real del estudio.
	MontoAproximadoIgv   *float64 `json:"monto_aproximado_igv,omitempty"`
	ComprasIgv           float64  `json:"compras_igv"`
	ComprasTotal         float64  `json:"compras_total"`
	RentaBase            float64  `json:"renta_base"`
	RentaRatePct         float64  `json:"renta_rate_pct"`
	MontoAproximadoRenta float64  `json:"monto_aproximado_renta"`
}

// PreliminarVentasDetail detalle tras EnsurePreliminarVentas (lazy create).
type PreliminarVentasDetail struct {
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
	Record            PreliminarVentasRecordInput  `json:"record"`
	Summary           PreliminarVentasSummary      `json:"summary"`
	// DocumentNumber serie del PDF: PV001-<código interno, 3 dígitos><año 4><mes 2> — determinística
	// a partir de empresa+período (no es un correlativo que suba con cada regeneración).
	DocumentNumber string `json:"document_number"`
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func roundToWhole(v float64) float64 {
	return math.Round(v)
}

func parseIgvRatePct(raw string) float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 18
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v <= 0 {
		return 18
	}
	return v
}

// preliminarVentasRentaRatePct tasa de pago a cuenta mensual de renta según régimen SUNAT de la
// empresa (sin coeficiente manual, que solo existe a nivel de Liquidación) — mype 1%, rer/general
// 1.5%, ver docs equivalente en frontend/src/utils/companyTaxRegime.ts (SUNAT_RENTA_RATE_BY_REGIME).
func preliminarVentasRentaRatePct(regime string) float64 {
	switch strings.ToLower(strings.TrimSpace(regime)) {
	case models.CompanyTaxRegimeMype:
		return 1
	case models.CompanyTaxRegimeRER, models.CompanyTaxRegimeGeneral:
		return 1.5
	default:
		return 0
	}
}

// preliminarVentasDocumentNumber serie del PDF — determinística, no un contador persistido: mismo
// número si se regenera el mismo período de la misma empresa.
func preliminarVentasDocumentNumber(company *models.Company, periodYM string) string {
	var year, month int
	_, _ = fmt.Sscanf(periodYM, "%d-%d", &year, &month)
	correlativo := 0
	if n, err := strconv.Atoi(strings.TrimSpace(company.InternalCode)); err == nil {
		correlativo = n
	}
	return fmt.Sprintf("PV001-%03d%04d%02d", correlativo, year, month)
}

func preliminarVentasRecordToInput(r *models.SupervisorPreliminarVentasRecord) PreliminarVentasRecordInput {
	if r == nil {
		return PreliminarVentasRecordInput{}
	}
	return PreliminarVentasRecordInput{
		FacturasBase:           r.FacturasBase,
		FacturasNoGravadas:     r.FacturasNoGravadas,
		BoletasBase:            r.BoletasBase,
		BoletasNoGravadas:      r.BoletasNoGravadas,
		NotasCreditoBase:       r.NotasCreditoBase,
		NotasCreditoNoGravadas: r.NotasCreditoNoGravadas,
		ComprasBase:            r.ComprasBase,
	}
}

// computePreliminarVentasSummary calcula todo lo derivado de lo registrado — nunca se guarda en la
// tabla, se recalcula siempre con la tasa vigente de la empresa (igv_rate/tax_regime).
func (s *SupervisorService) computePreliminarVentasSummary(
	company *models.Company,
	in PreliminarVentasRecordInput,
	periodYM string,
) PreliminarVentasSummary {
	igvRate := parseIgvRatePct(company.IgvRate)

	facturasIgv := round2(in.FacturasBase * igvRate / 100)
	facturasTotal := round2(in.FacturasBase + in.FacturasNoGravadas + facturasIgv)
	boletasIgv := round2(in.BoletasBase * igvRate / 100)
	boletasTotal := round2(in.BoletasBase + in.BoletasNoGravadas + boletasIgv)
	notasIgv := round2(in.NotasCreditoBase * igvRate / 100)
	notasTotal := round2(in.NotasCreditoBase + in.NotasCreditoNoGravadas + notasIgv)

	totalBase := round2(in.FacturasBase + in.BoletasBase - in.NotasCreditoBase)
	totalNoGravadas := round2(in.FacturasNoGravadas + in.BoletasNoGravadas - in.NotasCreditoNoGravadas)
	totalIgv := round2(facturasIgv + boletasIgv - notasIgv)
	totalTotal := round2(totalBase + totalNoGravadas + totalIgv)

	// I.G.V Resultante: redondeado a entero (declaración SUNAT sin decimales), igual criterio que
	// impuesto_periodo en la Liquidación (roundTaxTotalAmount).
	igvResultante := roundToWhole(totalIgv)
	credito := s.preliminarVentasCreditoAnterior(company, periodYM, 0)
	igvAPagar := round2(igvResultante - credito)
	var montoAproxIgv *float64
	if igvAPagar > 0 {
		v := roundToWhole(igvAPagar)
		montoAproxIgv = &v
	}

	comprasIgv := round2(in.ComprasBase * igvRate / 100)
	comprasTotal := round2(in.ComprasBase + comprasIgv)

	rentaBaseRaw := totalBase + totalNoGravadas
	if rentaBaseRaw < 0 {
		rentaBaseRaw = 0
	}
	rentaBase := round2(rentaBaseRaw)
	rentaRate := preliminarVentasRentaRatePct(company.TaxRegime)
	montoAproxRenta := 0.0
	if rentaRate > 0 && rentaBase > 0 {
		montoAproxRenta = roundToWhole(round2(rentaBase * rentaRate / 100))
	}

	return PreliminarVentasSummary{
		Rows: []PreliminarVentasSummaryRow{
			{Label: "Facturas Emitidas", Base: in.FacturasBase, NoGravadas: in.FacturasNoGravadas, Igv: facturasIgv, Total: facturasTotal},
			{Label: "Boletas Emitidas", Base: in.BoletasBase, NoGravadas: in.BoletasNoGravadas, Igv: boletasIgv, Total: boletasTotal},
			{Label: "(-) Notas de Crédito", Base: in.NotasCreditoBase, NoGravadas: in.NotasCreditoNoGravadas, Igv: notasIgv, Total: notasTotal},
			{Label: "TOTAL VENTAS", Base: totalBase, NoGravadas: totalNoGravadas, Igv: totalIgv, Total: totalTotal},
		},
		IgvRatePct:             igvRate,
		IgvResultante:          igvResultante,
		CreditoPeriodoAnterior: credito,
		IgvAPagar:              igvAPagar,
		MontoAproximadoIgv:     montoAproxIgv,
		ComprasIgv:             comprasIgv,
		ComprasTotal:           comprasTotal,
		RentaBase:              rentaBase,
		RentaRatePct:           rentaRate,
		MontoAproximadoRenta:   montoAproxRenta,
	}
}

// preliminarVentasCreditoAnterior arrastre automático (confirmado con el usuario): el I.G.V. A PAGAR
// del Preliminar de Ventas del período inmediato anterior de la MISMA empresa, si salió negativo
// (crédito a favor), se resta este período. depth acota la recursión (protección defensiva ante
// datos corridos por muchos años; en operación normal nunca se acerca a ese límite).
func (s *SupervisorService) preliminarVentasCreditoAnterior(company *models.Company, periodYM string, depth int) float64 {
	if depth > 36 {
		return 0
	}
	prevYM, ok := previousPeriodYM(periodYM)
	if !ok {
		return 0
	}
	var prevCtrl models.SupervisorMonthlyControl
	if err := database.DB.Where("company_id = ? AND period_ym = ?", company.ID, prevYM).First(&prevCtrl).Error; err != nil {
		return 0
	}
	var prevRecord models.SupervisorPreliminarVentasRecord
	if err := database.DB.Where("monthly_control_id = ?", prevCtrl.ID).First(&prevRecord).Error; err != nil {
		return 0
	}
	prevInput := preliminarVentasRecordToInput(&prevRecord)
	prevSummary := s.computePreliminarVentasSummary(company, prevInput, prevYM)
	if prevSummary.IgvAPagar < 0 {
		return -prevSummary.IgvAPagar
	}
	return 0
}

// EnsurePreliminarVentas crea (lazy) el control mensual y la declaración "preliminar_ventas" si no
// existen — mismo patrón que EnsurePdt621/EnsureDetracciones — para poder sumarle más adelante
// control de fechas de entrega/estado sin cambiar la forma de este módulo.
func (s *SupervisorService) EnsurePreliminarVentas(companyID uint, periodYM string) (*PreliminarVentasDetail, error) {
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
		if err := tx.Where("monthly_control_id = ? AND declaration_type = ?", ctrl.ID, models.SupervisorDeclPreliminarVentas).
			First(&decl).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			decl = models.SupervisorDeclaration{
				MonthlyControlID: ctrl.ID,
				DeclarationType:  models.SupervisorDeclPreliminarVentas,
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

	var record models.SupervisorPreliminarVentasRecord
	_ = database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&record).Error

	input := preliminarVentasRecordToInput(&record)
	summary := s.computePreliminarVentasSummary(&company, input, periodYM)

	return &PreliminarVentasDetail{
		PeriodYM:          periodYM,
		CompanyID:         company.ID,
		Code:              strings.TrimSpace(company.InternalCode),
		Dig:               s.companyDig(company.ID),
		BusinessName:      strings.TrimSpace(company.BusinessName),
		RUC:               strings.TrimSpace(company.RUC),
		AssistantUsername: assistantUsername(company.Assistant),
		ControlID:         ctrl.ID,
		ControlSuspendida: ctrl.Suspendida,
		Declaration:       decl,
		Record:            input,
		Summary:           summary,
		DocumentNumber:    preliminarVentasDocumentNumber(&company, periodYM),
	}, nil
}

// SavePreliminarVentasRecord guarda lo registrado por el asistente (solo Ventas/Compras — el resto
// se recalcula al vuelo, nunca se guarda).
func (s *SupervisorService) SavePreliminarVentasRecord(companyID uint, periodYM string, in PreliminarVentasRecordInput) (*PreliminarVentasDetail, error) {
	detail, err := s.EnsurePreliminarVentas(companyID, periodYM)
	if err != nil {
		return nil, err
	}
	// Suspendida es global por control (Control de Detracciones es el único que la marca/desmarca,
	// docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.7) — mientras esté marcada, este módulo
	// también queda de solo lectura, mismo criterio que PDT 601/621.
	if detail.ControlSuspendida {
		return nil, errors.New("esta empresa está suspendida en este período (marcado desde Control de Detracciones); no se puede editar")
	}
	var ctrl models.SupervisorMonthlyControl
	if err := database.DB.Where("company_id = ? AND period_ym = ?", companyID, periodYM).First(&ctrl).Error; err != nil {
		return nil, err
	}

	var record models.SupervisorPreliminarVentasRecord
	err = database.DB.Where("monthly_control_id = ?", ctrl.ID).First(&record).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	record.MonthlyControlID = ctrl.ID
	record.FacturasBase = in.FacturasBase
	record.FacturasNoGravadas = in.FacturasNoGravadas
	record.BoletasBase = in.BoletasBase
	record.BoletasNoGravadas = in.BoletasNoGravadas
	record.NotasCreditoBase = in.NotasCreditoBase
	record.NotasCreditoNoGravadas = in.NotasCreditoNoGravadas
	record.ComprasBase = in.ComprasBase

	if record.ID == 0 {
		if err := database.DB.Create(&record).Error; err != nil {
			return nil, err
		}
	} else {
		if err := database.DB.Save(&record).Error; err != nil {
			return nil, err
		}
	}
	return s.EnsurePreliminarVentas(companyID, periodYM)
}

// ListPreliminarVentas listado empresa+período del módulo — mismo patrón de columnas comunes que los
// demás módulos de actividad, más Estado (declaration.status; "sin_registro" si nunca se abrió el
// detalle) y Suspendida.
func (s *SupervisorService) ListPreliminarVentas(p PreliminarVentasListParams) ([]PreliminarVentasListRow, int64, error) {
	if !validPeriodYM(p.PeriodYM) {
		return nil, 0, errors.New("período inválido (use YYYY-MM)")
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

	q := database.DB.Table("companies AS comp").
		Joins("LEFT JOIN supervisor_monthly_controls c ON c.company_id = comp.id AND c.period_ym = ? AND c.deleted_at IS NULL", p.PeriodYM).
		Joins("LEFT JOIN supervisor_declarations d ON d.monthly_control_id = c.id AND d.declaration_type = ? AND d.deleted_at IS NULL", models.SupervisorDeclPreliminarVentas).
		Joins("LEFT JOIN users au ON au.id = comp.assistant_user_id").
		Where("comp.client_type = ? AND comp.status = ?", models.CompanyClientTypeEstudio, "activo")

	if len(p.AllowedCompanyIDs) > 0 {
		q = q.Where("comp.id IN ?", p.AllowedCompanyIDs)
	} else if p.AllowedCompanyIDs != nil {
		return []PreliminarVentasListRow{}, 0, nil
	}
	if term := strings.TrimSpace(p.Q); len(term) >= 2 {
		like := "%" + term + "%"
		q = q.Where("comp.ruc LIKE ? OR comp.business_name LIKE ?", like, like)
	}
	if status := strings.TrimSpace(p.Status); status != "" {
		if status == PreliminarVentasSinRegistro {
			q = q.Where("d.id IS NULL")
		} else {
			q = q.Where("d.status = ?", status)
		}
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []PreliminarVentasListRow
	err := q.Select(
		"comp.id AS company_id, comp.internal_code AS code, comp.business_name, comp.ruc, "+
			"au.username AS assistant_username, "+
			"COALESCE(d.status, ?) AS status, "+
			"COALESCE(c.suspendida, false) AS suspendida",
		PreliminarVentasSinRegistro,
	).
		Order("comp.internal_code ASC").
		Limit(perPage).Offset((page - 1) * perPage).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		rows[i].Dig = s.companyDig(rows[i].CompanyID)
	}
	return rows, total, nil
}
