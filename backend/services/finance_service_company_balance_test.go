package services

// Tests de Fase 3 Paso 2 (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md):
// FinanceService.GetCompanyBalance migrado para que Balance provenga de
// debt.Service.SaldoDocumentado, no de TotalDocuments-TotalPayments.

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupCompanyBalanceTestDB(t *testing.T) *gorm.DB {
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

func cbStrPtr(s string) *string { return &s }

func seedCBCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "CompanyBalance Test " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedCBDocument(t *testing.T, db *gorm.DB, companyID uint, number, status, legacyStatus string, totalAmount, balanceAmount float64) models.Document {
	t.Helper()
	doc := models.Document{
		CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: number,
		IssueDate: time.Now(), TotalAmount: totalAmount, BalanceAmount: balanceAmount,
		Status: status, LegacyStatus: legacyStatus,
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed document %s: %v", number, err)
	}
	return doc
}

func seedCBPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, purpose *string) models.Payment {
	t.Helper()
	p := models.Payment{
		CompanyID: companyID, Amount: amount, Type: "on_account", Purpose: purpose,
		Date: time.Now(), Method: "Yape", Reference: "OP-CB",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	return p
}

// --- Test 1: deuda normal — Balance debe ser balance_amount, no total_amount-payments -----------------

func TestGetCompanyBalance_UsesBalanceAmount_NotSubtraction(t *testing.T) {
	db := setupCompanyBalanceTestDB(t)
	co := seedCBCompany(t, db, "20940000001")
	seedCBDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	seedCBPayment(t, db, co.ID, 400, cbStrPtr(models.PaymentPurposeDebt))

	svc := NewFinanceService()
	bal, err := svc.GetCompanyBalance(co.ID)
	if err != nil {
		t.Fatalf("GetCompanyBalance: %v", err)
	}
	if bal.Balance != 600 {
		t.Fatalf("Balance=%v, want 600 (balance_amount documentado, NO 1000-400)", bal.Balance)
	}
}

// --- Test 2: servicio independiente — Balance nunca debe ser negativo ------------------------------------

func TestGetCompanyBalance_ServiceIncome_NeverNegative(t *testing.T) {
	db := setupCompanyBalanceTestDB(t)
	co := seedCBCompany(t, db, "20940000002")
	doc := seedCBDocument(t, db, co.ID, "1", "pagado", "", 1000, 0)
	payDeuda := seedCBPayment(t, db, co.ID, 1000, cbStrPtr(models.PaymentPurposeDebt))
	seedCBPayment(t, db, co.ID, 300, cbStrPtr(models.PaymentPurposeService))
	if err := db.Create(&models.PaymentAllocation{PaymentID: payDeuda.ID, DocumentID: doc.ID, Amount: 1000}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	svc := NewFinanceService()
	bal, err := svc.GetCompanyBalance(co.ID)
	if err != nil {
		t.Fatalf("GetCompanyBalance: %v", err)
	}
	if bal.Balance != 0 {
		t.Fatalf("Balance=%v, want 0 (nunca -300 por el pago de servicio)", bal.Balance)
	}
}

// --- Test 3: empresa sin deuda pendiente/parcial -> Balance=0 aunque existan Payments --------------------

func TestGetCompanyBalance_NoOpenDebt_ReturnsZero(t *testing.T) {
	db := setupCompanyBalanceTestDB(t)
	co := seedCBCompany(t, db, "20940000003")
	seedCBDocument(t, db, co.ID, "1", "pagado", "", 500, 0)
	seedCBPayment(t, db, co.ID, 500, cbStrPtr(models.PaymentPurposeDebt))

	svc := NewFinanceService()
	bal, err := svc.GetCompanyBalance(co.ID)
	if err != nil {
		t.Fatalf("GetCompanyBalance: %v", err)
	}
	if bal.Balance != 0 {
		t.Fatalf("Balance=%v, want 0", bal.Balance)
	}
}

// --- Test 4: aislamiento por empresa ----------------------------------------------------------------------

func TestGetCompanyBalance_IsolatesBetweenCompanies(t *testing.T) {
	db := setupCompanyBalanceTestDB(t)
	coA := seedCBCompany(t, db, "20940000004")
	coB := seedCBCompany(t, db, "20940000005")
	seedCBDocument(t, db, coA.ID, "A1", "pendiente", "", 500, 500)
	seedCBDocument(t, db, coB.ID, "B1", "pendiente", "", 9999, 9999)
	seedCBPayment(t, db, coB.ID, 100, cbStrPtr(models.PaymentPurposeDebt))

	svc := NewFinanceService()
	balA, err := svc.GetCompanyBalance(coA.ID)
	if err != nil {
		t.Fatalf("GetCompanyBalance A: %v", err)
	}
	if balA.Balance != 500 {
		t.Fatalf("balA.Balance=%v, want 500 (no debe incluir nada de la empresa B)", balA.Balance)
	}
}

// --- Test 5: legacy_merged no debe aumentar Balance (ScopeActiveDocuments sigue aplicándose) --------------

func TestGetCompanyBalance_LegacyMergedDoesNotIncreaseBalance(t *testing.T) {
	db := setupCompanyBalanceTestDB(t)
	co := seedCBCompany(t, db, "20940000006")
	seedCBDocument(t, db, co.ID, "1", "parcial", "", 500, 300)
	seedCBDocument(t, db, co.ID, "2-legacy", "parcial", "legacy_merged", 400, 400)

	svc := NewFinanceService()
	bal, err := svc.GetCompanyBalance(co.ID)
	if err != nil {
		t.Fatalf("GetCompanyBalance: %v", err)
	}
	if bal.Balance != 300 {
		t.Fatalf("Balance=%v, want 300 (el documento legacy_merged no debe sumarse)", bal.Balance)
	}
}
