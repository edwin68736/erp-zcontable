package debt

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

const migLegacyConsolidationName = "documents_v3_legacy_consolidation"
const migRevertWrongMergesName = "documents_v3b_revert_wrong_line_merges"

// ConsolidationMergeRecord deuda legacy fusionada en canónica.
type ConsolidationMergeRecord struct {
	LegacyDocumentID    uint    `json:"legacy_document_id"`
	LegacyNumber        string  `json:"legacy_number"`
	CanonicalDocumentID uint    `json:"canonical_document_id"`
	CanonicalNumber     string  `json:"canonical_number"`
	TaxSettlementID     uint    `json:"tax_settlement_id"`
	Amount              float64 `json:"amount"`
	AllocationsMoved    int     `json:"allocations_moved"`
	LinesUpdated        int     `json:"lines_updated"`
}

// ConsolidationConflict conflicto no resuelto automáticamente.
type ConsolidationConflict struct {
	LegacyDocumentID uint   `json:"legacy_document_id"`
	LegacyNumber     string `json:"legacy_number"`
	Reason           string `json:"reason"`
}

// ConsolidationReport resultado de consolidación legacy.
type ConsolidationReport struct {
	MigrationName      string                     `json:"migration_name"`
	Merged             []ConsolidationMergeRecord `json:"merged"`
	Promoted           []uint                     `json:"promoted_document_ids"`
	Conflicts          []ConsolidationConflict    `json:"conflicts"`
	BalancesNormalized int                        `json:"balances_normalized"`
	DryRun             bool                       `json:"dry_run"`
}

// RunLegacyDEULIQConsolidation fusiona o promueve DEU-LIQ-* al dominio canónico (sin borrar filas).
func RunLegacyDEULIQConsolidation(db *gorm.DB, dryRun bool) (*ConsolidationReport, error) {
	if db == nil {
		return nil, fmt.Errorf("db requerida")
	}
	report := &ConsolidationReport{
		MigrationName: migLegacyConsolidationName,
		DryRun:        dryRun,
		Merged:        []ConsolidationMergeRecord{},
		Promoted:      []uint{},
		Conflicts:     []ConsolidationConflict{},
	}
	svc := NewService()

	if !dryRun {
		if err := revertWrongDuplicateMerges(db, svc, report); err != nil {
			return report, err
		}
		if err := fixIncorrectlyAnuladoPromoted(db, svc); err != nil {
			return report, err
		}
	}

	var legacyDocs []models.Document
	if err := db.Where("number LIKE ?", "DEU-LIQ-%").
		Where("legacy_status IS NULL OR legacy_status = '' OR legacy_status NOT IN ?", legacyExcludedStatuses).
		Find(&legacyDocs).Error; err != nil {
		return nil, err
	}

	for i := range legacyDocs {
		legacy := &legacyDocs[i]
		sid, lineID, ok := ParseDEULIQFull(legacy.Number)
		if !ok {
			if sid2, ok2 := ParseDEULIQNumber(legacy.Number); ok2 {
				sid = sid2
			} else {
				report.Conflicts = append(report.Conflicts, ConsolidationConflict{
					LegacyDocumentID: legacy.ID,
					LegacyNumber:     legacy.Number,
					Reason:           "número DEU-LIQ no parseable",
				})
				continue
			}
		}

		canonical, findErr := findCanonicalForLegacy(db, legacy, sid, lineID)
		if findErr != nil {
			report.Conflicts = append(report.Conflicts, ConsolidationConflict{
				LegacyDocumentID: legacy.ID,
				LegacyNumber:     legacy.Number,
				Reason:           findErr.Error(),
			})
			continue
		}

		if canonical != nil && canonical.ID != legacy.ID {
			rec := ConsolidationMergeRecord{
				LegacyDocumentID:    legacy.ID,
				LegacyNumber:        legacy.Number,
				CanonicalDocumentID: canonical.ID,
				CanonicalNumber:     canonical.Number,
				TaxSettlementID:     sid,
				Amount:              legacy.TotalAmount,
			}
			if dryRun {
				report.Merged = append(report.Merged, rec)
				continue
			}
			err := db.Transaction(func(tx *gorm.DB) error {
				moved, lines, _, err := mergeLegacyIntoCanonical(tx, svc, legacy, canonical)
				if err != nil {
					return err
				}
				rec.AllocationsMoved = moved
				rec.LinesUpdated = lines
				return logConsolidation(tx, migLegacyConsolidationName, "merge_legacy", legacy.ID, &canonical.ID, nil, rec)
			})
			if err != nil {
				report.Conflicts = append(report.Conflicts, ConsolidationConflict{
					LegacyDocumentID: legacy.ID,
					LegacyNumber:     legacy.Number,
					Reason:           err.Error(),
				})
				continue
			}
			if !dryRun {
				_ = svc.PersistBalanceAndStatus(db, canonical.ID)
			}
			report.Merged = append(report.Merged, rec)
			continue
		}

		if dryRun {
			report.Promoted = append(report.Promoted, legacy.ID)
			continue
		}

		err := db.Transaction(func(tx *gorm.DB) error {
			return promoteLegacyAsCanonical(tx, svc, legacy, sid, lineID)
		})
		if err != nil {
			report.Conflicts = append(report.Conflicts, ConsolidationConflict{
				LegacyDocumentID: legacy.ID,
				LegacyNumber:     legacy.Number,
				Reason:           err.Error(),
			})
			continue
		}
		report.Promoted = append(report.Promoted, legacy.ID)
	}

	if !dryRun {
		if err := backfillPromotedLegacyStatus(db, report); err != nil {
			return report, err
		}
		if err := consolidateDuplicateDEULIQGroups(db, svc, report); err != nil {
			return report, err
		}
	}

	var activeIDs []uint
	q := db.Model(&models.Document{}).Select("id")
	ScopeActiveDocuments(q).Pluck("id", &activeIDs)
	for _, id := range activeIDs {
		if dryRun {
			var d models.Document
			if err := db.First(&d, id).Error; err != nil {
				continue
			}
			paid := svc.PaidTotal(db, id)
			calcBal := BalanceFromTotalPaid(d.TotalAmount, paid)
			if math.Abs(d.BalanceAmount-calcBal) > 0.02 {
				report.BalancesNormalized++
			}
			continue
		}
		if err := svc.PersistBalanceAndStatus(db, id); err != nil {
			log.Printf("[consolidation] balance fix doc %d: %v", id, err)
			continue
		}
		report.BalancesNormalized++
	}

	return report, nil
}

func findCanonicalForLegacy(db *gorm.DB, legacy *models.Document, settlementID, lineID uint) (*models.Document, error) {
	if legacy == nil {
		return nil, fmt.Errorf("legacy nulo")
	}

	if lineID > 0 {
		var ln models.TaxSettlementLine
		if err := db.First(&ln, lineID).Error; err == nil {
			if ln.DocumentID != nil && *ln.DocumentID > 0 && *ln.DocumentID != legacy.ID {
				var d models.Document
				if err := db.First(&d, *ln.DocumentID).Error; err == nil && IsActiveDebt(&d) && !IsLegacySettlementClone(&d) {
					return &d, nil
				}
			}
		}
	}

	var candidates []models.Document
	q := db.Where("company_id = ? AND id <> ?", legacy.CompanyID, legacy.ID)
	ScopeActiveDocuments(q)
	if settlementID > 0 {
		q = q.Where("tax_settlement_id = ?", settlementID)
	}
	if err := q.Where("number NOT LIKE ?", "DEU-LIQ-%").
		Where("ABS(total_amount - ?) <= ?", legacy.TotalAmount, 0.02).
		Find(&candidates).Error; err != nil {
		return nil, err
	}
	if len(candidates) == 1 {
		return &candidates[0], nil
	}
	if len(candidates) > 1 {
		if lineID > 0 {
			var ln models.TaxSettlementLine
			if err := db.Where("tax_settlement_id = ? AND id = ?", settlementID, lineID).First(&ln).Error; err == nil {
				if ln.DocumentID != nil {
					for i := range candidates {
						if candidates[i].ID == *ln.DocumentID {
							return &candidates[i], nil
						}
					}
				}
			}
		}
		return nil, fmt.Errorf("múltiples candidatos canónicos (%d) para %s", len(candidates), legacy.Number)
	}

	return nil, nil
}

// revertWrongDuplicateMerges deshace fusiones por monto (líneas distintas) sin pagos movidos.
func revertWrongDuplicateMerges(db *gorm.DB, svc *Service, report *ConsolidationReport) error {
	var logs []models.DocumentConsolidationLog
	if err := db.Where("action = ? AND migration_name = ?", "merge_duplicate_group", migLegacyConsolidationName).
		Find(&logs).Error; err != nil {
		return err
	}
	for _, entry := range logs {
		if entry.LegacyDocumentID == nil || entry.CanonicalDocumentID == nil {
			continue
		}
		legacyID := *entry.LegacyDocumentID
		var legacy models.Document
		if err := db.First(&legacy, legacyID).Error; err != nil {
			continue
		}
		if legacy.LegacyStatus != LegacyStatusMerged {
			continue
		}
		sid, lineID, ok := ParseDEULIQFull(legacy.Number)
		if !ok || lineID == 0 {
			continue
		}
		canonLineID := uint(0)
		var canon models.Document
		if err := db.First(&canon, *entry.CanonicalDocumentID).Error; err == nil {
			if _, cl, ok2 := ParseDEULIQFull(canon.Number); ok2 {
				canonLineID = cl
			}
		}
		if canonLineID > 0 && lineID == canonLineID {
			continue
		}
		var paidOnLegacy int64
		db.Model(&models.PaymentAllocation{}).
			Joins("JOIN payments p ON p.id = payment_allocations.payment_id AND p.deleted_at IS NULL").
			Where("payment_allocations.document_id = ?", legacyID).
			Count(&paidOnLegacy)
		if paidOnLegacy > 0 {
			report.Conflicts = append(report.Conflicts, ConsolidationConflict{
				LegacyDocumentID: legacyID,
				LegacyNumber:     legacy.Number,
				Reason:           "revert omitido: legacy tiene imputaciones",
			})
			continue
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&models.TaxSettlementLine{}).
				Where("id = ? AND tax_settlement_id = ?", lineID, sid).
				Update("document_id", legacyID).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.Document{}).Where("id = ?", legacyID).Updates(map[string]interface{}{
				"legacy_status":           LegacyStatusPromoted,
				"merged_into_document_id": nil,
				"status":                  StatusPending,
			}).Error; err != nil {
				return err
			}
			return logConsolidation(tx, migRevertWrongMergesName, "revert_wrong_merge", legacyID, entry.CanonicalDocumentID, nil, map[string]interface{}{
				"line_id": lineID, "settlement_id": sid,
			})
		})
		if err != nil {
			report.Conflicts = append(report.Conflicts, ConsolidationConflict{
				LegacyDocumentID: legacyID,
				LegacyNumber:     legacy.Number,
				Reason:           err.Error(),
			})
			continue
		}
		_ = svc.PersistBalanceAndStatus(db, legacyID)
	}
	return nil
}

// fixIncorrectlyAnuladoPromoted recalcula deudas promovidas que quedaron anuladas por fusiones revertidas.
func fixIncorrectlyAnuladoPromoted(db *gorm.DB, svc *Service) error {
	var ids []uint
	if err := db.Raw(`
		SELECT id FROM documents
		WHERE deleted_at IS NULL AND legacy_status = ?
		  AND status = ? AND merged_into_document_id IS NULL
	`, LegacyStatusPromoted, StatusCancelled).Scan(&ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		if err := db.Model(&models.Document{}).Where("id = ?", id).Update("status", StatusPending).Error; err != nil {
			return err
		}
		if err := svc.PersistBalanceAndStatus(db, id); err != nil {
			return err
		}
	}
	return nil
}

// backfillPromotedLegacyStatus marca DEU-LIQ ya promovidos en ejecuciones previas (sin legacy_status).
func backfillPromotedLegacyStatus(db *gorm.DB, report *ConsolidationReport) error {
	var ids []uint
	if err := db.Raw(`
		SELECT DISTINCT d.id FROM documents d
		INNER JOIN document_consolidation_logs l ON l.legacy_document_id = d.id AND l.action = 'promote_liq'
		WHERE d.deleted_at IS NULL AND d.number LIKE 'DEU-LIQ-%'
		  AND (d.legacy_status IS NULL OR d.legacy_status = '')
	`).Scan(&ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		if err := db.Model(&models.Document{}).Where("id = ?", id).Update("legacy_status", LegacyStatusPromoted).Error; err != nil {
			return err
		}
		report.Promoted = append(report.Promoted, id)
	}
	return nil
}

func migrateLegacyReferences(tx *gorm.DB, svc *Service, legacy, canonical *models.Document) (allocMoved, linesUpdated int, err error) {
	if legacy == nil || canonical == nil {
		return 0, 0, fmt.Errorf("documentos inválidos")
	}

	var allocs []models.PaymentAllocation
	if err := tx.Where("document_id = ?", legacy.ID).Find(&allocs).Error; err != nil {
		return 0, 0, err
	}
	for _, a := range allocs {
		var existing models.PaymentAllocation
		exErr := tx.Where("payment_id = ? AND document_id = ?", a.PaymentID, canonical.ID).First(&existing).Error
		if exErr == nil {
			newAmt := roundMoney(existing.Amount + a.Amount)
			if err := tx.Model(&models.PaymentAllocation{}).Where("id = ?", existing.ID).Update("amount", newAmt).Error; err != nil {
				return allocMoved, linesUpdated, err
			}
			if err := tx.Delete(&models.PaymentAllocation{}, a.ID).Error; err != nil {
				return allocMoved, linesUpdated, err
			}
		} else {
			if err := tx.Model(&models.PaymentAllocation{}).Where("id = ?", a.ID).Update("document_id", canonical.ID).Error; err != nil {
				return allocMoved, linesUpdated, err
			}
		}
		allocMoved++
		_ = logConsolidation(tx, migLegacyConsolidationName, "migrate_allocation", legacy.ID, &canonical.ID, &a.PaymentID, map[string]interface{}{
			"allocation_id": a.ID, "amount": a.Amount,
		})
	}

	if err := tx.Model(&models.Payment{}).
		Where("document_id = ? AND deleted_at IS NULL", legacy.ID).
		Update("document_id", canonical.ID).Error; err != nil {
		return allocMoved, linesUpdated, err
	}

	res := tx.Model(&models.TaxSettlementLine{}).
		Where("document_id = ?", legacy.ID).
		Update("document_id", canonical.ID)
	if res.Error != nil {
		return allocMoved, linesUpdated, res.Error
	}
	linesUpdated = int(res.RowsAffected)

	paid := svc.PaidTotal(tx, canonical.ID)
	if paid > canonical.TotalAmount+MoneyEpsilon {
		return allocMoved, linesUpdated, fmt.Errorf("pagos combinados (%.2f) exceden total canónico (%.2f)", paid, canonical.TotalAmount)
	}

	return allocMoved, linesUpdated, nil
}

// mergeLegacyIntoCanonical migra referencias o archiva sin mover pagos si excederían el total canónico.
func mergeLegacyIntoCanonical(tx *gorm.DB, svc *Service, legacy, canonical *models.Document) (allocMoved, linesUpdated int, archivedOnly bool, err error) {
	paidCanon := svc.PaidTotal(tx, canonical.ID)
	paidLegacy := svc.PaidTotal(tx, legacy.ID)
	if paidCanon+paidLegacy > canonical.TotalAmount+MoneyEpsilon {
		if err := markLegacyMerged(tx, legacy, canonical); err != nil {
			return 0, 0, false, err
		}
		return 0, 0, true, nil
	}
	moved, lines, err := migrateLegacyReferences(tx, svc, legacy, canonical)
	if err != nil {
		return 0, 0, false, err
	}
	if err := markLegacyMerged(tx, legacy, canonical); err != nil {
		return moved, lines, false, err
	}
	return moved, lines, false, nil
}

func markLegacyMerged(tx *gorm.DB, legacy, canonical *models.Document) error {
	return tx.Model(&models.Document{}).Where("id = ?", legacy.ID).Updates(map[string]interface{}{
		"legacy_status":           LegacyStatusMerged,
		"merged_into_document_id": canonical.ID,
		"balance_amount":          0,
		"status":                  StatusCancelled,
	}).Error
}

func promoteLegacyAsCanonical(tx *gorm.DB, svc *Service, legacy *models.Document, settlementID, lineID uint) error {
	if legacy.TaxSettlementID == nil || *legacy.TaxSettlementID == 0 {
		if settlementID > 0 {
			if err := tx.Model(&models.Document{}).Where("id = ?", legacy.ID).Update("tax_settlement_id", settlementID).Error; err != nil {
				return err
			}
		}
	}
	var d models.Document
	if err := tx.First(&d, legacy.ID).Error; err != nil {
		return err
	}
	if !d.HasPeriod {
		ApplyPeriodFromString(&d, d.AccountingPeriod, d.ServiceMonth)
		if d.HasPeriod {
			_ = tx.Model(&models.Document{}).Where("id = ?", d.ID).Updates(map[string]interface{}{
				"has_period": d.HasPeriod, "period_month": d.PeriodMonth, "period_year": d.PeriodYear,
			}).Error
		}
	}
	if lineID > 0 {
		var ln models.TaxSettlementLine
		if err := tx.First(&ln, lineID).Error; err == nil && ln.TaxSettlementID == settlementID {
			if ln.DocumentID == nil || *ln.DocumentID != legacy.ID {
				_ = tx.Model(&models.TaxSettlementLine{}).Where("id = ?", lineID).Update("document_id", legacy.ID).Error
			}
		}
	}
	if err := svc.PersistBalanceAndStatusForDoc(tx, &d); err != nil {
		return err
	}
	if err := tx.Model(&models.Document{}).Where("id = ?", legacy.ID).Update("legacy_status", LegacyStatusPromoted).Error; err != nil {
		return err
	}
	cid := legacy.ID
	return logConsolidation(tx, migLegacyConsolidationName, "promote_liq", legacy.ID, &cid, nil, map[string]interface{}{
		"number": legacy.Number, "tax_settlement_id": settlementID,
	})
}

func logConsolidation(tx *gorm.DB, migName, action string, legacyID uint, canonicalID *uint, relatedID *uint, details interface{}) error {
	var js string
	if details != nil {
		b, _ := json.Marshal(details)
		js = string(b)
	}
	entry := models.DocumentConsolidationLog{
		MigrationName:       migName,
		Action:              action,
		LegacyDocumentID:    &legacyID,
		CanonicalDocumentID: canonicalID,
		RelatedID:           relatedID,
		DetailsJSON:         js,
		AppliedAt:           time.Now(),
	}
	return tx.Create(&entry).Error
}

// consolidateDuplicateDEULIQGroups fusiona DEU-LIQ activos duplicados (misma liquidación + línea + monto).
func consolidateDuplicateDEULIQGroups(db *gorm.DB, svc *Service, report *ConsolidationReport) error {
	type grpKey struct {
		CompanyID       uint
		TaxSettlementID uint
		LineID          uint
		Amount          float64
	}
	buckets := map[grpKey][]models.Document{}

	var actives []models.Document
	if err := db.Where("number LIKE ?", "DEU-LIQ-%").
		Where("legacy_status IS NULL OR legacy_status = '' OR legacy_status NOT IN ?", legacyExcludedStatuses).
		Find(&actives).Error; err != nil {
		return err
	}
	for _, d := range actives {
		sid := uint(0)
		lineID := uint(0)
		if d.TaxSettlementID != nil {
			sid = *d.TaxSettlementID
		}
		if s, l, ok := ParseDEULIQFull(d.Number); ok {
			if sid == 0 {
				sid = s
			}
			lineID = l
		} else if sid == 0 {
			if s, ok := ParseDEULIQNumber(d.Number); ok {
				sid = s
			}
		}
		if lineID == 0 {
			continue
		}
		k := grpKey{CompanyID: d.CompanyID, TaxSettlementID: sid, LineID: lineID, Amount: roundMoney(d.TotalAmount)}
		buckets[k] = append(buckets[k], d)
	}

	for _, docs := range buckets {
		if len(docs) < 2 {
			continue
		}
		canonical := docs[0]
		for i := 1; i < len(docs); i++ {
			if docs[i].ID < canonical.ID {
				canonical = docs[i]
			}
		}
		for _, legacy := range docs {
			if legacy.ID == canonical.ID {
				continue
			}
			err := db.Transaction(func(tx *gorm.DB) error {
				moved, lines, archivedOnly, err := mergeLegacyIntoCanonical(tx, svc, &legacy, &canonical)
				if err != nil {
					return err
				}
				rec := ConsolidationMergeRecord{
					LegacyDocumentID: legacy.ID, LegacyNumber: legacy.Number,
					CanonicalDocumentID: canonical.ID, CanonicalNumber: canonical.Number,
					TaxSettlementID: taxSettlementIDVal(&canonical), Amount: legacy.TotalAmount,
					AllocationsMoved: moved, LinesUpdated: lines,
				}
				action := "merge_duplicate_group"
				if archivedOnly {
					action = "archive_duplicate_group"
				}
				report.Merged = append(report.Merged, rec)
				return logConsolidation(tx, migLegacyConsolidationName, action, legacy.ID, &canonical.ID, nil, rec)
			})
			if err != nil {
				report.Conflicts = append(report.Conflicts, ConsolidationConflict{
					LegacyDocumentID: legacy.ID, LegacyNumber: legacy.Number, Reason: err.Error(),
				})
				continue
			}
			_ = svc.PersistBalanceAndStatus(db, canonical.ID)
		}
	}
	return nil
}

// taxSettlementIDVal devuelve tax_settlement_id o 0.
func taxSettlementIDVal(d *models.Document) uint {
	if d == nil || d.TaxSettlementID == nil {
		return 0
	}
	return *d.TaxSettlementID
}
