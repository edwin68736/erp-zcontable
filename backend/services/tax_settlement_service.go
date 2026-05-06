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

type TaxSettlementService struct{}

func NewTaxSettlementService() *TaxSettlementService {
	return &TaxSettlementService{}
}

type SettlementPreviewLine struct {
	DocumentID         uint    `json:"document_id"`
	Concept            string  `json:"concept"`
	Amount             float64 `json:"amount"`
	IssueDate          string  `json:"issue_date"`
	Status             string  `json:"status"`
	AccountingPeriod   string  `json:"accounting_period"` // YYYY-MM; de service_month si aplica
}

func documentPreviewConcept(d models.Document) string {
	concept := strings.TrimSpace(d.Description)
	if len(d.Items) == 0 {
		return concept
	}
	parts := make([]string, 0, len(d.Items))
	for _, it := range d.Items {
		if t := strings.TrimSpace(it.Description); t != "" {
			parts = append(parts, t)
		}
	}
	if len(parts) == 0 {
		return concept
	}
	joined := strings.Join(parts, " · ")
	if len(joined) > 480 {
		return joined[:480] + "…"
	}
	return joined
}

func (s *TaxSettlementService) PreviewOpenDocuments(companyID uint, asOf *time.Time) ([]SettlementPreviewLine, error) {
	var docs []models.Document
	q := database.DB.Where("company_id = ? AND status IN ?", companyID, []string{"pendiente", "parcial"}).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Order("issue_date ASC, id ASC")
	if err := q.Find(&docs).Error; err != nil {
		return nil, err
	}
	out := make([]SettlementPreviewLine, 0, len(docs))
	for _, d := range docs {
		paid := DocumentPaidTotal(database.DB, d.ID)
		bal := d.TotalAmount - paid
		if bal <= 0.005 {
			continue
		}
		if asOf != nil && d.IssueDate.After(*asOf) {
			continue
		}
		acct := strings.TrimSpace(d.AccountingPeriod)
		if acct == "" {
			acct = strings.TrimSpace(d.ServiceMonth)
		}
		out = append(out, SettlementPreviewLine{
			DocumentID:       d.ID,
			Concept:          documentPreviewConcept(d),
			Amount:           math.Round(bal*100) / 100,
			IssueDate:        d.IssueDate.Format("2006-01-02"),
			Status:           d.Status,
			AccountingPeriod: acct,
		})
	}
	return out, nil
}

type TaxSettlementLineInput struct {
	LineType    string   `json:"line_type"`
	DocumentID  *uint    `json:"document_id"`
	ProductID   *uint    `json:"product_id"`
	Concept     string   `json:"concept"`
	Amount      float64  `json:"amount"`
	SortOrder   int      `json:"sort_order"`
	PeriodYM    string   `json:"period_ym"`   // YYYY-MM (preferido)
	PeriodDate  string   `json:"period_date"` // YYYY-MM-DD legado; si falta period_ym se deriva el mes
}

type TaxSettlementCreateInput struct {
	CompanyID          uint                     `json:"company_id"`
	IssueDate          time.Time                `json:"issue_date"`
	LiquidationPeriod  string                   `json:"liquidation_period"` // YYYY-MM periodo de la liquidación
	PeriodLabel        string                   `json:"period_label"`
	PeriodFrom         *time.Time               `json:"period_from"`
	PeriodTo           *time.Time               `json:"period_to"`
	Notes              string                   `json:"notes"`
	Pdt621JSON         string                   `json:"pdt621_json"`
	Lines              []TaxSettlementLineInput `json:"lines"`
}

func parseTaxLinePeriodDate(s string) *time.Time {
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

func validatePeriodYM(s string) error {
	if _, err := time.Parse("2006-01", s); err != nil {
		return fmt.Errorf("periodo inválido %q (use AAAA-MM)", s)
	}
	return nil
}

// resolveLiquidationPeriodYM obtiene YYYY-MM desde el cuerpo o, si falta, desde period_label o la fecha de emisión.
func resolveLiquidationPeriodYM(periodLabel string, issueDate time.Time, explicit string) (string, error) {
	lp := strings.TrimSpace(explicit)
	if lp == "" {
		pl := strings.TrimSpace(periodLabel)
		if len(pl) >= 7 {
			head := pl[:7]
			if _, err := time.Parse("2006-01", head); err == nil {
				lp = head
			}
		}
	}
	if lp == "" {
		lp = issueDate.Format("2006-01")
	}
	if err := validatePeriodYM(lp); err != nil {
		return "", err
	}
	return lp, nil
}

func duplicateLiquidationPeriod(tx *gorm.DB, companyID uint, periodYM string, excludeID uint) (bool, error) {
	var n int64
	q := tx.Model(&models.TaxSettlement{}).
		Where("company_id = ? AND liquidation_period = ? AND status IN ?", companyID, periodYM, []string{models.TaxSettlementStatusDraft, models.TaxSettlementStatusIssued})
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	if err := q.Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// settlementNumberFromLiquidationPeriod devuelve el número visible LI-YYYYMM a partir del periodo AAAA-MM.
func settlementNumberFromLiquidationPeriod(lp string) (string, error) {
	compact := strings.ReplaceAll(strings.TrimSpace(lp), "-", "")
	if len(compact) != 6 {
		return "", fmt.Errorf("periodo de liquidación inválido para numeración: %q", lp)
	}
	return "LI-" + compact, nil
}

func normalizeLinePeriodYM(li TaxSettlementLineInput, settlementYM string) (periodYM string, firstOfMonth *time.Time, err error) {
	py := strings.TrimSpace(li.PeriodYM)
	if py == "" && strings.TrimSpace(li.PeriodDate) != "" {
		if t := parseTaxLinePeriodDate(li.PeriodDate); t != nil {
			py = t.Format("2006-01")
		}
	}
	if py == "" {
		py = settlementYM
	}
	if err := validatePeriodYM(py); err != nil {
		return "", nil, err
	}
	first, e := time.ParseInLocation("2006-01-02", py+"-01", time.Local)
	if e != nil {
		return "", nil, e
	}
	return py, &first, nil
}

func (s *TaxSettlementService) validateLine(in TaxSettlementLineInput) error {
	switch in.LineType {
	case models.TaxSettlementLineDocRef, models.TaxSettlementLineTaxManual, models.TaxSettlementLineAdjust:
	default:
		return fmt.Errorf("line_type inválido: %s", in.LineType)
	}
	if strings.TrimSpace(in.Concept) == "" {
		return errors.New("cada línea requiere concepto")
	}
	if in.Amount < 0 {
		return errors.New("monto de línea no puede ser negativo")
	}
	if in.LineType == models.TaxSettlementLineDocRef && (in.DocumentID == nil || *in.DocumentID == 0) {
		return errors.New("línea document_ref requiere document_id")
	}
	return nil
}

func (s *TaxSettlementService) CreateDraft(in TaxSettlementCreateInput) (*models.TaxSettlement, error) {
	if in.CompanyID == 0 {
		return nil, errors.New("company_id requerido")
	}
	if len(in.Lines) == 0 {
		return nil, errors.New("agregue al menos una línea")
	}
	ts := models.TaxSettlement{
		CompanyID:   in.CompanyID,
		Status:      models.TaxSettlementStatusDraft,
		Notes:       in.Notes,
		Pdt621JSON:  in.Pdt621JSON,
		PeriodLabel: strings.TrimSpace(in.PeriodLabel),
		PeriodFrom:  in.PeriodFrom,
		PeriodTo:    in.PeriodTo,
	}
	if in.IssueDate.IsZero() {
		ts.IssueDate = time.Now()
	} else {
		ts.IssueDate = in.IssueDate
	}
	lp, err := resolveLiquidationPeriodYM(ts.PeriodLabel, ts.IssueDate, in.LiquidationPeriod)
	if err != nil {
		return nil, err
	}
	ts.LiquidationPeriod = lp
	num, err := settlementNumberFromLiquidationPeriod(lp)
	if err != nil {
		return nil, err
	}
	ts.Number = num

	lines := make([]models.TaxSettlementLine, 0, len(in.Lines))
	for i, li := range in.Lines {
		if err := s.validateLine(li); err != nil {
			return nil, err
		}
		if li.LineType == models.TaxSettlementLineDocRef {
			var d models.Document
			if err := database.DB.First(&d, *li.DocumentID).Error; err != nil {
				return nil, err
			}
			if d.CompanyID != in.CompanyID {
				return nil, errors.New("el documento no pertenece a la empresa de la liquidación")
			}
		}
		order := li.SortOrder
		if order == 0 {
			order = i
		}
		pym, pdt, err := normalizeLinePeriodYM(li, lp)
		if err != nil {
			return nil, err
		}
		lines = append(lines, models.TaxSettlementLine{
			LineType:   li.LineType,
			DocumentID: li.DocumentID,
			ProductID:  li.ProductID,
			Concept:    strings.TrimSpace(li.Concept),
			Amount:     li.Amount,
			SortOrder:  order,
			PeriodYM:   pym,
			PeriodDate: pdt,
		})
	}
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		dup, err := duplicateLiquidationPeriod(tx, in.CompanyID, lp, 0)
		if err != nil {
			return err
		}
		if dup {
			return errors.New("ya existe una liquidación en borrador o emitida para esa empresa y el mismo periodo (AAAA-MM)")
		}
		if err := tx.Create(&ts).Error; err != nil {
			return err
		}
		for i := range lines {
			lines[i].TaxSettlementID = ts.ID
		}
		if err := tx.Create(&lines).Error; err != nil {
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.GetByID(ts.ID)
}

type TaxSettlementUpdateInput struct {
	IssueDate          time.Time                `json:"issue_date"`
	LiquidationPeriod  string                   `json:"liquidation_period"`
	PeriodLabel        string                   `json:"period_label"`
	PeriodFrom         *time.Time               `json:"period_from"`
	PeriodTo           *time.Time               `json:"period_to"`
	Notes              string                   `json:"notes"`
	Pdt621JSON         string                   `json:"pdt621_json"`
	Lines              []TaxSettlementLineInput `json:"lines"`
}

func (s *TaxSettlementService) UpdateDraft(id uint, in TaxSettlementUpdateInput) (*models.TaxSettlement, error) {
	var ts models.TaxSettlement
	if err := database.DB.First(&ts, id).Error; err != nil {
		return nil, err
	}
	if ts.Status != models.TaxSettlementStatusDraft {
		return nil, errors.New("solo se puede editar una liquidación en borrador")
	}
	if len(in.Lines) == 0 {
		return nil, errors.New("agregue al menos una línea")
	}
	if !in.IssueDate.IsZero() {
		ts.IssueDate = in.IssueDate
	}
	ts.PeriodLabel = strings.TrimSpace(in.PeriodLabel)
	ts.PeriodFrom = in.PeriodFrom
	ts.PeriodTo = in.PeriodTo
	ts.Notes = in.Notes
	ts.Pdt621JSON = in.Pdt621JSON

	explicitLP := strings.TrimSpace(in.LiquidationPeriod)
	if explicitLP == "" {
		explicitLP = strings.TrimSpace(ts.LiquidationPeriod)
	}
	lp, err := resolveLiquidationPeriodYM(ts.PeriodLabel, ts.IssueDate, explicitLP)
	if err != nil {
		return nil, err
	}
	ts.LiquidationPeriod = lp
	num, err := settlementNumberFromLiquidationPeriod(lp)
	if err != nil {
		return nil, err
	}
	ts.Number = num

	lines := make([]models.TaxSettlementLine, 0, len(in.Lines))
	for i, li := range in.Lines {
		if err := s.validateLine(li); err != nil {
			return nil, err
		}
		if li.LineType == models.TaxSettlementLineDocRef {
			var d models.Document
			if err := database.DB.First(&d, *li.DocumentID).Error; err != nil {
				return nil, err
			}
			if d.CompanyID != ts.CompanyID {
				return nil, errors.New("el documento no pertenece a la empresa de la liquidación")
			}
		}
		order := li.SortOrder
		if order == 0 {
			order = i
		}
		pym, pdt, err := normalizeLinePeriodYM(li, lp)
		if err != nil {
			return nil, err
		}
		lines = append(lines, models.TaxSettlementLine{
			TaxSettlementID: ts.ID,
			LineType:        li.LineType,
			DocumentID:      li.DocumentID,
			ProductID:       li.ProductID,
			Concept:         strings.TrimSpace(li.Concept),
			Amount:          li.Amount,
			SortOrder:       order,
			PeriodYM:        pym,
			PeriodDate:      pdt,
		})
	}

	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		dup, err := duplicateLiquidationPeriod(tx, ts.CompanyID, lp, ts.ID)
		if err != nil {
			return err
		}
		if dup {
			return errors.New("ya existe otra liquidación en borrador o emitida para esa empresa y el mismo periodo (AAAA-MM)")
		}
		if err := tx.Model(&models.TaxSettlementLine{}).Where("tax_settlement_id = ?", ts.ID).Delete(&models.TaxSettlementLine{}).Error; err != nil {
			return err
		}
		if err := tx.Save(&ts).Error; err != nil {
			return err
		}
		if err := tx.Create(&lines).Error; err != nil {
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.GetByID(id)
}

func (s *TaxSettlementService) GetByID(id uint) (*models.TaxSettlement, error) {
	var ts models.TaxSettlement
	if err := database.DB.Preload("Company").Preload("Lines", func(db *gorm.DB) *gorm.DB {
		return db.Order("sort_order ASC, id ASC")
	}).First(&ts, id).Error; err != nil {
		return nil, err
	}
	return &ts, nil
}

type TaxSettlementListParams struct {
	CompanyID         uint
	Status            string
	AllowedCompanyIDs []uint
	Page              int
	PerPage           int
}

func (s *TaxSettlementService) ListPaged(params TaxSettlementListParams) ([]models.TaxSettlement, int64, error) {
	page := params.Page
	if page <= 0 {
		page = 1
	}
	perPage := params.PerPage
	if perPage <= 0 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}
	q := database.DB.Model(&models.TaxSettlement{})
	if params.AllowedCompanyIDs != nil {
		if len(params.AllowedCompanyIDs) == 0 {
			return []models.TaxSettlement{}, 0, nil
		}
		q = q.Where("company_id IN ?", params.AllowedCompanyIDs)
	}
	if params.CompanyID > 0 {
		q = q.Where("company_id = ?", params.CompanyID)
	}
	if st := strings.TrimSpace(params.Status); st != "" {
		q = q.Where("status = ?", st)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var list []models.TaxSettlement
	err := q.Preload("Company").Preload("Lines", func(db *gorm.DB) *gorm.DB {
		return db.Order("sort_order ASC, id ASC")
	}).
		Order("issue_date DESC, id DESC").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&list).Error
	if err != nil {
		return nil, 0, err
	}
	// Borradores: total_general no está persistido hasta emitir; se calcula desde líneas para listados.
	for i := range list {
		if list[i].Status != models.TaxSettlementStatusDraft {
			continue
		}
		var th, tm float64
		for _, ln := range list[i].Lines {
			switch ln.LineType {
			case models.TaxSettlementLineDocRef, models.TaxSettlementLineAdjust:
				th += ln.Amount
			case models.TaxSettlementLineTaxManual:
				tm += ln.Amount
			}
		}
		list[i].TotalHonorarios = math.Round(th*100) / 100
		list[i].TotalImpuestos = math.Round(tm*100) / 100
		list[i].TotalGeneral = math.Round((th+tm)*100) / 100
	}
	return list, total, nil
}

// createDebtDocumentsForManualLines crea documentos de deuda pendientes por líneas adjustment/tax_manual sin document_id.
// Se usa al emitir y al pedir sugerencias de pago, para reparar liquidaciones emitidas antes del backfill o fallos parciales.
func createDebtDocumentsForManualLines(tx *gorm.DB, ts *models.TaxSettlement, lines []models.TaxSettlementLine) error {
	for i := range lines {
		ln := &lines[i]
		if ln.DocumentID != nil && *ln.DocumentID > 0 {
			continue
		}
		if ln.LineType != models.TaxSettlementLineAdjust && ln.LineType != models.TaxSettlementLineTaxManual {
			continue
		}
		if ln.Amount < 0.005 {
			continue
		}
		issue := ts.IssueDate
		y, mo, d := issue.Date()
		issue = time.Date(y, mo, d, 0, 0, 0, 0, issue.Location())
		periodYM := strings.TrimSpace(ln.PeriodYM)
		if periodYM == "" && ln.PeriodDate != nil && !ln.PeriodDate.IsZero() {
			periodYM = ln.PeriodDate.Format("2006-01")
		}
		if periodYM == "" {
			periodYM = strings.TrimSpace(ts.LiquidationPeriod)
		}
		if periodYM == "" {
			periodYM = issue.Format("2006-01")
		}
		desc := strings.TrimSpace(ln.Concept)
		if desc == "" {
			desc = "Cargo liquidación"
		}
		if len(desc) > 900 {
			desc = desc[:900] + "…"
		}
		doc := models.Document{
			CompanyID:          ts.CompanyID,
			Type:               models.DocumentTypeLiquidacion,
			Number:             fmt.Sprintf("DEU-LIQ-%d-%d", ts.ID, ln.ID),
			IssueDate:          issue,
			TotalAmount:        math.Round(ln.Amount*100) / 100,
			Description:        desc,
			ServiceMonth:       periodYM,
			AccountingPeriod:   periodYM,
			Status:             "pendiente",
			Source:             "liquidacion",
		}
		if err := tx.Omit("Company", "Payments", "Allocations", "Items").Create(&doc).Error; err != nil {
			return err
		}
		did := doc.ID
		if err := tx.Model(&models.TaxSettlementLine{}).Where("id = ?", ln.ID).Update("document_id", did).Error; err != nil {
			return err
		}
		ln.DocumentID = &did
	}
	return nil
}

func (s *TaxSettlementService) Emit(id uint) (*models.TaxSettlement, error) {
	var ts models.TaxSettlement
	if err := database.DB.Preload("Lines").First(&ts, id).Error; err != nil {
		return nil, err
	}
	if ts.Status != models.TaxSettlementStatusDraft {
		return nil, errors.New("solo se puede emitir una liquidación en borrador")
	}
	var th, tm, tg float64
	for _, ln := range ts.Lines {
		switch ln.LineType {
		case models.TaxSettlementLineDocRef, models.TaxSettlementLineAdjust:
			th += ln.Amount
		case models.TaxSettlementLineTaxManual:
			tm += ln.Amount
		}
	}
	tg = th + tm
	ts.TotalHonorarios = math.Round(th*100) / 100
	ts.TotalImpuestos = math.Round(tm*100) / 100
	ts.TotalGeneral = math.Round(tg*100) / 100

	lp := strings.TrimSpace(ts.LiquidationPeriod)
	if lp == "" {
		var err error
		lp, err = resolveLiquidationPeriodYM(ts.PeriodLabel, ts.IssueDate, "")
		if err != nil {
			return nil, err
		}
		ts.LiquidationPeriod = lp
	}

	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		dup, err := duplicateLiquidationPeriod(tx, ts.CompanyID, lp, ts.ID)
		if err != nil {
			return err
		}
		if dup {
			return errors.New("ya existe otra liquidación para esa empresa y periodo; no se puede emitir")
		}
		num, err := settlementNumberFromLiquidationPeriod(lp)
		if err != nil {
			return err
		}
		ts.Number = num
		ts.Status = models.TaxSettlementStatusIssued
		if err := createDebtDocumentsForManualLines(tx, &ts, ts.Lines); err != nil {
			return err
		}
		if err := tx.Save(&ts).Error; err != nil {
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.GetByID(id)
}

// PaymentSuggestionLine imputación sugerida desde líneas document_ref de la liquidación (monto = min(snapshot, saldo vivo)).
type PaymentSuggestionLine struct {
	DocumentID           uint    `json:"document_id"`
	Amount               float64 `json:"amount"`
	Concept              string  `json:"concept"`
	SettlementLineAmount float64 `json:"settlement_line_amount"`
	DocumentNumber       string  `json:"document_number"`
}

// PaymentSuggestionsResult respuesta para precargar el formulario de pago.
type PaymentSuggestionsResult struct {
	TaxSettlementID  uint                  `json:"tax_settlement_id"`
	SettlementNumber   string                `json:"settlement_number"`
	CompanyID          uint                  `json:"company_id"`
	Status             string                `json:"status"`
	Lines              []PaymentSuggestionLine `json:"lines"`
	SuggestedTotal     float64               `json:"suggested_total"`
}

func (s *TaxSettlementService) PaymentSuggestions(settlementID uint) (*PaymentSuggestionsResult, error) {
	ts, err := s.GetByID(settlementID)
	if err != nil {
		return nil, err
	}
	if ts.Status == models.TaxSettlementStatusIssued {
		if err := database.DB.Transaction(func(tx *gorm.DB) error {
			var lines []models.TaxSettlementLine
			if err := tx.Where("tax_settlement_id = ?", ts.ID).Order("sort_order ASC, id ASC").Find(&lines).Error; err != nil {
				return err
			}
			return createDebtDocumentsForManualLines(tx, ts, lines)
		}); err != nil {
			return nil, err
		}
		ts, err = s.GetByID(settlementID)
		if err != nil {
			return nil, err
		}
	}
	out := &PaymentSuggestionsResult{
		TaxSettlementID: ts.ID,
		SettlementNumber: strings.TrimSpace(ts.Number),
		CompanyID:       ts.CompanyID,
		Status:          ts.Status,
		Lines:           []PaymentSuggestionLine{},
	}
	for _, ln := range ts.Lines {
		if ln.DocumentID == nil || *ln.DocumentID == 0 {
			continue
		}
		var d models.Document
		if err := database.DB.First(&d, *ln.DocumentID).Error; err != nil {
			continue
		}
		if d.CompanyID != ts.CompanyID {
			continue
		}
		if d.Status == "anulado" {
			continue
		}
		bal := d.TotalAmount - DocumentPaidTotal(database.DB, d.ID)
		if bal < 0.005 {
			continue
		}
		sug := ln.Amount
		if sug > bal+1e-9 {
			sug = bal
		}
		if sug < 0.005 {
			continue
		}
		sug = math.Round(sug*100) / 100
		out.Lines = append(out.Lines, PaymentSuggestionLine{
			DocumentID:           *ln.DocumentID,
			Amount:               sug,
			Concept:              strings.TrimSpace(ln.Concept),
			SettlementLineAmount: ln.Amount,
			DocumentNumber:       strings.TrimSpace(d.Number),
		})
		out.SuggestedTotal += sug
	}
	out.SuggestedTotal = math.Round(out.SuggestedTotal*100) / 100
	return out, nil
}

// CanRegisterPayment indica si aún hay imputaciones sugeridas con saldo (equivale a len(PaymentSuggestions.Lines) > 0).
func (s *TaxSettlementService) CanRegisterPayment(settlementID uint) (bool, error) {
	res, err := s.PaymentSuggestions(settlementID)
	if err != nil {
		return false, err
	}
	return len(res.Lines) > 0, nil
}

// Delete elimina la liquidación y revierte lo vinculado: pagos con tax_settlement_id (imputaciones y estados de deuda),
// referencia a liquidación en comprobantes fiscales, y deudas internas DEU-LIQ-* creadas al emitir.
// No elimina documentos de deudas externas (líneas document_ref).
func (s *TaxSettlementService) Delete(id uint) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		var ts models.TaxSettlement
		if err := tx.Preload("Lines", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).First(&ts, id).Error; err != nil {
			return err
		}

		paySvc := NewPaymentService()

		if ts.Status == models.TaxSettlementStatusIssued {
			var payIDs []uint
			if err := tx.Model(&models.Payment{}).Where("tax_settlement_id = ?", id).Pluck("id", &payIDs).Error; err != nil {
				return err
			}
			for _, pid := range payIDs {
				if err := paySvc.DeletePaymentTx(tx, pid); err != nil {
					return fmt.Errorf("no se pudo revertir el pago %d: %w", pid, err)
				}
			}
			if err := tx.Model(&models.TukifacFiscalReceipt{}).
				Where("tax_settlement_id = ?", id).
				Updates(map[string]interface{}{"tax_settlement_id": nil}).Error; err != nil {
				return err
			}
			for _, ln := range ts.Lines {
				if ln.DocumentID == nil || *ln.DocumentID == 0 {
					continue
				}
				if ln.LineType != models.TaxSettlementLineAdjust && ln.LineType != models.TaxSettlementLineTaxManual {
					continue
				}
				var d models.Document
				if err := tx.First(&d, *ln.DocumentID).Error; err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						continue
					}
					return err
				}
				wantNum := fmt.Sprintf("DEU-LIQ-%d-%d", ts.ID, ln.ID)
				if strings.TrimSpace(d.Source) != "liquidacion" || strings.TrimSpace(d.Number) != wantNum {
					continue
				}
				paid := DocumentPaidTotal(tx, d.ID)
				if paid >= 0.005 {
					return fmt.Errorf("la deuda %s aún tiene saldo abonado; no se puede eliminar la liquidación", wantNum)
				}
				var payCnt int64
				if err := tx.Model(&models.Payment{}).Where("document_id = ?", d.ID).Count(&payCnt).Error; err != nil {
					return err
				}
				if payCnt > 0 {
					return fmt.Errorf("existe un pago registrado sobre la deuda %s; elimínelo antes de borrar la liquidación", wantNum)
				}
				if err := tx.Where("document_id = ?", d.ID).Delete(&models.DocumentItem{}).Error; err != nil {
					return err
				}
				if err := tx.Delete(&models.Document{}, d.ID).Error; err != nil {
					return err
				}
			}
		}

		if err := tx.Where("tax_settlement_id = ?", id).Delete(&models.TaxSettlementLine{}).Error; err != nil {
			return err
		}
		res := tx.Delete(&models.TaxSettlement{}, id)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}
