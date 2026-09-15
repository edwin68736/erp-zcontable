package services

// Tests de Fase 3 Paso 3 (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md):
// FinanceService.GetCompanyStatement migrado para que Balance provenga de
// debt.Service.SaldoDocumentado, no de TotalDocuments-TotalPayments.

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupCompanyStatementTestDB(t *testing.T) *gorm.DB {
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
		&models.TaxSettlement{},
		&models.TukifacFiscalReceipt{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func csStrPtr(s string) *string { return &s }

func seedCSCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "CompanyStatement Test " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedCSDocument(t *testing.T, db *gorm.DB, companyID uint, number, status, legacyStatus string, totalAmount, balanceAmount float64) models.Document {
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

func seedCSPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, purpose *string) models.Payment {
	t.Helper()
	p := models.Payment{
		CompanyID: companyID, Amount: amount, Type: "on_account", Purpose: purpose,
		Date: time.Now(), Method: "Yape", Reference: "OP-CS",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	return p
}

func callGetCompanyStatement(t *testing.T, svc *FinanceService, companyID uint) *CompanyStatement {
	t.Helper()
	now := time.Now()
	stmt, err := svc.GetCompanyStatement(companyID, now.Year(), int(now.Month()), nil, nil)
	if err != nil {
		t.Fatalf("GetCompanyStatement: %v", err)
	}
	return stmt
}

// --- Test 1: deuda normal — Balance debe provenir de SaldoDocumentado -----------------------------------

func TestGetCompanyStatement_UsesSaldoDocumentado_NotSubtraction(t *testing.T) {
	db := setupCompanyStatementTestDB(t)
	co := seedCSCompany(t, db, "20950000001")
	doc := seedCSDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedCSPayment(t, db, co.ID, 400, csStrPtr(models.PaymentPurposeDebt))
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	svc := NewFinanceService()
	stmt := callGetCompanyStatement(t, svc, co.ID)
	if stmt.Balance != 600 {
		t.Fatalf("Balance=%v, want 600 (SaldoDocumentado, NO 1000-400)", stmt.Balance)
	}
}

// --- Test 2: Payment de servicio independiente no reduce la deuda -----------------------------------------

func TestGetCompanyStatement_ServicePayment_DoesNotReduceDebt(t *testing.T) {
	db := setupCompanyStatementTestDB(t)
	co := seedCSCompany(t, db, "20950000002")
	seedCSDocument(t, db, co.ID, "1", "pendiente", "", 1000, 1000)
	seedCSPayment(t, db, co.ID, 300, csStrPtr(models.PaymentPurposeService))

	svc := NewFinanceService()
	stmt := callGetCompanyStatement(t, svc, co.ID)
	if stmt.Balance != 1000 {
		t.Fatalf("Balance=%v, want 1000 (el pago de servicio no debe reducir la deuda, NO 700)", stmt.Balance)
	}
}

// --- Test 3: sobrepago no genera saldo negativo artificial -------------------------------------------------

func TestGetCompanyStatement_Overpayment_NoArtificialNegativeBalance(t *testing.T) {
	db := setupCompanyStatementTestDB(t)
	co := seedCSCompany(t, db, "20950000003")
	doc := seedCSDocument(t, db, co.ID, "1", "pagado", "", 500, 0)
	pay := seedCSPayment(t, db, co.ID, 800, csStrPtr(models.PaymentPurposeDebt))
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 500}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	svc := NewFinanceService()
	stmt := callGetCompanyStatement(t, svc, co.ID)
	if stmt.Balance != 0 {
		t.Fatalf("Balance=%v, want 0 (el sobrepago no debe producir saldo negativo)", stmt.Balance)
	}
	if stmt.Balance < 0 {
		t.Fatalf("Balance nunca debe ser negativo, got %v", stmt.Balance)
	}
}

// --- Test 4: empresa sin deuda activa -> Balance=0 ----------------------------------------------------------

func TestGetCompanyStatement_NoActiveDebt_ReturnsZero(t *testing.T) {
	db := setupCompanyStatementTestDB(t)
	co := seedCSCompany(t, db, "20950000004")
	seedCSDocument(t, db, co.ID, "1", "pagado", "", 500, 0)

	svc := NewFinanceService()
	stmt := callGetCompanyStatement(t, svc, co.ID)
	if stmt.Balance != 0 {
		t.Fatalf("Balance=%v, want 0", stmt.Balance)
	}
}

// --- Test 5: aislamiento por empresa ---------------------------------------------------------------------------

func TestGetCompanyStatement_IsolatesBetweenCompanies(t *testing.T) {
	db := setupCompanyStatementTestDB(t)
	coA := seedCSCompany(t, db, "20950000005")
	coB := seedCSCompany(t, db, "20950000006")
	seedCSDocument(t, db, coA.ID, "A1", "pendiente", "", 500, 500)
	seedCSDocument(t, db, coB.ID, "B1", "pendiente", "", 9999, 9999)
	seedCSPayment(t, db, coB.ID, 100, csStrPtr(models.PaymentPurposeDebt))

	svc := NewFinanceService()
	stmtA := callGetCompanyStatement(t, svc, coA.ID)
	if stmtA.Balance != 500 {
		t.Fatalf("stmtA.Balance=%v, want 500 (no debe incluir nada de la empresa B)", stmtA.Balance)
	}
	if len(stmtA.Documents) != 1 {
		t.Fatalf("stmtA.Documents debe tener 1 documento (solo el de la empresa A), got %d", len(stmtA.Documents))
	}
	if len(stmtA.Payments) != 0 {
		t.Fatalf("stmtA.Payments no debe incluir pagos de la empresa B, got %d", len(stmtA.Payments))
	}
}

// --- Test 6: legacy_merged/archived excluidos del saldo (ScopeActiveDocuments) ------------------------------------

func TestGetCompanyStatement_LegacyDocumentsExcludedFromBalance(t *testing.T) {
	db := setupCompanyStatementTestDB(t)
	co := seedCSCompany(t, db, "20950000007")
	seedCSDocument(t, db, co.ID, "1", "parcial", "", 500, 300)
	seedCSDocument(t, db, co.ID, "2-legacy", "parcial", "legacy_merged", 400, 400)
	seedCSDocument(t, db, co.ID, "3-archived", "pendiente", "archived", 200, 200)

	svc := NewFinanceService()
	stmt := callGetCompanyStatement(t, svc, co.ID)
	if stmt.Balance != 300 {
		t.Fatalf("Balance=%v, want 300 (legacy_merged y archived no deben sumarse al saldo)", stmt.Balance)
	}
	// El detalle por documento (Documents) sigue mostrando TODOS los documentos de la empresa,
	// incluidos los legacy — solo el Balance agregado los excluye. Confirma que no se eliminó
	// ninguna consulta ni campo del contrato existente.
	if len(stmt.Documents) != 3 {
		t.Fatalf("stmt.Documents debe seguir listando los 3 documentos (detalle histórico intacto), got %d", len(stmt.Documents))
	}
}

// --- Test adicional: el contrato de respuesta conserva TotalDocuments/TotalPayments/Ledger -----------------------

func TestGetCompanyStatement_ResponseShapeUnchanged(t *testing.T) {
	db := setupCompanyStatementTestDB(t)
	co := seedCSCompany(t, db, "20950000008")
	seedCSDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	seedCSPayment(t, db, co.ID, 400, csStrPtr(models.PaymentPurposeDebt))

	svc := NewFinanceService()
	stmt := callGetCompanyStatement(t, svc, co.ID)
	if stmt.Company == nil {
		t.Fatal("Company no debe ser nil")
	}
	if stmt.Ledger == nil {
		t.Fatal("Ledger no debe ser nil (contrato existente)")
	}
	// TotalDocuments/TotalPayments siguen siendo los totales informativos crudos (no el saldo).
	if stmt.TotalDocuments != 1000 {
		t.Fatalf("TotalDocuments=%v, want 1000 (dato informativo sin cambios)", stmt.TotalDocuments)
	}
	if stmt.TotalPayments != 400 {
		t.Fatalf("TotalPayments=%v, want 400 (dato informativo sin cambios)", stmt.TotalPayments)
	}
}
