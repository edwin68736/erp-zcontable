package services

import (
	"encoding/json"
	"log"
	"strings"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"gorm.io/gorm"
)

func migrateStripLegacyDescriptionMarks(db *gorm.DB) error {
	updated := 0

	var docs []models.Document
	if err := db.Where("description LIKE ?", "%[legacy_%").Find(&docs).Error; err != nil {
		return err
	}
	for i := range docs {
		clean := debtsvc.SanitizeDocumentDescription(docs[i].Description)
		if clean == docs[i].Description {
			continue
		}
		if err := db.Model(&models.Document{}).Where("id = ?", docs[i].ID).Update("description", clean).Error; err != nil {
			return err
		}
		updated++
	}

	var items []models.DocumentItem
	if err := db.Where("description LIKE ?", "%[legacy_%").Find(&items).Error; err != nil {
		return err
	}
	for i := range items {
		clean := debtsvc.SanitizeDocumentDescription(items[i].Description)
		if clean == items[i].Description {
			continue
		}
		if err := db.Model(&models.DocumentItem{}).Where("id = ?", items[i].ID).Update("description", clean).Error; err != nil {
			return err
		}
		updated++
	}

	var lines []models.TaxSettlementLine
	if err := db.Where("concept LIKE ?", "%[legacy_%").Find(&lines).Error; err != nil {
		return err
	}
	for i := range lines {
		clean := debtsvc.SanitizeDocumentDescription(lines[i].Concept)
		if clean == lines[i].Concept {
			continue
		}
		if err := db.Model(&models.TaxSettlementLine{}).Where("id = ?", lines[i].ID).Update("concept", clean).Error; err != nil {
			return err
		}
		updated++
	}

	var payments []models.Payment
	if err := db.Where("description LIKE ?", "%[legacy_%").Find(&payments).Error; err != nil {
		return err
	}
	for i := range payments {
		clean := debtsvc.SanitizeDocumentDescription(payments[i].Description)
		if clean == payments[i].Description {
			continue
		}
		if err := db.Model(&models.Payment{}).Where("id = ?", payments[i].ID).Update("description", clean).Error; err != nil {
			return err
		}
		updated++
	}

	var frLines []models.FiscalReceiptLine
	if err := db.Where("description LIKE ? OR product_name LIKE ?", "%[legacy_%", "%[legacy_%").Find(&frLines).Error; err != nil {
		return err
	}
	for i := range frLines {
		descClean := debtsvc.SanitizeDocumentDescription(frLines[i].Description)
		nameClean := debtsvc.SanitizeDocumentDescription(frLines[i].ProductName)
		if descClean == frLines[i].Description && nameClean == frLines[i].ProductName {
			continue
		}
		if err := db.Model(&models.FiscalReceiptLine{}).Where("id = ?", frLines[i].ID).Updates(map[string]interface{}{
			"description":  descClean,
			"product_name": nameClean,
		}).Error; err != nil {
			return err
		}
		updated++
	}

	var receipts []models.TukifacFiscalReceipt
	if err := db.Where("debt_payment_context_json LIKE ?", "%legacy_%").Find(&receipts).Error; err != nil {
		return err
	}
	for i := range receipts {
		cleanJSON, changed, err := sanitizeDebtPaymentContextJSON(receipts[i].DebtPaymentContextJSON)
		if err != nil {
			return err
		}
		if !changed {
			continue
		}
		if err := db.Model(&models.TukifacFiscalReceipt{}).Where("id = ?", receipts[i].ID).
			Update("debt_payment_context_json", cleanJSON).Error; err != nil {
			return err
		}
		updated++
	}

	log.Printf("[migrate documents_v5_strip_legacy_description_marks] filas actualizadas: %d", updated)
	return nil
}

func sanitizeDebtPaymentContextJSON(raw string) (string, bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || !strings.Contains(raw, "legacy_") {
		return raw, false, nil
	}
	var ctx models.DebtPaymentContext
	if err := json.Unmarshal([]byte(raw), &ctx); err != nil {
		return raw, false, err
	}
	changed := false
	if c := debtsvc.SanitizeDocumentDescription(ctx.PaidConceptLabel); c != ctx.PaidConceptLabel {
		ctx.PaidConceptLabel = c
		changed = true
	}
	for j, concept := range ctx.PaidConcepts {
		if c := debtsvc.SanitizeDocumentDescription(concept); c != concept {
			ctx.PaidConcepts[j] = c
			changed = true
		}
	}
	if !changed {
		return raw, false, nil
	}
	b, err := json.Marshal(&ctx)
	if err != nil {
		return raw, false, err
	}
	return string(b), true, nil
}
