package debt

import (
	"fmt"

	"miappfiber/models"

	"gorm.io/gorm"
)

// AuditSummary resultado de validación de integridad del dominio de deudas.
type AuditSummary struct {
	DEULIQCount              int64 `json:"deu_liq_count"`
	DEULIQActiveCount        int64 `json:"deu_liq_active_count"`
	DEULIQMergedCount        int64 `json:"deu_liq_merged_count"`
	DEULIQPromotedCount      int64 `json:"deu_liq_promoted_count"`
	LegacyPendingCount       int64 `json:"legacy_pending_count"`
	DuplicateSettlementGroups int64 `json:"duplicate_settlement_groups"`
	FragileReceipts          int64 `json:"fragile_receipts"`
	MissingSettlementLink    int64 `json:"missing_settlement_link"`
	OrphanSettlementDocs     int64 `json:"orphan_settlement_docs"`
	NegativeBalance          int64 `json:"negative_balance"`
	InconsistentBalance      int64 `json:"inconsistent_balance"`
	InvalidAllocations       int64 `json:"invalid_allocations"`
	InconsistentStatus       int64 `json:"inconsistent_status"`
	HasIssues                bool  `json:"has_issues"`
}

// RunIntegrityAudit ejecuta comprobaciones SQL de consistencia (solo lectura).
func RunIntegrityAudit(db *gorm.DB) (*AuditSummary, error) {
	if db == nil {
		return nil, fmt.Errorf("db requerida")
	}
	s := &AuditSummary{}
	type cnt struct{ N int64 }

	var c cnt
	if err := db.Raw(`SELECT COUNT(*) AS n FROM documents WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%'`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.DEULIQCount = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM documents
		WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%'
		  AND (legacy_status IS NULL OR legacy_status = '' OR legacy_status NOT IN ('legacy_merged','archived','legacy_promoted'))
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.DEULIQActiveCount = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM documents
		WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%' AND legacy_status = 'legacy_merged'
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.DEULIQMergedCount = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM documents
		WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%' AND legacy_status = 'legacy_promoted'
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.DEULIQPromotedCount = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM documents
		WHERE deleted_at IS NULL AND number LIKE 'DEU-LIQ-%'
		  AND (legacy_status IS NULL OR legacy_status = '' OR legacy_status NOT IN ('legacy_merged','archived','legacy_promoted'))
		  AND status <> 'anulado'
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.LegacyPendingCount = c.N

	c = cnt{}
	// Duplicidad real: DEU-LIQ pendiente con deuda hermana activa (misma liquidación y monto).
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM documents legacy
		WHERE legacy.deleted_at IS NULL AND legacy.number LIKE 'DEU-LIQ-%'
		  AND (legacy.legacy_status IS NULL OR legacy.legacy_status = '' OR legacy.legacy_status NOT IN ('legacy_merged','archived','legacy_promoted'))
		  AND legacy.status <> 'anulado'
		  AND EXISTS (
		    SELECT 1 FROM documents sibling
		    WHERE sibling.deleted_at IS NULL AND sibling.id <> legacy.id
		      AND sibling.company_id = legacy.company_id
		      AND sibling.tax_settlement_id = legacy.tax_settlement_id
		      AND ABS(sibling.total_amount - legacy.total_amount) <= 0.02
		      AND sibling.number NOT LIKE 'DEU-LIQ-%'
		      AND (sibling.legacy_status IS NULL OR sibling.legacy_status = '' OR sibling.legacy_status NOT IN ('legacy_merged','archived'))
		      AND sibling.status <> 'anulado'
		  )
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.DuplicateSettlementGroups = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM tukifac_fiscal_receipts r
		WHERE r.deleted_at IS NULL AND r.linked_payment_id IS NOT NULL
		  AND (r.debt_payment_context_json IS NULL OR TRIM(r.debt_payment_context_json) = '')
		  AND NOT EXISTS (SELECT 1 FROM fiscal_receipt_lines l WHERE l.fiscal_receipt_id = r.id)
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.FragileReceipts = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM tax_settlement_lines tsl
		JOIN documents d ON d.id = tsl.document_id AND d.deleted_at IS NULL
		WHERE tsl.document_id IS NOT NULL
		  AND (d.tax_settlement_id IS NULL OR d.tax_settlement_id <> tsl.tax_settlement_id)
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.MissingSettlementLink = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM documents d
		LEFT JOIN tax_settlements ts ON ts.id = d.tax_settlement_id AND ts.deleted_at IS NULL
		WHERE d.deleted_at IS NULL AND d.tax_settlement_id IS NOT NULL AND ts.id IS NULL
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.OrphanSettlementDocs = c.N

	c = cnt{}
	if err := db.Raw(`SELECT COUNT(*) AS n FROM documents WHERE deleted_at IS NULL AND balance_amount < -0.005`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.NegativeBalance = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM documents d
		WHERE d.deleted_at IS NULL AND d.status <> 'anulado'
		  AND ABS(
		    d.balance_amount - GREATEST(0, d.total_amount - COALESCE((
		      SELECT SUM(pa.amount) FROM payment_allocations pa
		      JOIN payments p ON p.id = pa.payment_id AND p.deleted_at IS NULL
		      WHERE pa.document_id = d.id AND pa.deleted_at IS NULL
		    ), 0) - COALESCE((
		      SELECT SUM(p.amount) FROM payments p
		      WHERE p.document_id = d.id AND p.deleted_at IS NULL
		        AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = p.id AND pa.deleted_at IS NULL)
		    ), 0))
		  ) > 0.02
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.InconsistentBalance = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM payment_allocations pa
		LEFT JOIN documents d ON d.id = pa.document_id AND d.deleted_at IS NULL
		WHERE pa.deleted_at IS NULL AND d.id IS NULL
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.InvalidAllocations = c.N

	c = cnt{}
	if err := db.Raw(`
		SELECT COUNT(*) AS n FROM documents d
		WHERE d.deleted_at IS NULL AND d.status <> 'anulado'
		  AND (
		    (d.balance_amount <= 0.005 AND d.status <> 'pagado')
		    OR (d.balance_amount > 0.005 AND d.balance_amount + 0.005 >= d.total_amount AND d.status <> 'pendiente')
		    OR (d.balance_amount > 0.005 AND d.balance_amount + 0.005 < d.total_amount AND d.status NOT IN ('parcial', 'pendiente'))
		  )
	`).Scan(&c).Error; err != nil {
		return nil, err
	}
	s.InconsistentStatus = c.N

	s.HasIssues = s.MissingSettlementLink > 0 || s.OrphanSettlementDocs > 0 ||
		s.NegativeBalance > 0 || s.InconsistentBalance > 0 || s.InvalidAllocations > 0 || s.InconsistentStatus > 0 ||
		s.LegacyPendingCount > 0 || s.DuplicateSettlementGroups > 0 || s.FragileReceipts > 0
	return s, nil
}

// DocumentStatementRow fila para reporte de deudas.
type DocumentStatementRow struct {
	DocumentID       uint    `json:"document_id"`
	CompanyID        uint    `json:"company_id"`
	Number           string  `json:"number"`
	Description      string  `json:"description"`
	TotalAmount      float64 `json:"total_amount"`
	BalanceAmount    float64 `json:"balance_amount"`
	PaidAmount       float64 `json:"paid_amount"`
	Status           string  `json:"status"`
	TaxSettlementID  *uint   `json:"tax_settlement_id,omitempty"`
	SettlementNumber string  `json:"settlement_number,omitempty"`
	PeriodDisplay    string  `json:"period_display"`
	HasPeriod        bool    `json:"has_period"`
}

// ListDocumentReportRows deudas con saldo persistido para reportes (Fase 6).
func (s *Service) ListDocumentReportRows(db *gorm.DB, companyID uint, allowedCompanyIDs []uint) ([]DocumentStatementRow, error) {
	q := db.Model(&models.Document{}).Where("status <> ?", StatusCancelled)
	ScopeActiveDocuments(q)
	if companyID > 0 {
		q = q.Where("company_id = ?", companyID)
	} else if allowedCompanyIDs != nil {
		if len(allowedCompanyIDs) == 0 {
			return []DocumentStatementRow{}, nil
		}
		q = q.Where("company_id IN ?", allowedCompanyIDs)
	}
	var docs []models.Document
	if err := q.Order("issue_date DESC, id DESC").Find(&docs).Error; err != nil {
		return nil, err
	}
	settlementNums := map[uint]string{}
	var tsIDs []uint
	for _, d := range docs {
		if d.TaxSettlementID != nil && *d.TaxSettlementID > 0 {
			tsIDs = append(tsIDs, *d.TaxSettlementID)
		}
	}
	if len(tsIDs) > 0 {
		var settlements []models.TaxSettlement
		if err := db.Where("id IN ?", tsIDs).Find(&settlements).Error; err != nil {
			return nil, err
		}
		for _, ts := range settlements {
			settlementNums[ts.ID] = ts.Number
		}
	}
	out := make([]DocumentStatementRow, 0, len(docs))
	for _, d := range docs {
		bal := s.EffectiveBalance(db, &d)
		paid := roundMoney(d.TotalAmount - bal)
		if paid < 0 {
			paid = 0
		}
		row := DocumentStatementRow{
			DocumentID:    d.ID,
			CompanyID:     d.CompanyID,
			Number:        d.Number,
			Description:   d.Description,
			TotalAmount:   d.TotalAmount,
			BalanceAmount: bal,
			PaidAmount:    paid,
			Status:        d.Status,
			HasPeriod:     d.HasPeriod,
			PeriodDisplay: PeriodDisplayMMYYYY(&d),
		}
		if d.TaxSettlementID != nil {
			row.TaxSettlementID = d.TaxSettlementID
			row.SettlementNumber = settlementNums[*d.TaxSettlementID]
		}
		out = append(out, row)
	}
	return out, nil
}
