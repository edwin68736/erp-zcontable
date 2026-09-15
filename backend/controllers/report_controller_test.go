package controllers

// Tests de Fase 3 Paso 4B (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md):
// FinancialSummaryAPI (rama sin include=companies) migrada para que global_balance provenga de
// debt.Service.SaldoDocumentado agregado por empresa, no de totalDocs-totalPays. Se prueba
// directamente sumSaldoDocumentado — el helper extraído de FinancialSummaryAPI — porque el resto
// del endpoint depende del contexto HTTP/RBAC (hasStudioScope/getUserID), sin infraestructura de
// test HTTP existente en este proyecto (ningún otro controller tiene tests); probar el helper cubre
// exactamente la lógica que cambió en este paso.

import (
	"testing"
	"time"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupReportControllerTestDB(t *testing.T) *gorm.DB {
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
	return db
}

func rcStrPtr(s string) *string { return &s }

func seedRCCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "ReportController Test " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedRCDocument(t *testing.T, db *gorm.DB, companyID uint, number, status, legacyStatus string, totalAmount, balanceAmount float64) models.Document {
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

func seedRCPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, purpose *string) models.Payment {
	t.Helper()
	p := models.Payment{
		CompanyID: companyID, Amount: amount, Type: "on_account", Purpose: purpose,
		Date: time.Now(), Method: "Yape", Reference: "OP-RC",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	return p
}

// --- Test 1: deuda normal -----------------------------------------------------------------------------------

func TestSumSaldoDocumentado_NormalDebt(t *testing.T) {
	db := setupReportControllerTestDB(t)
	co := seedRCCompany(t, db, "20970000001")
	doc := seedRCDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedRCPayment(t, db, co.ID, 400, rcStrPtr(models.PaymentPurposeDebt))
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	total, err := sumSaldoDocumentado(db, debtsvc.NewService(), []uint{co.ID})
	if err != nil {
		t.Fatalf("sumSaldoDocumentado: %v", err)
	}
	if total != 600 {
		t.Fatalf("total=%v, want 600 (SaldoDocumentado, NO 1000-400)", total)
	}
}

// --- Test 2: servicio independiente no reduce la deuda -------------------------------------------------------

func TestSumSaldoDocumentado_ServicePayment_DoesNotReduceDebt(t *testing.T) {
	db := setupReportControllerTestDB(t)
	co := seedRCCompany(t, db, "20970000002")
	seedRCDocument(t, db, co.ID, "1", "pendiente", "", 1000, 1000)
	seedRCPayment(t, db, co.ID, 300, rcStrPtr(models.PaymentPurposeService))

	total, err := sumSaldoDocumentado(db, debtsvc.NewService(), []uint{co.ID})
	if err != nil {
		t.Fatalf("sumSaldoDocumentado: %v", err)
	}
	if total != 1000 {
		t.Fatalf("total=%v, want 1000 (el pago de servicio no debe reducir la deuda, NO 700)", total)
	}
}

// --- Test 3: sobrepago no genera saldo negativo artificial ----------------------------------------------------

func TestSumSaldoDocumentado_Overpayment_NoArtificialNegativeBalance(t *testing.T) {
	db := setupReportControllerTestDB(t)
	co := seedRCCompany(t, db, "20970000003")
	doc := seedRCDocument(t, db, co.ID, "1", "pagado", "", 500, 0)
	pay := seedRCPayment(t, db, co.ID, 800, rcStrPtr(models.PaymentPurposeDebt))
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 500}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	total, err := sumSaldoDocumentado(db, debtsvc.NewService(), []uint{co.ID})
	if err != nil {
		t.Fatalf("sumSaldoDocumentado: %v", err)
	}
	if total != 0 {
		t.Fatalf("total=%v, want 0 (el sobrepago no debe producir saldo negativo)", total)
	}
	if total < 0 {
		t.Fatalf("total nunca debe ser negativo, got %v", total)
	}
}

// --- Test 4: empresa sin deuda -> 0 --------------------------------------------------------------------------

func TestSumSaldoDocumentado_NoDebt_ReturnsZero(t *testing.T) {
	db := setupReportControllerTestDB(t)
	co := seedRCCompany(t, db, "20970000004")
	seedRCDocument(t, db, co.ID, "1", "pagado", "", 500, 0)

	total, err := sumSaldoDocumentado(db, debtsvc.NewService(), []uint{co.ID})
	if err != nil {
		t.Fatalf("sumSaldoDocumentado: %v", err)
	}
	if total != 0 {
		t.Fatalf("total=%v, want 0", total)
	}
}

// --- Test 5: aislamiento — solo agrega las empresas indicadas explícitamente ------------------------------------

func TestSumSaldoDocumentado_OnlySumsCompaniesInScope(t *testing.T) {
	db := setupReportControllerTestDB(t)
	coA := seedRCCompany(t, db, "20970000005")
	coB := seedRCCompany(t, db, "20970000006")
	seedRCDocument(t, db, coA.ID, "A1", "pendiente", "", 500, 500)
	seedRCDocument(t, db, coB.ID, "B1", "pendiente", "", 9999, 9999)

	// Solo se pide la empresa A en el ámbito -> el saldo de B no debe contaminar el resultado.
	total, err := sumSaldoDocumentado(db, debtsvc.NewService(), []uint{coA.ID})
	if err != nil {
		t.Fatalf("sumSaldoDocumentado: %v", err)
	}
	if total != 500 {
		t.Fatalf("total=%v, want 500 (no debe incluir la empresa B, fuera del ámbito solicitado)", total)
	}

	// Con ambas empresas en el ámbito, se suman correctamente (caso "hasStudioScope" agregando todas).
	totalBoth, err := sumSaldoDocumentado(db, debtsvc.NewService(), []uint{coA.ID, coB.ID})
	if err != nil {
		t.Fatalf("sumSaldoDocumentado (ambas): %v", err)
	}
	if totalBoth != 500+9999 {
		t.Fatalf("totalBoth=%v, want %v", totalBoth, 500+9999.0)
	}
}

// --- Test 6: legacy_merged/archived excluidos del saldo (ScopeActiveDocuments) ------------------------------------

func TestSumSaldoDocumentado_LegacyDocumentsExcluded(t *testing.T) {
	db := setupReportControllerTestDB(t)
	co := seedRCCompany(t, db, "20970000007")
	seedRCDocument(t, db, co.ID, "1", "parcial", "", 500, 300)
	seedRCDocument(t, db, co.ID, "2-legacy", "parcial", "legacy_merged", 400, 400)
	seedRCDocument(t, db, co.ID, "3-archived", "pendiente", "archived", 200, 200)

	total, err := sumSaldoDocumentado(db, debtsvc.NewService(), []uint{co.ID})
	if err != nil {
		t.Fatalf("sumSaldoDocumentado: %v", err)
	}
	if total != 300 {
		t.Fatalf("total=%v, want 300 (legacy_merged y archived no deben sumarse)", total)
	}
}

// --- Test 7: sin empresas en el ámbito -> 0, sin error --------------------------------------------------------

func TestSumSaldoDocumentado_EmptyScope_ReturnsZeroNoError(t *testing.T) {
	db := setupReportControllerTestDB(t)

	total, err := sumSaldoDocumentado(db, debtsvc.NewService(), []uint{})
	if err != nil {
		t.Fatalf("sumSaldoDocumentado: %v", err)
	}
	if total != 0 {
		t.Fatalf("total=%v, want 0", total)
	}
}
