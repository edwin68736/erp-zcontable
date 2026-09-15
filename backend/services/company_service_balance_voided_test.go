package services

// Tests de Fase 7 Paso 3 (docs/diseno-fase7-paso2-ui-reportes-2026-09-15.md A.1): CompanyService.List/
// ListPaged ya no calculan Balance con la fórmula SQL ad-hoc (SUM(documents.total_amount) -
// SUM(payments.amount), prohibida por el Blueprint) — usan debt.Service.SaldoDocumentado, igual que
// el resto del sistema desde Fase 3. Escenario íntegro del Blueprint: deuda=1000, pago de
// servicio=300, pago parcial de deuda=400 -> con la fórmula vieja el balance mostrado habría sido
// 1000-(300+400)=300 (mezclando dinero de servicio con la deuda); con SaldoDocumentado es 600
// (correcto: saldo real de la deuda, sin importar el dinero independiente de servicio).

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupCompanyListBalanceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
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

func seedCLBScenario(t *testing.T, db *gorm.DB, ruc string) (models.Company, models.Document) {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "CompanyListBalance Test " + ruc, Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	doc := models.Document{
		CompanyID: co.ID, Source: "manual", Type: "FACTURA", Number: "F-CLB",
		IssueDate: time.Now(), TotalAmount: 1000, BalanceAmount: 600, Status: debtsvc.StatusPartial,
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("document: %v", err)
	}
	purposeService := models.PaymentPurposeService
	servicePay := models.Payment{CompanyID: co.ID, Amount: 300, Type: "on_account", Purpose: &purposeService, Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&servicePay).Error; err != nil {
		t.Fatalf("service payment: %v", err)
	}
	purposeDebt := models.PaymentPurposeDebt
	debtPay := models.Payment{CompanyID: co.ID, Amount: 400, Type: "applied", Purpose: &purposeDebt, Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&debtPay).Error; err != nil {
		t.Fatalf("debt payment: %v", err)
	}
	if err := db.Create(&models.PaymentAllocation{PaymentID: debtPay.ID, DocumentID: doc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("allocation: %v", err)
	}
	return co, doc
}

func TestCompanyService_List_BalanceMatchesSaldoDocumentado(t *testing.T) {
	db := setupCompanyListBalanceTestDB(t)
	co, _ := seedCLBScenario(t, db, "20970000001")

	svc := NewCompanyService()
	list, err := svc.List(CompanyListParams{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var got *CompanyListItem
	for i := range list {
		if list[i].ID == co.ID {
			got = &list[i]
		}
	}
	if got == nil {
		t.Fatal("empresa no encontrada en el listado")
	}

	wantBalance, err := debtsvc.NewService().SaldoDocumentado(db, co.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado: %v", err)
	}
	if wantBalance != 600 {
		t.Fatalf("sanity check: SaldoDocumentado=%v, want 600", wantBalance)
	}
	if got.Balance != wantBalance {
		t.Fatalf("CompanyListItem.Balance=%v, want %v (SaldoDocumentado) — la fórmula vieja habría dado 300", got.Balance, wantBalance)
	}
}

func TestCompanyService_ListPaged_BalanceMatchesSaldoDocumentado(t *testing.T) {
	db := setupCompanyListBalanceTestDB(t)
	co, _ := seedCLBScenario(t, db, "20970000002")

	svc := NewCompanyService()
	list, total, err := svc.ListPaged(CompanyListParams{}, 1, 20)
	if err != nil {
		t.Fatalf("ListPaged: %v", err)
	}
	if total < 1 {
		t.Fatalf("total=%d, want >= 1", total)
	}
	var got *CompanyListItem
	for i := range list {
		if list[i].ID == co.ID {
			got = &list[i]
		}
	}
	if got == nil {
		t.Fatal("empresa no encontrada en el listado paginado")
	}
	if got.Balance != 600 {
		t.Fatalf("CompanyListItem.Balance=%v, want 600 (SaldoDocumentado, no la fórmula ad-hoc vieja)", got.Balance)
	}
}
