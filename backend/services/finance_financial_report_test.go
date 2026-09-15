package services

// Tests de Fase 3 Paso 4A (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md):
// FinanceService.GetFinancialReportRows (Reporte financiero, filas por empresa) migrado para que
// Balance provenga de debt.Service.SaldoDocumentado, no de TotalDocuments-TotalPayments
// (companyTotalsForReport se conserva como fuente de los totales informativos).

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupFinancialReportTestDB(t *testing.T) *gorm.DB {
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

func frStrPtr(s string) *string { return &s }

func seedFRCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "FinancialReport Test " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedFRDocument(t *testing.T, db *gorm.DB, companyID uint, number, status, legacyStatus string, totalAmount, balanceAmount float64) models.Document {
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

func seedFRPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, purpose *string) models.Payment {
	t.Helper()
	p := models.Payment{
		CompanyID: companyID, Amount: amount, Type: "on_account", Purpose: purpose,
		Date: time.Now(), Method: "Yape", Reference: "OP-FR",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	return p
}

func findRowForCompany(rows []FinancialCompanyReportRow, companyID uint) *FinancialCompanyReportRow {
	for i := range rows {
		if rows[i].Company.ID == companyID {
			return &rows[i]
		}
	}
	return nil
}

// --- Test 1: deuda normal — Balance debe provenir de SaldoDocumentado -----------------------------------

func TestGetFinancialReportRows_UsesSaldoDocumentado_NotSubtraction(t *testing.T) {
	db := setupFinancialReportTestDB(t)
	svc := NewFinanceService()
	co := seedFRCompany(t, db, "20960000001")
	doc := seedFRDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedFRPayment(t, db, co.ID, 400, frStrPtr(models.PaymentPurposeDebt))
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	rows, _, _, _, err := svc.GetFinancialReportRows(FinancialReportParams{IsAdmin: true})
	if err != nil {
		t.Fatalf("GetFinancialReportRows: %v", err)
	}
	row := findRowForCompany(rows, co.ID)
	if row == nil {
		t.Fatal("no se encontró la fila de la empresa")
	}
	if row.Balance != 600 {
		t.Fatalf("Balance=%v, want 600 (SaldoDocumentado, NO 1000-400)", row.Balance)
	}
}

// --- Test 2: servicio independiente no reduce la deuda ------------------------------------------------------

func TestGetFinancialReportRows_ServicePayment_DoesNotReduceDebt(t *testing.T) {
	db := setupFinancialReportTestDB(t)
	svc := NewFinanceService()
	co := seedFRCompany(t, db, "20960000002")
	seedFRDocument(t, db, co.ID, "1", "pendiente", "", 1000, 1000)
	seedFRPayment(t, db, co.ID, 300, frStrPtr(models.PaymentPurposeService))

	rows, _, _, _, err := svc.GetFinancialReportRows(FinancialReportParams{IsAdmin: true})
	if err != nil {
		t.Fatalf("GetFinancialReportRows: %v", err)
	}
	row := findRowForCompany(rows, co.ID)
	if row == nil {
		t.Fatal("no se encontró la fila de la empresa")
	}
	if row.Balance != 1000 {
		t.Fatalf("Balance=%v, want 1000 (el pago de servicio no debe reducir la deuda, NO 700)", row.Balance)
	}
}

// --- Test 3: sobrepago no genera saldo negativo artificial -------------------------------------------------

func TestGetFinancialReportRows_Overpayment_NoArtificialNegativeBalance(t *testing.T) {
	db := setupFinancialReportTestDB(t)
	svc := NewFinanceService()
	co := seedFRCompany(t, db, "20960000003")
	doc := seedFRDocument(t, db, co.ID, "1", "pagado", "", 500, 0)
	pay := seedFRPayment(t, db, co.ID, 800, frStrPtr(models.PaymentPurposeDebt))
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 500}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	rows, _, _, _, err := svc.GetFinancialReportRows(FinancialReportParams{IsAdmin: true})
	if err != nil {
		t.Fatalf("GetFinancialReportRows: %v", err)
	}
	row := findRowForCompany(rows, co.ID)
	if row == nil {
		t.Fatal("no se encontró la fila de la empresa")
	}
	if row.Balance != 0 {
		t.Fatalf("Balance=%v, want 0 (el sobrepago no debe producir saldo negativo)", row.Balance)
	}
	if row.Balance < 0 {
		t.Fatalf("Balance nunca debe ser negativo, got %v", row.Balance)
	}
}

// --- Test 4: empresa sin deuda -> Balance=0 -----------------------------------------------------------------

func TestGetFinancialReportRows_NoDebt_ReturnsZero(t *testing.T) {
	db := setupFinancialReportTestDB(t)
	svc := NewFinanceService()
	co := seedFRCompany(t, db, "20960000004")
	seedFRDocument(t, db, co.ID, "1", "pagado", "", 500, 0)

	rows, _, _, _, err := svc.GetFinancialReportRows(FinancialReportParams{IsAdmin: true})
	if err != nil {
		t.Fatalf("GetFinancialReportRows: %v", err)
	}
	row := findRowForCompany(rows, co.ID)
	if row == nil {
		t.Fatal("no se encontró la fila de la empresa")
	}
	if row.Balance != 0 {
		t.Fatalf("Balance=%v, want 0", row.Balance)
	}
}

// --- Test 5: aislamiento por empresa -------------------------------------------------------------------------

func TestGetFinancialReportRows_IsolatesBetweenCompanies(t *testing.T) {
	db := setupFinancialReportTestDB(t)
	svc := NewFinanceService()
	coA := seedFRCompany(t, db, "20960000005")
	coB := seedFRCompany(t, db, "20960000006")
	seedFRDocument(t, db, coA.ID, "A1", "pendiente", "", 500, 500)
	seedFRDocument(t, db, coB.ID, "B1", "pendiente", "", 9999, 9999)
	seedFRPayment(t, db, coB.ID, 100, frStrPtr(models.PaymentPurposeDebt))

	rows, _, _, _, err := svc.GetFinancialReportRows(FinancialReportParams{IsAdmin: true})
	if err != nil {
		t.Fatalf("GetFinancialReportRows: %v", err)
	}
	rowA := findRowForCompany(rows, coA.ID)
	if rowA == nil {
		t.Fatal("no se encontró la fila de la empresa A")
	}
	if rowA.Balance != 500 {
		t.Fatalf("rowA.Balance=%v, want 500 (no debe incluir nada de la empresa B)", rowA.Balance)
	}
}

// --- Test 6: legacy_merged/archived excluidos del saldo (ScopeActiveDocuments) --------------------------------

func TestGetFinancialReportRows_LegacyDocumentsExcludedFromBalance(t *testing.T) {
	db := setupFinancialReportTestDB(t)
	svc := NewFinanceService()
	co := seedFRCompany(t, db, "20960000007")
	seedFRDocument(t, db, co.ID, "1", "parcial", "", 500, 300)
	seedFRDocument(t, db, co.ID, "2-legacy", "parcial", "legacy_merged", 400, 400)
	seedFRDocument(t, db, co.ID, "3-archived", "pendiente", "archived", 200, 200)

	rows, _, _, _, err := svc.GetFinancialReportRows(FinancialReportParams{IsAdmin: true})
	if err != nil {
		t.Fatalf("GetFinancialReportRows: %v", err)
	}
	row := findRowForCompany(rows, co.ID)
	if row == nil {
		t.Fatal("no se encontró la fila de la empresa")
	}
	if row.Balance != 300 {
		t.Fatalf("Balance=%v, want 300 (legacy_merged y archived no deben sumarse al saldo)", row.Balance)
	}
}

// --- Test 7: shape del reporte y grandes totales sin cambios de contrato --------------------------------------

func TestGetFinancialReportRows_ResponseShapeAndGrandTotalsUnchanged(t *testing.T) {
	db := setupFinancialReportTestDB(t)
	svc := NewFinanceService()
	co := seedFRCompany(t, db, "20960000008")
	doc := seedFRDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedFRPayment(t, db, co.ID, 400, frStrPtr(models.PaymentPurposeDebt))
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	rows, grandDocs, grandPays, grandBal, err := svc.GetFinancialReportRows(FinancialReportParams{IsAdmin: true})
	if err != nil {
		t.Fatalf("GetFinancialReportRows: %v", err)
	}
	row := findRowForCompany(rows, co.ID)
	if row == nil {
		t.Fatal("no se encontró la fila de la empresa")
	}
	// TotalDocuments/TotalPayments siguen siendo los totales informativos crudos (companyTotalsForReport).
	if row.TotalDocuments != 1000 {
		t.Fatalf("TotalDocuments=%v, want 1000 (dato informativo sin cambios)", row.TotalDocuments)
	}
	if row.TotalPayments != 400 {
		t.Fatalf("TotalPayments=%v, want 400 (dato informativo sin cambios)", row.TotalPayments)
	}
	if row.Company.ID != co.ID {
		t.Fatalf("Company no debe cambiar de forma, got ID=%v", row.Company.ID)
	}
	// Los grandes totales agregan sobre las filas ya calculadas (grandBal = SUM(Balance por fila)).
	if grandDocs != 1000 {
		t.Fatalf("grandDocs=%v, want 1000", grandDocs)
	}
	if grandPays != 400 {
		t.Fatalf("grandPays=%v, want 400", grandPays)
	}
	if grandBal != 600 {
		t.Fatalf("grandBal=%v, want 600 (SUM de SaldoDocumentado por empresa, NO grandDocs-grandPays)", grandBal)
	}
}
