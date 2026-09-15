package services

// Fase 1 del blueprint financiero §10-13: backfill de Document.OriginSettlementID para deudas
// históricas. Regla estricta: NUNCA se adivina — solo se asigna con evidencia inequívoca; en
// cualquier otro caso queda NULL.

import (
	"fmt"
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupOriginBackfillTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.TaxSettlement{},
		&models.TaxSettlementLine{},
		&models.Document{},
		&models.DocumentItem{},
		&models.Payment{},
		&models.PaymentAllocation{},
		&models.DocumentConsolidationLog{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func TestBackfillOriginSettlement_LegacyNumber_Reconstructed(t *testing.T) {
	db := setupOriginBackfillTestDB(t)
	co := models.Company{RUC: "20700000001", BusinessName: "Legacy Co"}
	db.Create(&co)
	ts := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusClosed}
	db.Create(&ts)
	doc := models.Document{CompanyID: co.ID, Source: "liquidacion", Type: models.DocumentTypeLiquidacion, Number: fmtDEULIQ(ts.ID, 1), TotalAmount: 100, BalanceAmount: 100, Status: "pendiente"}
	db.Create(&doc)

	if err := migrateDocumentsOriginSettlementBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	var reloaded models.Document
	db.First(&reloaded, doc.ID)
	if reloaded.OriginSettlementID == nil || *reloaded.OriginSettlementID != ts.ID {
		t.Fatalf("origin=%v, want %d (reconstruido desde número legacy)", reloaded.OriginSettlementID, ts.ID)
	}
}

func TestBackfillOriginSettlement_LegacyNumber_UnknownSettlement_StaysNull(t *testing.T) {
	db := setupOriginBackfillTestDB(t)
	co := models.Company{RUC: "20700000002", BusinessName: "Legacy Co Ambiguous"}
	db.Create(&co)
	// El número referencia un settlement (id=9999) que no existe -> no adivinar, dejar NULL.
	doc := models.Document{CompanyID: co.ID, Source: "liquidacion", Type: models.DocumentTypeLiquidacion, Number: "DEU-LIQ-9999-1", TotalAmount: 100, BalanceAmount: 100, Status: "pendiente"}
	db.Create(&doc)

	if err := migrateDocumentsOriginSettlementBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Document
	db.First(&reloaded, doc.ID)
	if reloaded.OriginSettlementID != nil {
		t.Fatalf("origin debía quedar NULL (settlement inexistente en el número legacy), got %v", *reloaded.OriginSettlementID)
	}
}

func TestBackfillOriginSettlement_ModernDocument_EarliestCreationLine_Reconstructed(t *testing.T) {
	db := setupOriginBackfillTestDB(t)
	co := models.Company{RUC: "20700000003", BusinessName: "Modern Co"}
	db.Create(&co)
	tsOld := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusClosed}
	db.Create(&tsOld)
	tsNew := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusDraft}
	db.Create(&tsNew)

	doc := models.Document{CompanyID: co.ID, Source: "liquidacion", Type: models.DocumentTypeLiquidacion, Number: "000042", TotalAmount: 100, BalanceAmount: 100, Status: "pendiente"}
	db.Create(&doc)
	// Línea de creación real (la más antigua, tax_manual) en tsOld.
	lineCreate := models.TaxSettlementLine{TaxSettlementID: tsOld.ID, LineType: models.TaxSettlementLineTaxManual, DocumentID: &doc.ID, Amount: 100, Concept: "x"}
	db.Create(&lineCreate)
	// Línea posterior de arrastre (document_ref) en tsNew — NO debe confundirse con el origen.
	lineDrag := models.TaxSettlementLine{TaxSettlementID: tsNew.ID, LineType: models.TaxSettlementLineDocRef, DocumentID: &doc.ID, Amount: 100, Concept: "arrastre"}
	db.Create(&lineDrag)

	if err := migrateDocumentsOriginSettlementBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Document
	db.First(&reloaded, doc.ID)
	if reloaded.OriginSettlementID == nil || *reloaded.OriginSettlementID != tsOld.ID {
		t.Fatalf("origin=%v, want %d (primera línea de creación real, no la de arrastre)", reloaded.OriginSettlementID, tsOld.ID)
	}
}

func TestBackfillOriginSettlement_ModernDocument_OnlyDocRefLine_StaysNull(t *testing.T) {
	db := setupOriginBackfillTestDB(t)
	co := models.Company{RUC: "20700000004", BusinessName: "Modern Co Ambiguous"}
	db.Create(&co)
	ts := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusDraft}
	db.Create(&ts)
	// Documento con Source=liquidacion/Type=LI pero SIN ninguna línea de creación real (tax_manual/
	// adjustment) — solo una línea document_ref: no hay evidencia de que esta liquidación lo creara.
	doc := models.Document{CompanyID: co.ID, Source: "liquidacion", Type: models.DocumentTypeLiquidacion, Number: "000043", TotalAmount: 100, BalanceAmount: 100, Status: "pendiente"}
	db.Create(&doc)
	line := models.TaxSettlementLine{TaxSettlementID: ts.ID, LineType: models.TaxSettlementLineDocRef, DocumentID: &doc.ID, Amount: 100, Concept: "x"}
	db.Create(&line)

	if err := migrateDocumentsOriginSettlementBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Document
	db.First(&reloaded, doc.ID)
	if reloaded.OriginSettlementID != nil {
		t.Fatalf("origin debía quedar NULL (sin evidencia de creación, solo enlace), got %v", *reloaded.OriginSettlementID)
	}
}

func TestBackfillOriginSettlement_ManualDocument_AlwaysStaysNull(t *testing.T) {
	db := setupOriginBackfillTestDB(t)
	co := models.Company{RUC: "20700000005", BusinessName: "Manual Co"}
	db.Create(&co)
	ts := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusDraft}
	db.Create(&ts)
	tsID := ts.ID
	doc := models.Document{CompanyID: co.ID, Source: "manual", Type: "FACTURA", Number: "M-1", TotalAmount: 100, BalanceAmount: 100, Status: "pendiente", TaxSettlementID: &tsID}
	db.Create(&doc)

	if err := migrateDocumentsOriginSettlementBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Document
	db.First(&reloaded, doc.ID)
	if reloaded.OriginSettlementID != nil {
		t.Fatalf("un documento manual jamás debe recibir origin_settlement_id, got %v", *reloaded.OriginSettlementID)
	}
}

func TestBackfillOriginSettlement_AlreadyHasOrigin_NotOverwritten(t *testing.T) {
	db := setupOriginBackfillTestDB(t)
	co := models.Company{RUC: "20700000006", BusinessName: "Already Set Co"}
	db.Create(&co)
	tsReal := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusClosed}
	db.Create(&tsReal)
	doc := models.Document{CompanyID: co.ID, Source: "liquidacion", Type: models.DocumentTypeLiquidacion, Number: "000044", TotalAmount: 100, BalanceAmount: 100, Status: "pendiente", OriginSettlementID: &tsReal.ID}
	db.Create(&doc)

	if err := migrateDocumentsOriginSettlementBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Document
	db.First(&reloaded, doc.ID)
	if reloaded.OriginSettlementID == nil || *reloaded.OriginSettlementID != tsReal.ID {
		t.Fatalf("un origen ya asignado no debe tocarse: got %v want %d", reloaded.OriginSettlementID, tsReal.ID)
	}
}

func fmtDEULIQ(settlementID uint, lineID uint) string {
	return fmt.Sprintf("DEU-LIQ-%d-%d", settlementID, lineID)
}
