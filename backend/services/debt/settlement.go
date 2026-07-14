package debt

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

// ParseDEULIQNumber extrae tax_settlement_id desde número legacy DEU-LIQ-{settlementId}-{lineId}.
func ParseDEULIQNumber(number string) (settlementID uint, ok bool) {
	n := strings.TrimSpace(number)
	const prefix = "DEU-LIQ-"
	if !strings.HasPrefix(n, prefix) {
		return 0, false
	}
	rest := strings.TrimPrefix(n, prefix)
	parts := strings.Split(rest, "-")
	if len(parts) < 2 {
		return 0, false
	}
	sid, err := strconv.ParseUint(parts[0], 10, 32)
	if err != nil || sid == 0 {
		return 0, false
	}
	return uint(sid), true
}

// ParseDEULIQFull extrae tax_settlement_id y tax_settlement_line id desde DEU-LIQ-{settlementId}-{lineId}.
func ParseDEULIQFull(number string) (settlementID, lineID uint, ok bool) {
	n := strings.TrimSpace(number)
	const prefix = "DEU-LIQ-"
	if !strings.HasPrefix(n, prefix) {
		return 0, 0, false
	}
	rest := strings.TrimPrefix(n, prefix)
	parts := strings.Split(rest, "-")
	if len(parts) < 2 {
		return 0, 0, false
	}
	sid, err := strconv.ParseUint(parts[0], 10, 32)
	if err != nil || sid == 0 {
		return 0, 0, false
	}
	lid, err := strconv.ParseUint(parts[len(parts)-1], 10, 32)
	if err != nil || lid == 0 {
		return uint(sid), 0, false
	}
	return uint(sid), uint(lid), true
}

// IsLegacySettlementClone indica deuda generada con patrón DEU-LIQ (pre-refactor).
func IsLegacySettlementClone(d *models.Document) bool {
	if d == nil {
		return false
	}
	if strings.TrimSpace(strings.ToLower(d.Source)) != "liquidacion" {
		return false
	}
	_, ok := ParseDEULIQNumber(d.Number)
	return ok
}

// IsSettlementOwnedDebt deuda creada por liquidación (legacy DEU-LIQ o tax_settlement_id).
func IsSettlementOwnedDebt(d *models.Document, settlementID uint) bool {
	if d == nil {
		return false
	}
	if d.TaxSettlementID != nil && *d.TaxSettlementID == settlementID {
		return strings.TrimSpace(strings.ToLower(d.Source)) == "liquidacion" ||
			d.Type == models.DocumentTypeLiquidacion ||
			IsLegacySettlementClone(d)
	}
	if IsLegacySettlementClone(d) {
		if sid, ok := ParseDEULIQNumber(d.Number); ok && sid == settlementID {
			return true
		}
	}
	return false
}

func allocateShortDebtNumber(tx *gorm.DB, companyID uint) (string, error) {
	var count int64
	if err := tx.Model(&models.Document{}).Where("company_id = ?", companyID).Count(&count).Error; err != nil {
		return "", err
	}
	for try := 0; try < 10000; try++ {
		v := uint64(count) + 1 + uint64(try)
		candidate := fmt.Sprintf("%06d", v%1000000)
		var exists int64
		if err := tx.Model(&models.Document{}).
			Where("company_id = ? AND number = ?", companyID, candidate).
			Count(&exists).Error; err != nil {
			return "", err
		}
		if exists == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("no se pudo generar un número de deuda único")
}

type settlementLineDebtInput struct {
	LineType   string
	DocumentID *uint
	ProductID  *uint
	Concept    string
	Amount     float64
	PeriodYM   string
	PeriodDate *time.Time
}

// EnsureSettlementLineDebts vincula o crea UN documento por línea (sin clonar DEU-LIQ al emitir).
func (s *Service) EnsureSettlementLineDebts(
	tx *gorm.DB,
	settlementID, companyID uint,
	issueDate time.Time,
	liquidationPeriod string,
	lines []models.TaxSettlementLine,
) error {
	svc := s
	for i := range lines {
		ln := &lines[i]
		in := settlementLineDebtInput{
			LineType:   ln.LineType,
			DocumentID: ln.DocumentID,
			ProductID:  ln.ProductID,
			Concept:    ln.Concept,
			Amount:     ln.Amount,
			PeriodYM:   ln.PeriodYM,
			PeriodDate: ln.PeriodDate,
		}
		docID, err := svc.ensureLineDebt(tx, settlementID, companyID, issueDate, liquidationPeriod, in)
		if err != nil {
			return err
		}
		if docID > 0 && (ln.DocumentID == nil || *ln.DocumentID != docID) {
			if err := tx.Model(&models.TaxSettlementLine{}).Where("id = ?", ln.ID).Update("document_id", docID).Error; err != nil {
				return err
			}
			ln.DocumentID = &docID
		}
	}
	return nil
}

func (s *Service) ensureLineDebt(
	tx *gorm.DB,
	settlementID, companyID uint,
	issueDate time.Time,
	liquidationPeriod string,
	ln settlementLineDebtInput,
) (uint, error) {
	switch ln.LineType {
	case models.TaxSettlementLineDocRef:
		if ln.DocumentID == nil || *ln.DocumentID == 0 {
			return 0, errors.New("document_ref sin document_id")
		}
		return s.linkDocumentToSettlement(tx, *ln.DocumentID, companyID, settlementID)
	case models.TaxSettlementLineAdjust, models.TaxSettlementLineTaxManual:
		if ln.DocumentID != nil && *ln.DocumentID > 0 {
			return s.linkDocumentToSettlement(tx, *ln.DocumentID, companyID, settlementID)
		}
		if ln.Amount < MoneyEpsilon {
			return 0, nil
		}
		return s.createSettlementDebtDocument(tx, settlementID, companyID, issueDate, liquidationPeriod, ln)
	default:
		return 0, nil
	}
}

func (s *Service) linkDocumentToSettlement(tx *gorm.DB, documentID, companyID, settlementID uint) (uint, error) {
	var d models.Document
	if err := tx.First(&d, documentID).Error; err != nil {
		return 0, err
	}
	if d.CompanyID != companyID {
		return 0, errors.New("el documento no pertenece a la empresa de la liquidación")
	}
	if err := s.assertCanLinkDocumentToSettlement(tx, &d, settlementID); err != nil {
		return 0, err
	}
	if err := tx.Model(&models.Document{}).Where("id = ?", documentID).
		Update("tax_settlement_id", settlementID).Error; err != nil {
		return 0, err
	}
	return documentID, nil
}

func (s *Service) createSettlementDebtDocument(
	tx *gorm.DB,
	settlementID, companyID uint,
	issueDate time.Time,
	liquidationPeriod string,
	ln settlementLineDebtInput,
) (uint, error) {
	y, mo, d := issueDate.Date()
	issue := time.Date(y, mo, d, 0, 0, 0, 0, issueDate.Location())
	periodYM := strings.TrimSpace(ln.PeriodYM)
	if periodYM == "" && ln.PeriodDate != nil && !ln.PeriodDate.IsZero() {
		periodYM = ln.PeriodDate.Format("2006-01")
	}
	if periodYM == "" {
		periodYM = strings.TrimSpace(liquidationPeriod)
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
	acct := periodYM
	if len(acct) > 64 {
		acct = acct[:64]
	}
	num, err := allocateShortDebtNumber(tx, companyID)
	if err != nil {
		return 0, err
	}
	doc := models.Document{
		CompanyID:        companyID,
		TaxSettlementID:  &settlementID,
		Type:             models.DocumentTypeLiquidacion,
		Number:           num,
		IssueDate:        issue,
		TotalAmount:      math.Round(ln.Amount*100) / 100,
		Description:      desc,
		ServiceMonth:     acct,
		AccountingPeriod: acct,
		Status:           StatusPending,
		Source:           "liquidacion",
	}
	s.InitBalanceOnCreate(&doc)
	ApplyPeriodFromString(&doc, periodYM, acct)
	if err := tx.Omit("Company", "Payments", "Allocations", "Items", "TaxSettlement").Create(&doc).Error; err != nil {
		return 0, err
	}
	return doc.ID, nil
}

// UnlinkSettlementFromDocument quita vínculo de liquidación (document_ref al revertir).
func (s *Service) UnlinkSettlementFromDocument(tx *gorm.DB, documentID, settlementID uint) error {
	return tx.Model(&models.Document{}).
		Where("id = ? AND tax_settlement_id = ?", documentID, settlementID).
		Update("tax_settlement_id", nil).Error
}

// SettlementDebtRow fila para API de deudas vinculadas / no vinculadas.
type SettlementDebtRow struct {
	DocumentID       uint    `json:"document_id"`
	Number           string  `json:"number"`
	Description      string  `json:"description"`
	TotalAmount      float64 `json:"total_amount"`
	BalanceAmount    float64 `json:"balance_amount"`
	Status           string  `json:"status"`
	AccountingPeriod string  `json:"accounting_period,omitempty"`
	HasPeriod        bool    `json:"has_period"`
	PeriodMonth      *int16  `json:"period_month,omitempty"`
	PeriodYear       *int16  `json:"period_year,omitempty"`
	SourceSettlementID       *uint  `json:"source_settlement_id,omitempty"`
	SourceSettlementNumber   string `json:"source_settlement_number,omitempty"`
	SourceSettlementPeriod   string `json:"source_settlement_period,omitempty"`
	FromPreviousSettlement   bool   `json:"from_previous_settlement,omitempty"`
	HistoricalView           bool   `json:"historical_view,omitempty"`
}

// ListLinkedDebts deudas con tax_settlement_id = settlementID.
func (s *Service) ListLinkedDebts(tx *gorm.DB, settlementID uint) ([]SettlementDebtRow, error) {
	var docs []models.Document
	q := tx.Where("tax_settlement_id = ?", settlementID)
	ScopeActiveDocuments(q)
	if err := q.Order("issue_date ASC, id ASC").Find(&docs).Error; err != nil {
		return nil, err
	}
	return s.toSettlementDebtRows(tx, docs), nil
}

// ListUnlinkedOpenDebts deudas abiertas de la empresa no vinculadas a ninguna liquidación.
func (s *Service) ListUnlinkedOpenDebts(tx *gorm.DB, companyID uint) ([]SettlementDebtRow, error) {
	var docs []models.Document
	if err := tx.Where("company_id = ? AND tax_settlement_id IS NULL", companyID).
		Where("status NOT IN ?", []string{StatusPaid, StatusCancelled, StatusExonerado}).
		Where("balance_amount > ?", MoneyEpsilon).
		Where("legacy_status IS NULL OR legacy_status = '' OR legacy_status NOT IN ?", []string{LegacyStatusMerged, LegacyStatusArchived}).
		Order("issue_date ASC, id ASC").
		Find(&docs).Error; err != nil {
		return nil, err
	}
	out := s.toSettlementDebtRows(tx, docs)
	filtered := make([]SettlementDebtRow, 0, len(out))
	for _, row := range out {
		if row.BalanceAmount > MoneyEpsilon {
			filtered = append(filtered, row)
		}
	}
	return s.enrichUnlinkedWithClosedOrigins(tx, companyID, filtered)
}

// CleanupSettlementDebtsNotInLines desvincula o elimina deudas ya no referenciadas en líneas del borrador.
func (s *Service) CleanupSettlementDebtsNotInLines(
	tx *gorm.DB,
	settlementID, companyID uint,
	keptDocumentIDs map[uint]bool,
) error {
	var docs []models.Document
	if err := tx.Where("tax_settlement_id = ?", settlementID).Find(&docs).Error; err != nil {
		return err
	}
	for i := range docs {
		d := &docs[i]
		if keptDocumentIDs[d.ID] {
			continue
		}
		if IsSettlementOwnedDebt(d, settlementID) {
			paid := s.PaidTotal(tx, d.ID)
			if paid >= MoneyEpsilon {
				return fmt.Errorf("la deuda %s tiene pagos; no se puede quitar de la liquidación", d.Number)
			}
			var payCnt int64
			if err := tx.Model(&models.Payment{}).Where("document_id = ?", d.ID).Count(&payCnt).Error; err != nil {
				return err
			}
			if payCnt > 0 {
				return fmt.Errorf("existe un pago registrado sobre la deuda %s", d.Number)
			}
			if err := tx.Where("document_id = ?", d.ID).Delete(&models.DocumentItem{}).Error; err != nil {
				return err
			}
			if err := tx.Delete(&models.Document{}, d.ID).Error; err != nil {
				return err
			}
			continue
		}
		if d.CompanyID != companyID {
			continue
		}
		if err := s.UnlinkSettlementFromDocument(tx, d.ID, settlementID); err != nil {
			return err
		}
	}
	return nil
}

// PurgeSettlementDocumentsOnDelete limpia documentos al eliminar una liquidación emitida.
func (s *Service) PurgeSettlementDocumentsOnDelete(tx *gorm.DB, ts *models.TaxSettlement, lines []models.TaxSettlementLine) error {
	if ts == nil {
		return nil
	}
	for _, ln := range lines {
		if ln.DocumentID == nil || *ln.DocumentID == 0 {
			continue
		}
		var d models.Document
		if err := tx.First(&d, *ln.DocumentID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return err
		}
		switch ln.LineType {
		case models.TaxSettlementLineDocRef:
			if err := s.UnlinkSettlementFromDocument(tx, d.ID, ts.ID); err != nil {
				return err
			}
		case models.TaxSettlementLineAdjust, models.TaxSettlementLineTaxManual:
			if !IsSettlementOwnedDebt(&d, ts.ID) && !IsLegacySettlementClone(&d) {
				continue
			}
			paid := s.PaidTotal(tx, d.ID)
			if paid >= MoneyEpsilon {
				return fmt.Errorf("la deuda %s aún tiene saldo abonado; no se puede eliminar la liquidación", d.Number)
			}
			var payCnt int64
			if err := tx.Model(&models.Payment{}).Where("document_id = ?", d.ID).Count(&payCnt).Error; err != nil {
				return err
			}
			if payCnt > 0 {
				return fmt.Errorf("existe un pago registrado sobre la deuda %s; elimínelo antes de borrar la liquidación", d.Number)
			}
			if err := tx.Where("document_id = ?", d.ID).Delete(&models.DocumentItem{}).Error; err != nil {
				return err
			}
			if err := tx.Delete(&models.Document{}, d.ID).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) toSettlementDebtRows(tx *gorm.DB, docs []models.Document) []SettlementDebtRow {
	out := make([]SettlementDebtRow, 0, len(docs))
	for _, d := range docs {
		bal := s.EffectiveBalance(tx, &d)
		out = append(out, SettlementDebtRow{
			DocumentID:       d.ID,
			Number:           d.Number,
			Description:      SanitizeDocumentDescription(d.Description),
			TotalAmount:      d.TotalAmount,
			BalanceAmount:    bal,
			Status:           d.Status,
			AccountingPeriod: d.AccountingPeriod,
			HasPeriod:        d.HasPeriod,
			PeriodMonth:      d.PeriodMonth,
			PeriodYear:       d.PeriodYear,
		})
	}
	return out
}
