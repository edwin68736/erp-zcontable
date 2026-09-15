package services

// Fase 2.1 + 2.2 del blueprint financiero (docs/blueprint-financiero-definitivo-2026-09-14.md,
// docs/auditoria-fase2-integridad-pagos-2026-09-14.md): backfill histórico de Payment.Purpose.
//
// Regla estricta (igual criterio que el backfill de Document.OriginSettlementID de Fase 1): NUNCA se
// adivina. Solo se clasifica con evidencia inequívoca; en cualquier otro caso queda NULL ("sin
// clasificar"). Es aditivo, conservador e idempotente — no toca Payment.Type, Payment.DocumentID,
// PaymentAllocation, Payment.Amount ni el saldo de ningún Document.

import (
	"encoding/json"
	"log"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

const migPaymentsPurposeBackfillV1 = "payments_v1_purpose_backfill"

// RunPaymentMigrations migraciones idempotentes de pagos (datos). Mismo patrón que
// RunDocumentMigrations (document_migrations.go): pasos guardados en schema_migrations, cada uno se
// ejecuta una sola vez en la vida de la base — reutiliza el helper applyDocumentMigrationOnce ya
// existente (es genérico pese al nombre, solo depende de models.SchemaMigration).
func RunPaymentMigrations(db *gorm.DB) error {
	if err := db.AutoMigrate(&models.SchemaMigration{}); err != nil {
		return err
	}
	return applyDocumentMigrationOnce(db, migPaymentsPurposeBackfillV1, migratePaymentsPurposeBackfill)
}

// EnsurePaymentMigrationsOnStartup ejecutado desde main (mismo patrón que
// EnsureDocumentMigrationsOnStartup, evita ciclo database→services).
func EnsurePaymentMigrationsOnStartup() error {
	return RunPaymentMigrations(database.DB)
}

// paymentPurposeEvidence identifica qué evidencia justificó la clasificación, solo para el reporte.
type paymentPurposeEvidence struct {
	Purpose        string // "" si no hay evidencia suficiente (queda NULL)
	Method         string // "allocation" | "legacy_document_id" | "pos_receipt"
	DocumentSource string // Source del Document relacionado, si aplica (solo informativo)
}

// migratePaymentsPurposeBackfill clasifica Payment.Purpose para pagos históricos donde purpose IS
// NULL. Procesa cada uno una sola vez por ejecución del backfill (idempotente vía el propio filtro
// "purpose IS NULL": lo ya clasificado, por este backfill o por cualquier otro proceso, nunca se
// reevalúa ni se sobrescribe).
func migratePaymentsPurposeBackfill(db *gorm.DB) error {
	var totalPayments int64
	if err := db.Model(&models.Payment{}).Count(&totalPayments).Error; err != nil {
		return err
	}

	var payments []models.Payment
	if err := db.Where("purpose IS NULL").Find(&payments).Error; err != nil {
		return err
	}
	analyzed := len(payments)
	alreadyClassified := int(totalPayments) - analyzed

	var deudaByAllocation, deudaByLegacyDocID, servicioByPOS, ambiguous int
	sourceBreakdown := map[string]int{}

	for i := range payments {
		p := &payments[i]
		ev, err := resolvePaymentPurpose(db, p)
		if err != nil {
			return err
		}
		if ev.Purpose == "" {
			ambiguous++
			logPaymentPurposeBackfillEntry(db, p, "ambiguous", "sin evidencia suficiente (on_account, sin allocation, sin document_id, sin comprobante POS vinculado)")
			continue
		}
		if err := db.Model(&models.Payment{}).Where("id = ?", p.ID).Update("purpose", ev.Purpose).Error; err != nil {
			return err
		}
		switch ev.Method {
		case "allocation":
			deudaByAllocation++
		case "legacy_document_id":
			deudaByLegacyDocID++
		case "pos_receipt":
			servicioByPOS++
		}
		if ev.DocumentSource != "" {
			sourceBreakdown[ev.DocumentSource]++
		}
		logPaymentPurposeBackfillEntry(db, p, "classified", ev.Method)
	}

	log.Printf(
		"[migrate %s] total=%d analizados=%d ya_clasificados=%d deuda_por_allocation=%d deuda_por_document_id_legacy=%d servicio_por_comprobante_pos=%d ambiguos_sin_clasificar=%d fuentes_document=%v",
		migPaymentsPurposeBackfillV1, totalPayments, analyzed, alreadyClassified,
		deudaByAllocation, deudaByLegacyDocID, servicioByPOS, ambiguous, sourceBreakdown,
	)
	return nil
}

// resolvePaymentPurpose intenta clasificar UN Payment histórico, en el orden exacto de evidencia
// definido por la auditoría de Fase 2 (§5 del documento de implementación):
//
//  1. Tiene al menos una PaymentAllocation activa → el dinero se usó para cancelar una deuda real,
//     sin importar el Source del Document (Document siempre representa una cuenta por cobrar en este
//     modelo — la relación financiera directa ya es evidencia suficiente por sí sola).
//  2. Payment.DocumentID (legacy) apunta a un Document que existe → misma evidencia que (1), por el
//     camino de escritura legacy en vez de PaymentAllocation.
//  3. type=on_account, sin allocations, sin DocumentID, pero con un TukifacFiscalReceipt vinculado
//     (LinkedPaymentID) cuyo origin sea "pos_sale" → confianza MEDIA: verificado contra el código
//     real de IssuePosSale (pos_sale_service.go) que el flujo POS NUNCA crea ni referencia un
//     Document (no tiene document_id en su modelo de línea de venta), por lo que un comprobante POS
//     vinculado a este pago es, estructuralmente, evidencia de una venta/servicio independiente y no
//     de una liquidación mensual. Deliberadamente NO se aplica a comprobantes origin="issued_local"
//     (esos nacen de un Payment ya existente en Finanzas, que puede legítimamente ser un pago a
//     cuenta genuino a la espera de decidir a qué deuda aplicarlo).
//  4. Cualquier otro caso → sin evidencia suficiente, Purpose queda NULL.
func resolvePaymentPurpose(db *gorm.DB, p *models.Payment) (paymentPurposeEvidence, error) {
	var allocCount int64
	if err := db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", p.ID).Count(&allocCount).Error; err != nil {
		return paymentPurposeEvidence{}, err
	}
	if allocCount > 0 {
		src := firstAllocatedDocumentSource(db, p.ID)
		return paymentPurposeEvidence{Purpose: models.PaymentPurposeDebt, Method: "allocation", DocumentSource: src}, nil
	}

	if p.DocumentID != nil && *p.DocumentID > 0 {
		var d models.Document
		if err := db.Select("id", "source").First(&d, *p.DocumentID).Error; err == nil {
			return paymentPurposeEvidence{
				Purpose:        models.PaymentPurposeDebt,
				Method:         "legacy_document_id",
				DocumentSource: strings.ToLower(strings.TrimSpace(d.Source)),
			}, nil
		}
		// Payment.DocumentID apunta a un documento que ya no existe (dato corrupto histórico) — no
		// es evidencia válida, continúa evaluando el resto de las reglas.
	}

	if strings.ToLower(strings.TrimSpace(p.Type)) == "on_account" {
		var receipt models.TukifacFiscalReceipt
		err := db.Select("id", "origin").Where("linked_payment_id = ?", p.ID).First(&receipt).Error
		if err == nil && strings.ToLower(strings.TrimSpace(receipt.Origin)) == models.TukifacReceiptOriginPOS {
			return paymentPurposeEvidence{Purpose: models.PaymentPurposeService, Method: "pos_receipt"}, nil
		}
	}

	return paymentPurposeEvidence{}, nil
}

// firstAllocatedDocumentSource: Source de uno de los Document a los que se aplicó este pago —
// puramente informativo para el desglose del reporte, nunca decide la clasificación.
func firstAllocatedDocumentSource(db *gorm.DB, paymentID uint) string {
	var doc models.Document
	err := db.Table("documents").
		Joins("JOIN payment_allocations pa ON pa.document_id = documents.id").
		Where("pa.payment_id = ? AND pa.deleted_at IS NULL", paymentID).
		Order("documents.id ASC").
		Select("documents.source").
		First(&doc).Error
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(doc.Source))
}

// logPaymentPurposeBackfillEntry deja rastro por cada Payment procesado (clasificado o ambiguo),
// reutilizando document_consolidation_logs — su campo RelatedID ya está documentado como genérico
// ("payment_id, receipt_id, line_id, etc."), por lo que reutilizarlo aquí no es un mal uso del
// mecanismo existente. No crea ninguna tabla nueva.
func logPaymentPurposeBackfillEntry(db *gorm.DB, p *models.Payment, action, reason string) {
	var allocCount int64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", p.ID).Count(&allocCount)
	var receiptID *uint
	var receipt models.TukifacFiscalReceipt
	if err := db.Select("id").Where("linked_payment_id = ?", p.ID).First(&receipt).Error; err == nil {
		receiptID = &receipt.ID
	}
	details := map[string]interface{}{
		"payment_id":         p.ID,
		"company_id":         p.CompanyID,
		"amount":             p.Amount,
		"type":               p.Type,
		"document_id":        p.DocumentID,
		"allocation_count":   allocCount,
		"related_receipt_id": receiptID,
		"reason":             reason,
	}
	js, _ := json.Marshal(details)
	pid := p.ID
	entry := models.DocumentConsolidationLog{
		MigrationName: migPaymentsPurposeBackfillV1,
		Action:        "payment_purpose_" + action,
		RelatedID:     &pid,
		DetailsJSON:   string(js),
		AppliedAt:     time.Now(),
	}
	if err := db.Create(&entry).Error; err != nil {
		log.Printf("[migrate %s] no se pudo registrar log para payment_id=%d: %v", migPaymentsPurposeBackfillV1, p.ID, err)
	}
}
