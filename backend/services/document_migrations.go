package services

import (
	"fmt"
	"log"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"gorm.io/gorm"
)

const (
	migDocumentsRecalcStatusV1      = "documents_v1_recalc_status_from_payments"
	migDocumentsDomainV2Backfill    = "documents_v2_debt_domain_backfill"
	migDocumentsLegacyConsolidation = "documents_v3_legacy_consolidation"
	migDocumentsReceiptFreeze       = "documents_v4_fiscal_receipt_snapshot_freeze"
	migDocumentsStripLegacyMarks    = "documents_v5_strip_legacy_description_marks"
)

// RunDocumentMigrations migraciones idempotentes de deudas (datos).
func RunDocumentMigrations(db *gorm.DB) error {
	if err := db.AutoMigrate(&models.SchemaMigration{}); err != nil {
		return err
	}
	steps := []struct {
		name string
		fn   func(*gorm.DB) error
	}{
		{migDocumentsRecalcStatusV1, migrateDocumentsRecalcStatusFromPayments},
		{migDocumentsDomainV2Backfill, migrateDocumentsDebtDomainV2Backfill},
		{migDocumentsLegacyConsolidation, migrateLegacyDEULIQConsolidationStep},
		{migDocumentsReceiptFreeze, migrateReceiptSnapshotFreeze},
		{migDocumentsStripLegacyMarks, migrateStripLegacyDescriptionMarks},
	}
	for _, step := range steps {
		if err := applyDocumentMigrationOnce(db, step.name, step.fn); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}

func applyDocumentMigrationOnce(db *gorm.DB, name string, fn func(*gorm.DB) error) error {
	var n int64
	if err := db.Model(&models.SchemaMigration{}).Where("name = ?", name).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if err := fn(db); err != nil {
		return err
	}
	return db.Create(&models.SchemaMigration{Name: name, AppliedAt: time.Now()}).Error
}

func migrateDocumentsRecalcStatusFromPayments(db *gorm.DB) error {
	var ids []uint
	if err := db.Model(&models.Document{}).Pluck("id", &ids).Error; err != nil {
		return err
	}
	svc := debtsvc.NewService()
	for _, id := range ids {
		if err := svc.PersistBalanceAndStatus(db, id); err != nil {
			return err
		}
	}
	return nil
}

func migrateDocumentsDebtDomainV2Backfill(db *gorm.DB) error {
	svc := debtsvc.NewService()
	var warnPeriod int

	// tax_settlement_id desde líneas de liquidación
	if err := db.Exec(`
		UPDATE documents d
		INNER JOIN tax_settlement_lines tsl ON tsl.document_id = d.id
		SET d.tax_settlement_id = tsl.tax_settlement_id
		WHERE d.tax_settlement_id IS NULL AND tsl.tax_settlement_id IS NOT NULL
	`).Error; err != nil {
		return err
	}

	// tax_settlement_id desde patrón legacy DEU-LIQ-{settlementId}-{lineId}
	var legacy []models.Document
	if err := db.Where("number LIKE ?", "DEU-LIQ-%").Find(&legacy).Error; err != nil {
		return err
	}
	for i := range legacy {
		d := &legacy[i]
		if d.TaxSettlementID != nil && *d.TaxSettlementID > 0 {
			continue
		}
		sid, ok := debtsvc.ParseDEULIQNumber(d.Number)
		if !ok {
			continue
		}
		if err := db.Model(&models.Document{}).Where("id = ?", d.ID).Update("tax_settlement_id", sid).Error; err != nil {
			return err
		}
	}

	// balance_amount + status + periodo
	var ids []uint
	if err := db.Model(&models.Document{}).Pluck("id", &ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		var d models.Document
		if err := db.First(&d, id).Error; err != nil {
			return err
		}
		if err := svc.PersistBalanceAndStatusForDoc(db, &d); err != nil {
			return err
		}
		if !d.HasPeriod {
			if debtsvc.ApplyPeriodFromString(&d, d.AccountingPeriod, d.ServiceMonth) {
				if err := db.Model(&models.Document{}).Where("id = ?", id).Updates(map[string]interface{}{
					"has_period":   d.HasPeriod,
					"period_month": d.PeriodMonth,
					"period_year":  d.PeriodYear,
				}).Error; err != nil {
					return err
				}
			} else {
				warnPeriod++
			}
		}
	}
	if warnPeriod > 0 {
		log.Printf("[migrate %s] %d documentos sin periodo parseable (YYYY-MM)", migDocumentsDomainV2Backfill, warnPeriod)
	}
	return nil
}

func migrateLegacyDEULIQConsolidationStep(db *gorm.DB) error {
	report, err := debtsvc.RunLegacyDEULIQConsolidation(db, false)
	if err != nil {
		return err
	}
	log.Printf("[migrate %s] merged=%d promoted=%d conflicts=%d balances=%d",
		migDocumentsLegacyConsolidation, len(report.Merged), len(report.Promoted), len(report.Conflicts), report.BalancesNormalized)
	for _, c := range report.Conflicts {
		log.Printf("[migrate %s] conflict %s (id=%d): %s", migDocumentsLegacyConsolidation, c.LegacyNumber, c.LegacyDocumentID, c.Reason)
	}
	if len(report.Conflicts) > 0 {
		return fmt.Errorf("%d conflictos en consolidación legacy (ver log)", len(report.Conflicts))
	}
	return nil
}

// EnsureDocumentMigrationsOnStartup ejecutado desde main (evita ciclo database→services).
func EnsureDocumentMigrationsOnStartup() error {
	return RunDocumentMigrations(database.DB)
}
