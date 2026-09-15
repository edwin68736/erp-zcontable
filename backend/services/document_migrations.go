package services

import (
	"errors"
	"fmt"
	"log"
	"strings"
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
	migDocumentsOriginSettlementV6  = "documents_v6_origin_settlement_backfill"
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
		{migDocumentsOriginSettlementV6, migrateDocumentsOriginSettlementBackfill},
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

// migrateDocumentsOriginSettlementBackfill llena Document.OriginSettlementID para deudas históricas
// (Blueprint Fase 1 §10-13). Regla estricta: NUNCA se adivina el origen. Solo se asigna cuando hay
// evidencia inequívoca:
//
//  1. Deudas legacy DEU-LIQ-{settlementId}-{lineId}: el propio número (inmutable desde su creación,
//     independiente de a qué liquidación esté vinculada hoy) codifica el settlement de origen —
//     exactamente el mecanismo que permitió diagnosticar el bug real en producción.
//  2. Deudas modernas (Source=liquidacion, Type=LI, numeración corta): se busca la PRIMERA
//     TaxSettlementLine (menor id) que referencia el documento con LineType IN (tax_manual,
//     adjustment) — un document_ref NUNCA crea un documento nuevo, solo enlaza uno preexistente, así
//     que la primera línea de creación real (si existe) es prueba fehaciente del origen. Si la
//     primera línea encontrada fuera document_ref, el documento no nació de ninguna liquidación
//     conocida (vino de otro lado) y se deja en NULL.
//  3. Cualquier otro caso (Source distinto de "liquidacion", sin línea de creación localizable, o la
//     liquidación candidata no existe / pertenece a otra empresa) queda con OriginSettlementID=NULL.
//     Es preferible NULL a un origen incorrecto (Blueprint §11).
//
// Cada documento cuyo origen se reconstruye deja un registro en document_consolidation_logs para
// trazabilidad completa (mismo mecanismo ya usado por la consolidación legacy DEU-LIQ).
func migrateDocumentsOriginSettlementBackfill(db *gorm.DB) error {
	var totalDocs int64
	if err := db.Model(&models.Document{}).Count(&totalDocs).Error; err != nil {
		return err
	}

	var docs []models.Document
	if err := db.Where("origin_settlement_id IS NULL").Find(&docs).Error; err != nil {
		return err
	}
	analyzed := len(docs)
	alreadyHadOrigin := int(totalDocs) - analyzed

	var fromLegacyNumber, fromEarliestLine, noEvidence, ambiguous int

	for i := range docs {
		d := &docs[i]
		originID, method, isAmbiguous, err := resolveDocumentOriginSettlement(db, d)
		if err != nil {
			return err
		}
		if originID == 0 {
			if isAmbiguous {
				ambiguous++
			} else {
				noEvidence++
			}
			continue
		}
		if err := db.Model(&models.Document{}).Where("id = ?", d.ID).Update("origin_settlement_id", originID).Error; err != nil {
			return err
		}
		if method == "legacy_number" {
			fromLegacyNumber++
		} else {
			fromEarliestLine++
		}
		sid := originID
		entry := models.DocumentConsolidationLog{
			MigrationName:    migDocumentsOriginSettlementV6,
			Action:           "backfill_origin_settlement",
			LegacyDocumentID: &d.ID,
			RelatedID:        &sid,
			DetailsJSON:      fmt.Sprintf(`{"method":%q,"origin_settlement_id":%d}`, method, originID),
			AppliedAt:        time.Now(),
		}
		if err := db.Create(&entry).Error; err != nil {
			return err
		}
	}

	log.Printf(
		"[migrate %s] total=%d analizados=%d ya_tenian_origen=%d reconstruidos_numero_legacy=%d reconstruidos_primera_linea=%d sin_evidencia=%d ambiguos=%d",
		migDocumentsOriginSettlementV6, totalDocs, analyzed, alreadyHadOrigin, fromLegacyNumber, fromEarliestLine, noEvidence, ambiguous,
	)
	return nil
}

// resolveDocumentOriginSettlement intenta reconstruir el origen de UN documento. Devuelve
// originID=0 si no hay evidencia suficiente; ambiguous distingue "no había nada que mirar" (falso)
// de "había una pista pero no se pudo confirmar con seguridad" (true), solo para el reporte.
func resolveDocumentOriginSettlement(db *gorm.DB, d *models.Document) (originID uint, method string, ambiguous bool, err error) {
	source := strings.ToLower(strings.TrimSpace(d.Source))
	if source != "liquidacion" {
		// Manual, suscripción recurrente, u otro origen: nunca nació de una liquidación, aunque hoy
		// esté enlazada a una (document_ref) — Blueprint Fase 1 §11, Caso G.
		return 0, "", false, nil
	}

	// 1) Legacy: el número inmutable codifica el settlement de origen.
	if sid, ok := debtsvc.ParseDEULIQNumber(d.Number); ok {
		var ts models.TaxSettlement
		terr := db.Select("id", "company_id").First(&ts, sid).Error
		if terr == nil && ts.CompanyID == d.CompanyID {
			return sid, "legacy_number", false, nil
		}
		// El número apunta a un settlement que no existe o de otra empresa: no adivinar.
		return 0, "", true, nil
	}

	// 2) Moderno: primera línea de creación real (nunca document_ref) para este documento.
	if d.Type != models.DocumentTypeLiquidacion {
		return 0, "", false, nil
	}
	var line models.TaxSettlementLine
	lerr := db.Where(
		"document_id = ? AND line_type IN ?",
		d.ID, []string{models.TaxSettlementLineTaxManual, models.TaxSettlementLineAdjust},
	).Order("id ASC").First(&line).Error
	if lerr != nil {
		if errors.Is(lerr, gorm.ErrRecordNotFound) {
			return 0, "", false, nil
		}
		return 0, "", false, lerr
	}
	var ts models.TaxSettlement
	if terr := db.Select("id", "company_id").First(&ts, line.TaxSettlementID).Error; terr != nil || ts.CompanyID != d.CompanyID {
		return 0, "", true, nil
	}
	return line.TaxSettlementID, "earliest_line", false, nil
}

// EnsureDocumentMigrationsOnStartup ejecutado desde main (evita ciclo database→services).
func EnsureDocumentMigrationsOnStartup() error {
	return RunDocumentMigrations(database.DB)
}
