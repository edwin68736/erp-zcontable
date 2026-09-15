package controllers

// Tests de Fase 3 Paso 5 (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md):
// Dashboard (getDashboardData / getDashboardDataForCompanyIDs) migrado para que GlobalBalance
// reutilice totalDebt (ya calculado vía GetCompanyBalance, migrado en el Paso 2) en vez de
// totalDocs-totalPays. El gráfico mensual de pagos (métrica de flujo) y el % de cobranza del año
// deben permanecer intactos — no representan saldo de deuda.

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupDashboardTestDB(t *testing.T) *gorm.DB {
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

func dcStrPtr(s string) *string { return &s }

func seedDCCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "Dashboard Test " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedDCDocument(t *testing.T, db *gorm.DB, companyID uint, number, status, legacyStatus string, totalAmount, balanceAmount float64) models.Document {
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

func seedDCPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, purpose *string, date time.Time) models.Payment {
	t.Helper()
	p := models.Payment{
		CompanyID: companyID, Amount: amount, Type: "on_account", Purpose: purpose,
		Date: date, Method: "Yape", Reference: "OP-DC",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	return p
}

// --- Test 1: deuda normal — GlobalBalance debe reflejar el saldo real -----------------------------------

func TestDashboard_GlobalBalance_NormalDebt(t *testing.T) {
	db := setupDashboardTestDB(t)
	co := seedDCCompany(t, db, "20980000001")
	doc := seedDCDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedDCPayment(t, db, co.ID, 400, dcStrPtr(models.PaymentPurposeDebt), time.Now())
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	ctrl := NewDashboardController()
	data, err := ctrl.getDashboardData(0)
	if err != nil {
		t.Fatalf("getDashboardData: %v", err)
	}
	if data.GlobalBalance != 600 {
		t.Fatalf("GlobalBalance=%v, want 600 (SaldoDocumentado, NO 1000-400)", data.GlobalBalance)
	}
}

// --- Test 2: servicio independiente no reduce la deuda mostrada -------------------------------------------

func TestDashboard_GlobalBalance_ServicePayment_DoesNotReduceDebt(t *testing.T) {
	db := setupDashboardTestDB(t)
	co := seedDCCompany(t, db, "20980000002")
	seedDCDocument(t, db, co.ID, "1", "pendiente", "", 1000, 1000)
	seedDCPayment(t, db, co.ID, 300, dcStrPtr(models.PaymentPurposeService), time.Now())

	ctrl := NewDashboardController()
	data, err := ctrl.getDashboardData(0)
	if err != nil {
		t.Fatalf("getDashboardData: %v", err)
	}
	if data.GlobalBalance != 1000 {
		t.Fatalf("GlobalBalance=%v, want 1000 (el pago de servicio no debe reducir la deuda, NO 700)", data.GlobalBalance)
	}
}

// --- Test 3: sobrepago no genera saldo negativo artificial ----------------------------------------------------

func TestDashboard_GlobalBalance_Overpayment_NoArtificialNegativeBalance(t *testing.T) {
	db := setupDashboardTestDB(t)
	co := seedDCCompany(t, db, "20980000003")
	doc := seedDCDocument(t, db, co.ID, "1", "pagado", "", 500, 0)
	pay := seedDCPayment(t, db, co.ID, 800, dcStrPtr(models.PaymentPurposeDebt), time.Now())
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 500}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	ctrl := NewDashboardController()
	data, err := ctrl.getDashboardData(0)
	if err != nil {
		t.Fatalf("getDashboardData: %v", err)
	}
	if data.GlobalBalance != 0 {
		t.Fatalf("GlobalBalance=%v, want 0 (el sobrepago no debe producir saldo negativo)", data.GlobalBalance)
	}
	if data.GlobalBalance < 0 {
		t.Fatalf("GlobalBalance nunca debe ser negativo, got %v", data.GlobalBalance)
	}
}

// --- Test 4: empresa sin deuda -> GlobalBalance=0 ------------------------------------------------------------

func TestDashboard_GlobalBalance_NoDebt_ReturnsZero(t *testing.T) {
	db := setupDashboardTestDB(t)
	co := seedDCCompany(t, db, "20980000004")
	seedDCDocument(t, db, co.ID, "1", "pagado", "", 500, 0)

	ctrl := NewDashboardController()
	data, err := ctrl.getDashboardData(0)
	if err != nil {
		t.Fatalf("getDashboardData: %v", err)
	}
	if data.GlobalBalance != 0 {
		t.Fatalf("GlobalBalance=%v, want 0", data.GlobalBalance)
	}
	if len(data.TopDebtors) != 0 {
		t.Fatalf("TopDebtors debe estar vacío, got %d", len(data.TopDebtors))
	}
}

// --- Test 5: aislamiento por empresa (vista de alcance limitado) ------------------------------------------------

func TestDashboard_GlobalBalance_IsolatesBetweenCompanies_ScopedView(t *testing.T) {
	db := setupDashboardTestDB(t)
	coA := seedDCCompany(t, db, "20980000005")
	coB := seedDCCompany(t, db, "20980000006")
	seedDCDocument(t, db, coA.ID, "A1", "pendiente", "", 500, 500)
	seedDCDocument(t, db, coB.ID, "B1", "pendiente", "", 9999, 9999)
	seedDCPayment(t, db, coB.ID, 100, dcStrPtr(models.PaymentPurposeDebt), time.Now())

	ctrl := NewDashboardController()
	data, err := ctrl.getDashboardDataForCompanyIDs([]uint{coA.ID}, 0)
	if err != nil {
		t.Fatalf("getDashboardDataForCompanyIDs: %v", err)
	}
	if data.GlobalBalance != 500 {
		t.Fatalf("GlobalBalance=%v, want 500 (no debe incluir la deuda de la empresa B, fuera de alcance)", data.GlobalBalance)
	}
}

// --- Test 6: legacy_merged/archived excluidos del saldo (ScopeActiveDocuments) ------------------------------------

func TestDashboard_GlobalBalance_LegacyDocumentsExcluded(t *testing.T) {
	db := setupDashboardTestDB(t)
	co := seedDCCompany(t, db, "20980000007")
	seedDCDocument(t, db, co.ID, "1", "parcial", "", 500, 300)
	seedDCDocument(t, db, co.ID, "2-legacy", "parcial", "legacy_merged", 400, 400)
	seedDCDocument(t, db, co.ID, "3-archived", "pendiente", "archived", 200, 200)

	ctrl := NewDashboardController()
	data, err := ctrl.getDashboardData(0)
	if err != nil {
		t.Fatalf("getDashboardData: %v", err)
	}
	if data.GlobalBalance != 300 {
		t.Fatalf("GlobalBalance=%v, want 300 (legacy_merged y archived no deben sumarse)", data.GlobalBalance)
	}
}

// --- Test 7: el gráfico mensual de pagos sigue siendo una métrica de FLUJO, no de deuda -----------------------------

func TestDashboard_MonthlyPaymentsChart_RemainsFlowMetric_IncludesServicePayments(t *testing.T) {
	db := setupDashboardTestDB(t)
	co := seedDCCompany(t, db, "20980000008")
	// Un pago de servicio (nunca reduce deuda) SÍ debe aparecer en el gráfico de flujo mensual,
	// porque el gráfico representa dinero recibido, no saldo de deuda — no se filtra por Purpose.
	now := time.Now()
	seedDCPayment(t, db, co.ID, 300, dcStrPtr(models.PaymentPurposeService), now)
	seedDCPayment(t, db, co.ID, 700, dcStrPtr(models.PaymentPurposeDebt), now)

	ctrl := NewDashboardController()
	data, err := ctrl.getDashboardData(0)
	if err != nil {
		t.Fatalf("getDashboardData: %v", err)
	}
	if len(data.MonthlyPayments) != 12 {
		t.Fatalf("MonthlyPayments debe tener 12 meses, got %d", len(data.MonthlyPayments))
	}
	currentMonthAmount := data.MonthlyPayments[int(now.Month())-1].Amount
	if currentMonthAmount != 1000 {
		t.Fatalf("MonthlyPayments[mes actual]=%v, want 1000 (300 servicio + 700 deuda, el gráfico de flujo no filtra Purpose)", currentMonthAmount)
	}
}

// --- Test 8: shape del Dashboard — campos existentes permanecen ------------------------------------------------------

func TestDashboard_ResponseShapeUnchanged(t *testing.T) {
	db := setupDashboardTestDB(t)
	co := seedDCCompany(t, db, "20980000009")
	doc := seedDCDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedDCPayment(t, db, co.ID, 400, dcStrPtr(models.PaymentPurposeDebt), time.Now())
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	ctrl := NewDashboardController()
	data, err := ctrl.getDashboardData(0)
	if err != nil {
		t.Fatalf("getDashboardData: %v", err)
	}
	// TotalDocs/TotalPays siguen siendo los totales informativos crudos (sin cambios de significado).
	if data.TotalDocs != 1000 {
		t.Fatalf("TotalDocs=%v, want 1000 (dato informativo sin cambios)", data.TotalDocs)
	}
	if data.TotalPays != 400 {
		t.Fatalf("TotalPays=%v, want 400 (dato informativo sin cambios)", data.TotalPays)
	}
	if data.TotalDebtAmount != data.GlobalBalance {
		t.Fatalf("TotalDebtAmount (%v) y GlobalBalance (%v) deben coincidir (ambos derivan de SaldoDocumentado)", data.TotalDebtAmount, data.GlobalBalance)
	}
	if len(data.TopDebtors) != 1 {
		t.Fatalf("TopDebtors debe tener 1 empresa morosa, got %d", len(data.TopDebtors))
	}
	if data.TopDebtors[0].Balance != 600 {
		t.Fatalf("TopDebtors[0].Balance=%v, want 600", data.TopDebtors[0].Balance)
	}
}
