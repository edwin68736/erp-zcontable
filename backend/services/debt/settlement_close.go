package debt

import (
	"errors"
	"fmt"
	"strings"

	"miappfiber/models"

	"gorm.io/gorm"
)

// ClosedSettlementDebtOrigin liquidación cerrada de la que provino una deuda.
type ClosedSettlementDebtOrigin struct {
	SettlementID     uint
	SettlementNumber string
	SettlementPeriod string
}

// SettlementDebtRow fila para API de deudas vinculadas / no vinculadas.
// SettlementAllowsDebtRelink true si una deuda puede desvincularse de esa liquidación para otra.
func SettlementAllowsDebtRelink(status string) bool {
	return strings.TrimSpace(status) == models.TaxSettlementStatusClosed
}

func (s *Service) settlementStatus(tx *gorm.DB, settlementID uint) (string, error) {
	if settlementID == 0 {
		return "", nil
	}
	var st models.TaxSettlement
	if err := tx.Select("status").First(&st, settlementID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", fmt.Errorf("liquidación no encontrada")
		}
		return "", err
	}
	return strings.TrimSpace(st.Status), nil
}

// AssertCanLinkDocumentToSettlement valida que la deuda pueda vincularse a la liquidación destino.
func (s *Service) AssertCanLinkDocumentToSettlement(tx *gorm.DB, d *models.Document, settlementID uint) error {
	return s.assertCanLinkDocumentToSettlement(tx, d, settlementID)
}

func (s *Service) assertCanLinkDocumentToSettlement(tx *gorm.DB, d *models.Document, settlementID uint) error {
	if d == nil {
		return errors.New("deuda no encontrada")
	}
	if d.TaxSettlementID == nil || *d.TaxSettlementID == 0 || *d.TaxSettlementID == settlementID {
		return nil
	}
	st, err := s.settlementStatus(tx, *d.TaxSettlementID)
	if err != nil {
		return err
	}
	if SettlementAllowsDebtRelink(st) {
		return nil
	}
	return fmt.Errorf("la deuda %s ya está vinculada a otra liquidación activa", d.Number)
}

// ClosedSettlementDebtOrigins mapa document_id → liquidación cerrada de origen.
func (s *Service) ClosedSettlementDebtOrigins(tx *gorm.DB, companyID uint) (map[uint]ClosedSettlementDebtOrigin, error) {
	return s.closedSettlementDebtOrigins(tx, companyID)
}

func (s *Service) closedSettlementDebtOrigins(tx *gorm.DB, companyID uint) (map[uint]ClosedSettlementDebtOrigin, error) {
	type row struct {
		DocumentID       uint
		SettlementID     uint
		SettlementNumber string
		SettlementPeriod string
	}
	var rows []row
	err := tx.Table("tax_settlement_lines AS tsl").
		Select("tsl.document_id AS document_id, ts.id AS settlement_id, ts.number AS settlement_number, ts.liquidation_period AS settlement_period").
		Joins("INNER JOIN tax_settlements AS ts ON ts.id = tsl.tax_settlement_id").
		Where("ts.company_id = ? AND ts.status = ? AND tsl.document_id IS NOT NULL AND tsl.document_id > 0", companyID, models.TaxSettlementStatusClosed).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[uint]ClosedSettlementDebtOrigin, len(rows))
	for _, r := range rows {
		if r.DocumentID == 0 {
			continue
		}
		out[r.DocumentID] = ClosedSettlementDebtOrigin{
			SettlementID:     r.SettlementID,
			SettlementNumber: strings.TrimSpace(r.SettlementNumber),
			SettlementPeriod: strings.TrimSpace(r.SettlementPeriod),
		}
	}
	return out, nil
}

func (s *Service) enrichUnlinkedWithClosedOrigins(tx *gorm.DB, companyID uint, rows []SettlementDebtRow) ([]SettlementDebtRow, error) {
	origins, err := s.closedSettlementDebtOrigins(tx, companyID)
	if err != nil {
		return nil, err
	}
	if len(origins) == 0 {
		return rows, nil
	}
	out := make([]SettlementDebtRow, 0, len(rows))
	for _, row := range rows {
		if origin, ok := origins[row.DocumentID]; ok {
			sid := origin.SettlementID
			row.SourceSettlementID = &sid
			row.SourceSettlementNumber = origin.SettlementNumber
			row.SourceSettlementPeriod = origin.SettlementPeriod
			row.FromPreviousSettlement = true
		}
		out = append(out, row)
	}
	return out, nil
}

// IsExcludedFromAutoPreview true si la deuda no debe precargarse al crear liquidación.
func (s *Service) IsExcludedFromAutoPreview(tx *gorm.DB, d *models.Document, closedOrigins map[uint]ClosedSettlementDebtOrigin) (bool, error) {
	return s.isExcludedFromAutoPreview(tx, d, closedOrigins)
}

func (s *Service) isExcludedFromAutoPreview(tx *gorm.DB, d *models.Document, closedOrigins map[uint]ClosedSettlementDebtOrigin) (bool, error) {
	if d == nil {
		return true, nil
	}
	if origin, ok := closedOrigins[d.ID]; ok {
		_ = origin
		if d.TaxSettlementID == nil || *d.TaxSettlementID == 0 {
			return true, nil
		}
	}
	if d.TaxSettlementID != nil && *d.TaxSettlementID > 0 {
		st, err := s.settlementStatus(tx, *d.TaxSettlementID)
		if err != nil {
			return false, err
		}
		if st != models.TaxSettlementStatusClosed {
			return true, nil
		}
	}
	return false, nil
}

// ListDebtsForSettlementView deudas vinculadas a la liquidación (histórico si está cerrada).
func (s *Service) ListDebtsForSettlementView(tx *gorm.DB, ts *models.TaxSettlement) ([]SettlementDebtRow, error) {
	if ts == nil {
		return nil, errors.New("liquidación no encontrada")
	}
	if ts.Status != models.TaxSettlementStatusClosed {
		return s.ListLinkedDebts(tx, ts.ID)
	}
	var lines []models.TaxSettlementLine
	if err := tx.Where("tax_settlement_id = ? AND document_id IS NOT NULL AND document_id > 0", ts.ID).
		Order("sort_order ASC, id ASC").
		Find(&lines).Error; err != nil {
		return nil, err
	}
	out := make([]SettlementDebtRow, 0, len(lines))
	for _, ln := range lines {
		if ln.DocumentID == nil || *ln.DocumentID == 0 {
			continue
		}
		row := SettlementDebtRow{
			DocumentID:    *ln.DocumentID,
			TotalAmount:   ln.Amount,
			HistoricalView: true,
		}
		if strings.TrimSpace(ln.DocumentNumberSnapshot) != "" {
			row.Number = strings.TrimSpace(ln.DocumentNumberSnapshot)
			row.Status = strings.TrimSpace(ln.DocumentStatusSnapshot)
			row.BalanceAmount = ln.DocumentBalanceSnapshot
		} else {
			var d models.Document
			if err := tx.First(&d, *ln.DocumentID).Error; err == nil {
				row.Number = d.Number
				row.Description = SanitizeDocumentDescription(d.Description)
				row.Status = d.Status
				row.BalanceAmount = s.EffectiveBalance(tx, &d)
				row.TotalAmount = d.TotalAmount
				row.AccountingPeriod = d.AccountingPeriod
				row.HasPeriod = d.HasPeriod
				row.PeriodMonth = d.PeriodMonth
				row.PeriodYear = d.PeriodYear
			}
		}
		if strings.TrimSpace(ln.Concept) != "" {
			row.Description = SanitizeDocumentDescription(ln.Concept)
		}
		if strings.TrimSpace(ln.PeriodYM) != "" {
			row.AccountingPeriod = strings.TrimSpace(ln.PeriodYM)
		}
		out = append(out, row)
	}
	return out, nil
}

// SnapshotAndReleaseOpenDebtsOnClose congela el estado de cada deuda en la línea y libera las pendientes.
func (s *Service) SnapshotAndReleaseOpenDebtsOnClose(tx *gorm.DB, settlementID uint, lines []models.TaxSettlementLine) error {
	for i := range lines {
		ln := &lines[i]
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
		bal := s.EffectiveBalance(tx, &d)
		updates := map[string]interface{}{
			"document_number_snapshot":  strings.TrimSpace(d.Number),
			"document_status_snapshot":  strings.TrimSpace(d.Status),
			"document_balance_snapshot": bal,
		}
		if err := tx.Model(&models.TaxSettlementLine{}).Where("id = ?", ln.ID).Updates(updates).Error; err != nil {
			return err
		}
		if bal <= MoneyEpsilon || strings.TrimSpace(d.Status) == StatusPaid {
			continue
		}
		if d.TaxSettlementID != nil && *d.TaxSettlementID == settlementID {
			if err := s.UnlinkSettlementFromDocument(tx, d.ID, settlementID); err != nil {
				return err
			}
		}
	}
	return nil
}
