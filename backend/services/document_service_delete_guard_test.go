package services

// Fase 1 del blueprint financiero (docs/blueprint-financiero-definitivo-2026-09-14.md §23): auditoría
// de TODOS los caminos de borrado físico de Document. DocumentService.Delete (usado por el endpoint
// manual "Eliminar documento" de Finanzas) solo verificaba Payment.DocumentID (esquema legacy) y
// dejaba pasar deudas ya pagadas por el esquema moderno de PaymentAllocation — corregido para usar
// debt.Service.DocumentFinancialOrSettlementHistory, la misma protección centralizada.

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupDocumentDeleteGuardTestDB(t *testing.T) *gorm.DB {
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
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func TestDocumentServiceDelete_BlocksDocumentWithPaymentAllocation(t *testing.T) {
	db := setupDocumentDeleteGuardTestDB(t)
	co := models.Company{RUC: "20600000002", BusinessName: "Empresa Delete Test"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	doc := models.Document{CompanyID: co.ID, Type: "FACTURA", Source: "manual", Number: "D-001", TotalAmount: 100, BalanceAmount: 0, Status: "pagado"}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("doc: %v", err)
	}
	pay := models.Payment{CompanyID: co.ID, Amount: 100, Type: "applied"}
	if err := db.Create(&pay).Error; err != nil {
		t.Fatalf("payment: %v", err)
	}
	alloc := models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 100}
	if err := db.Create(&alloc).Error; err != nil {
		t.Fatalf("allocation: %v", err)
	}

	svc := NewDocumentService()
	if err := svc.Delete(doc.ID); err == nil {
		t.Fatal("ANTES del fix esto se eliminaba indebidamente: un documento pagado vía PaymentAllocation " +
			"(esquema moderno, sin Payment.DocumentID) debe bloquear el borrado igual que uno legacy")
	}
	var cnt int64
	db.Model(&models.Document{}).Where("id = ?", doc.ID).Count(&cnt)
	if cnt == 0 {
		t.Fatal("el documento con PaymentAllocation fue eliminado físicamente")
	}
}

func TestDocumentServiceDelete_BlocksDocumentWithOriginSettlement(t *testing.T) {
	db := setupDocumentDeleteGuardTestDB(t)
	co := models.Company{RUC: "20600000003", BusinessName: "Empresa Delete Test 2"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	ts := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusClosed}
	if err := db.Create(&ts).Error; err != nil {
		t.Fatalf("settlement: %v", err)
	}
	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &ts.ID, Type: models.DocumentTypeLiquidacion,
		Source: "liquidacion", Number: "000010", TotalAmount: 50, BalanceAmount: 50, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("doc: %v", err)
	}

	svc := NewDocumentService()
	if err := svc.Delete(doc.ID); err == nil {
		t.Fatal("un documento con historial de liquidación (origin_settlement_id) no debe poder " +
			"eliminarse por la ruta genérica de Finanzas")
	}
	var cnt int64
	db.Model(&models.Document{}).Where("id = ?", doc.ID).Count(&cnt)
	if cnt == 0 {
		t.Fatal("el documento con origin_settlement_id fue eliminado físicamente")
	}
}

func TestDocumentServiceDelete_AllowsPlainManualDocument(t *testing.T) {
	db := setupDocumentDeleteGuardTestDB(t)
	co := models.Company{RUC: "20600000004", BusinessName: "Empresa Delete Test 3"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	doc := models.Document{CompanyID: co.ID, Type: "FACTURA", Source: "manual", Number: "D-002", TotalAmount: 30, BalanceAmount: 30, Status: "pendiente"}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("doc: %v", err)
	}

	svc := NewDocumentService()
	if err := svc.Delete(doc.ID); err != nil {
		t.Fatalf("un documento manual sin historial debe poder eliminarse: %v", err)
	}
	var cnt int64
	db.Model(&models.Document{}).Where("id = ?", doc.ID).Count(&cnt)
	if cnt != 0 {
		t.Fatal("esperaba eliminación física del documento manual sin historial")
	}
}
