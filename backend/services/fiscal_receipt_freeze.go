package services

import (
	"fmt"
	"log"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

const migReceiptFreezeName = "documents_v4_fiscal_receipt_snapshot_freeze"

// ReceiptFreezeReport comprobantes backfillearados.
type ReceiptFreezeReport struct {
	Backfilled []uint   `json:"backfilled_receipt_ids"`
	Errors     []string `json:"errors"`
}

// BackfillFragileFiscalReceipts persiste líneas + DebtPaymentContextJSON en comprobantes sin snapshot.
func BackfillFragileFiscalReceipts(db *gorm.DB) (*ReceiptFreezeReport, error) {
	if db == nil {
		return nil, fmt.Errorf("db requerida")
	}
	report := &ReceiptFreezeReport{
		Backfilled: []uint{},
		Errors:     []string{},
	}

	var ids []uint
	if err := db.Raw(`
		SELECT r.id FROM tukifac_fiscal_receipts r
		WHERE r.deleted_at IS NULL AND r.linked_payment_id IS NOT NULL
		  AND (r.debt_payment_context_json IS NULL OR TRIM(r.debt_payment_context_json) = '')
		  AND NOT EXISTS (SELECT 1 FROM fiscal_receipt_lines l WHERE l.fiscal_receipt_id = r.id)
	`).Scan(&ids).Error; err != nil {
		return nil, err
	}

	for _, rid := range ids {
		if err := db.Transaction(func(tx *gorm.DB) error {
			return freezeFiscalReceiptTx(tx, rid)
		}); err != nil {
			report.Errors = append(report.Errors, fmt.Sprintf("receipt %d: %v", rid, err))
			continue
		}
		report.Backfilled = append(report.Backfilled, rid)
		ridCopy := rid
		_ = db.Create(&models.DocumentConsolidationLog{
			MigrationName: migReceiptFreezeName,
			Action:        "backfill_receipt",
			RelatedID:     &ridCopy,
			AppliedAt:     time.Now(),
		}).Error
	}

	return report, nil
}

func freezeFiscalReceiptTx(tx *gorm.DB, receiptID uint) error {
	var rec models.TukifacFiscalReceipt
	if err := tx.First(&rec, receiptID).Error; err != nil {
		return err
	}
	if rec.LinkedPaymentID == nil || *rec.LinkedPaymentID == 0 {
		return fmt.Errorf("sin pago vinculado")
	}

	var pay models.Payment
	if err := tx.
		Preload("Allocations", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Preload("Allocations.Document.Items", func(db *gorm.DB) *gorm.DB { return db.Order("sort_order ASC, id ASC") }).
		Preload("Allocations.Document.Items.Product").
		Preload("TaxSettlement.Lines", func(db *gorm.DB) *gorm.DB { return db.Order("sort_order ASC, id ASC") }).
		Preload("TaxSettlement").
		First(&pay, *rec.LinkedPaymentID).Error; err != nil {
		return err
	}

	lines := BuildReceiptLinesFromPayment(&pay)
	if len(lines) == 0 {
		return fmt.Errorf("no se pudieron generar líneas desde el pago")
	}

	subtotal, tax, total := sumLineTotals(lines)
	for i := range lines {
		ln := lines[i]
		ln.FiscalReceiptID = rec.ID
		if err := tx.Create(&ln).Error; err != nil {
			return err
		}
	}

	ctxJSON := ""
	if ctx := buildDebtPaymentContextSnapshot(&pay, lines); ctx != nil {
		if j, err := debtPaymentContextToJSON(ctx); err == nil {
			ctxJSON = j
		}
	}

	updates := map[string]interface{}{
		"debt_payment_context_json": ctxJSON,
	}
	if rec.Subtotal == 0 && subtotal > 0 {
		updates["subtotal"] = subtotal
		updates["tax_amount"] = tax
	}
	if rec.Total == 0 && total > 0 {
		updates["total"] = total
	}
	return tx.Model(&models.TukifacFiscalReceipt{}).Where("id = ?", rec.ID).Updates(updates).Error
}

func migrateReceiptSnapshotFreeze(db *gorm.DB) error {
	report, err := BackfillFragileFiscalReceipts(db)
	if err != nil {
		return err
	}
	log.Printf("[migrate %s] backfilled=%d errors=%d", migReceiptFreezeName, len(report.Backfilled), len(report.Errors))
	for _, e := range report.Errors {
		log.Printf("[migrate %s] %s", migReceiptFreezeName, e)
	}
	if len(report.Errors) > 0 {
		return fmt.Errorf("%d errores al congelar comprobantes", len(report.Errors))
	}
	return nil
}
