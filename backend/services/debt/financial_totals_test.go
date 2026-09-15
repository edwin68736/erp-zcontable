package debt_test

// Tests de Fase 3 (docs/auditoria-diseno-fase3-calculos-financieros-2026-09-14.md): las 4 funciones
// financieras oficiales — SaldoDocumentado, DineroTotalRecibido, DineroAplicadoADeudas,
// DineroNoAplicado — incluyendo el escenario íntegro del Blueprint (deuda=1000, servicio=300,
// pago de deuda=1000) que demuestra que ningún saldo queda negativo.

import (
	"testing"
	"time"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupFinancialTotalsTestDB(t *testing.T) *gorm.DB {
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

func ftStrPtr(s string) *string { return &s }

func seedFTCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "Financial Totals Test Co " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

// seedFTDocument crea un Document con status/legacy_status explícitos para probar los filtros.
func seedFTDocument(t *testing.T, db *gorm.DB, companyID uint, number, status, legacyStatus string, totalAmount, balanceAmount float64) models.Document {
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

func seedFTPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, purpose *string) models.Payment {
	t.Helper()
	p := models.Payment{
		CompanyID: companyID, Amount: amount, Type: "on_account", Purpose: purpose,
		Date: time.Now(), Method: "Yape", Reference: "OP-FT",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	return p
}

func seedFTAllocation(t *testing.T, db *gorm.DB, paymentID, documentID uint, amount float64) models.PaymentAllocation {
	t.Helper()
	a := models.PaymentAllocation{PaymentID: paymentID, DocumentID: documentID, Amount: amount}
	if err := db.Create(&a).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}
	return a
}

// --- Item 1: SaldoDocumentado sin documentos -> 0 ----------------------------------------------------

func TestSaldoDocumentado_NoDocuments_ReturnsZero(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000001")

	total, err := svc.SaldoDocumentado(db, co.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado: %v", err)
	}
	if total != 0 {
		t.Fatalf("total=%v, want 0", total)
	}
}

// --- Item 2: pendiente + parcial suman correctamente --------------------------------------------------

func TestSaldoDocumentado_SumsPendingAndPartial(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000002")
	seedFTDocument(t, db, co.ID, "1", "pendiente", "", 500, 500)
	seedFTDocument(t, db, co.ID, "2", "parcial", "", 300, 120)

	total, err := svc.SaldoDocumentado(db, co.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado: %v", err)
	}
	if total != 620 {
		t.Fatalf("total=%v, want 620", total)
	}
}

// --- Item 3: pagado/anulado/exonerado excluidos --------------------------------------------------------

func TestSaldoDocumentado_ExcludesPaidCancelledExonerated(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000003")
	seedFTDocument(t, db, co.ID, "1", "pendiente", "", 500, 500)
	// balance_amount > 0 a propósito en los 3 casos "cerrados" — deben excluirse por status,
	// no porque el saldo sea 0 (demuestra que el filtro es status IN (...), no el monto).
	seedFTDocument(t, db, co.ID, "2", "pagado", "", 300, 50)
	seedFTDocument(t, db, co.ID, "3", "anulado", "", 200, 200)
	seedFTDocument(t, db, co.ID, "4", "exonerado", "", 100, 100)

	total, err := svc.SaldoDocumentado(db, co.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado: %v", err)
	}
	if total != 500 {
		t.Fatalf("total=%v, want 500 (solo el documento pendiente)", total)
	}
}

// --- Item 4: legacy_merged excluido --------------------------------------------------------------------

func TestSaldoDocumentado_ExcludesLegacyMerged(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000004")
	seedFTDocument(t, db, co.ID, "1", "pendiente", "", 500, 500)
	seedFTDocument(t, db, co.ID, "2-legacy", "pendiente", "legacy_merged", 400, 400)
	seedFTDocument(t, db, co.ID, "3-archived", "parcial", "archived", 300, 150)

	total, err := svc.SaldoDocumentado(db, co.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado: %v", err)
	}
	if total != 500 {
		t.Fatalf("total=%v, want 500 (legacy_merged y archived excluidos)", total)
	}
}

// --- Item 5: documento de otra empresa excluido ----------------------------------------------------------

func TestSaldoDocumentado_ExcludesOtherCompany(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000005")
	other := seedFTCompany(t, db, "20930000006")
	seedFTDocument(t, db, co.ID, "1", "pendiente", "", 500, 500)
	seedFTDocument(t, db, other.ID, "2", "pendiente", "", 999, 999)

	total, err := svc.SaldoDocumentado(db, co.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado: %v", err)
	}
	if total != 500 {
		t.Fatalf("total=%v, want 500 (no debe incluir el documento de otra empresa)", total)
	}
}

// --- Item 6: DineroTotalRecibido incluye deuda + servicio ------------------------------------------------

func TestDineroTotalRecibido_IncludesDebtAndService(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000007")
	seedFTPayment(t, db, co.ID, 1000, ftStrPtr(models.PaymentPurposeDebt))
	seedFTPayment(t, db, co.ID, 300, ftStrPtr(models.PaymentPurposeService))

	total, err := svc.DineroTotalRecibido(db, co.ID)
	if err != nil {
		t.Fatalf("DineroTotalRecibido: %v", err)
	}
	if total != 1300 {
		t.Fatalf("total=%v, want 1300 (deuda + servicio)", total)
	}
}

// --- Item 7: Payment soft-deleted excluido -----------------------------------------------------------------

func TestDineroTotalRecibido_ExcludesSoftDeletedPayment(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000008")
	active := seedFTPayment(t, db, co.ID, 500, ftStrPtr(models.PaymentPurposeDebt))
	deleted := seedFTPayment(t, db, co.ID, 700, ftStrPtr(models.PaymentPurposeDebt))
	if err := db.Delete(&deleted).Error; err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	total, err := svc.DineroTotalRecibido(db, co.ID)
	if err != nil {
		t.Fatalf("DineroTotalRecibido: %v", err)
	}
	if total != active.Amount {
		t.Fatalf("total=%v, want %v (el pago eliminado no debe contarse)", total, active.Amount)
	}
}

// --- Item 8: DineroAplicadoADeudas suma allocations, no Payment.amount --------------------------------------

func TestDineroAplicadoADeudas_SumsAllocationsNotPaymentAmount(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000009")
	doc := seedFTDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedFTPayment(t, db, co.ID, 1000, ftStrPtr(models.PaymentPurposeDebt))
	seedFTAllocation(t, db, pay.ID, doc.ID, 400)

	total, err := svc.DineroAplicadoADeudas(db, co.ID)
	if err != nil {
		t.Fatalf("DineroAplicadoADeudas: %v", err)
	}
	if total != 400 {
		t.Fatalf("total=%v, want 400 (la allocation, no el monto completo del pago)", total)
	}
}

// --- Item 9: allocation de Payment soft-deleted excluida -----------------------------------------------------

func TestDineroAplicadoADeudas_ExcludesAllocationOfSoftDeletedPayment(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000010")
	doc := seedFTDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedFTPayment(t, db, co.ID, 1000, ftStrPtr(models.PaymentPurposeDebt))
	seedFTAllocation(t, db, pay.ID, doc.ID, 400)
	if err := db.Delete(&pay).Error; err != nil {
		t.Fatalf("soft delete payment: %v", err)
	}

	total, err := svc.DineroAplicadoADeudas(db, co.ID)
	if err != nil {
		t.Fatalf("DineroAplicadoADeudas: %v", err)
	}
	if total != 0 {
		t.Fatalf("total=%v, want 0 (el payment de la allocation está eliminado)", total)
	}
}

// --- Item 10: allocation soft-deleted excluida -----------------------------------------------------------

func TestDineroAplicadoADeudas_ExcludesSoftDeletedAllocation(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000011")
	doc := seedFTDocument(t, db, co.ID, "1", "parcial", "", 1000, 600)
	pay := seedFTPayment(t, db, co.ID, 1000, ftStrPtr(models.PaymentPurposeDebt))
	alloc := seedFTAllocation(t, db, pay.ID, doc.ID, 400)
	if err := db.Delete(&alloc).Error; err != nil {
		t.Fatalf("soft delete allocation: %v", err)
	}

	total, err := svc.DineroAplicadoADeudas(db, co.ID)
	if err != nil {
		t.Fatalf("DineroAplicadoADeudas: %v", err)
	}
	if total != 0 {
		t.Fatalf("total=%v, want 0 (la allocation está eliminada, aunque el payment siga activo)", total)
	}
}

// --- Item 11: Payment deuda con remanente -> cuenta --------------------------------------------------------

func TestDineroNoAplicado_DebtPaymentWithRemainder_Counts(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000012")
	doc := seedFTDocument(t, db, co.ID, "1", "parcial", "", 1000, 700)
	pay := seedFTPayment(t, db, co.ID, 1000, ftStrPtr(models.PaymentPurposeDebt))
	seedFTAllocation(t, db, pay.ID, doc.ID, 300)

	total, err := svc.DineroNoAplicado(db, co.ID)
	if err != nil {
		t.Fatalf("DineroNoAplicado: %v", err)
	}
	if total != 700 {
		t.Fatalf("total=%v, want 700 (1000-300)", total)
	}
}

// --- Item 12: Payment deuda totalmente aplicado -> no cuenta -------------------------------------------------

func TestDineroNoAplicado_DebtPaymentFullyApplied_DoesNotCount(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000013")
	doc := seedFTDocument(t, db, co.ID, "1", "pagado", "", 500, 0)
	pay := seedFTPayment(t, db, co.ID, 500, ftStrPtr(models.PaymentPurposeDebt))
	seedFTAllocation(t, db, pay.ID, doc.ID, 500)

	total, err := svc.DineroNoAplicado(db, co.ID)
	if err != nil {
		t.Fatalf("DineroNoAplicado: %v", err)
	}
	if total != 0 {
		t.Fatalf("total=%v, want 0 (remanente 0, dentro de MoneyEpsilon)", total)
	}
}

// --- Item 13: Payment servicio -> NO cuenta ------------------------------------------------------------------

func TestDineroNoAplicado_ServicePayment_NeverCounts(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000014")
	seedFTPayment(t, db, co.ID, 300, ftStrPtr(models.PaymentPurposeService))

	total, err := svc.DineroNoAplicado(db, co.ID)
	if err != nil {
		t.Fatalf("DineroNoAplicado: %v", err)
	}
	if total != 0 {
		t.Fatalf("total=%v, want 0 (un pago purpose=servicio nunca debe aparecer aquí)", total)
	}
}

// --- Item 14: Payment Purpose NULL -> SÍ cuenta ---------------------------------------------------------------

func TestDineroNoAplicado_PurposeNull_Counts(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000015")
	seedFTPayment(t, db, co.ID, 300, nil) // Purpose sin clasificar (histórico)

	total, err := svc.DineroNoAplicado(db, co.ID)
	if err != nil {
		t.Fatalf("DineroNoAplicado: %v", err)
	}
	if total != 300 {
		t.Fatalf("total=%v, want 300 (Purpose=NULL nunca se interpreta como servicio, C2 opción A')", total)
	}
}

// --- Item 15: Sobrepago -----------------------------------------------------------------------------------------

func TestDineroNoAplicado_Overpayment_RemainderIsUnapplied(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000016")
	doc := seedFTDocument(t, db, co.ID, "1", "pagado", "", 600, 0)
	pay := seedFTPayment(t, db, co.ID, 1000, ftStrPtr(models.PaymentPurposeDebt))
	seedFTAllocation(t, db, pay.ID, doc.ID, 600)

	total, err := svc.DineroNoAplicado(db, co.ID)
	if err != nil {
		t.Fatalf("DineroNoAplicado: %v", err)
	}
	if total != 400 {
		t.Fatalf("total=%v, want 400 (1000-600)", total)
	}
}

// --- Item 16: Multiempresa sin contaminación cruzada -----------------------------------------------------------

func TestFinancialTotals_MultiCompany_NoCrossContamination(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	coA := seedFTCompany(t, db, "20930000017")
	coB := seedFTCompany(t, db, "20930000018")

	docA := seedFTDocument(t, db, coA.ID, "A1", "pendiente", "", 500, 500)
	docB := seedFTDocument(t, db, coB.ID, "B1", "pendiente", "", 800, 800)

	payA := seedFTPayment(t, db, coA.ID, 200, ftStrPtr(models.PaymentPurposeDebt))
	payB := seedFTPayment(t, db, coB.ID, 900, ftStrPtr(models.PaymentPurposeDebt))
	seedFTAllocation(t, db, payA.ID, docA.ID, 100)
	seedFTAllocation(t, db, payB.ID, docB.ID, 300)

	saldoA, err := svc.SaldoDocumentado(db, coA.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado A: %v", err)
	}
	if saldoA != 500 {
		t.Fatalf("saldoA=%v, want 500", saldoA)
	}
	recibidoA, _ := svc.DineroTotalRecibido(db, coA.ID)
	if recibidoA != 200 {
		t.Fatalf("recibidoA=%v, want 200", recibidoA)
	}
	aplicadoA, _ := svc.DineroAplicadoADeudas(db, coA.ID)
	if aplicadoA != 100 {
		t.Fatalf("aplicadoA=%v, want 100", aplicadoA)
	}
	noAplicadoA, _ := svc.DineroNoAplicado(db, coA.ID)
	if noAplicadoA != 100 {
		t.Fatalf("noAplicadoA=%v, want 100 (200-100)", noAplicadoA)
	}

	saldoB, err := svc.SaldoDocumentado(db, coB.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado B: %v", err)
	}
	if saldoB != 800 {
		t.Fatalf("saldoB=%v, want 800", saldoB)
	}
	recibidoB, _ := svc.DineroTotalRecibido(db, coB.ID)
	if recibidoB != 900 {
		t.Fatalf("recibidoB=%v, want 900", recibidoB)
	}
	aplicadoB, _ := svc.DineroAplicadoADeudas(db, coB.ID)
	if aplicadoB != 300 {
		t.Fatalf("aplicadoB=%v, want 300", aplicadoB)
	}
	noAplicadoB, _ := svc.DineroNoAplicado(db, coB.ID)
	if noAplicadoB != 600 {
		t.Fatalf("noAplicadoB=%v, want 600 (900-300)", noAplicadoB)
	}
}

// --- Test fundamental del Blueprint: deuda=1000, servicio=300, pago de deuda=1000 ------------------------------
//
// Escenario exacto del Blueprint (docs/blueprint-financiero-definitivo-2026-09-14.md §22) y de la
// auditoría de Fase 3: demuestra que ningún saldo queda negativo y que el dinero de servicio no
// contamina el cálculo de deuda — el bug que esta fase reemplaza (`totalDocuments - totalPayments`
// habría dado 1000 - 1300 = -300, un saldo negativo falso).

func TestFinancialTotals_BlueprintScenario_NoNegativeBalance(t *testing.T) {
	db := setupFinancialTotalsTestDB(t)
	svc := debtsvc.NewService()
	co := seedFTCompany(t, db, "20930000019")

	doc := seedFTDocument(t, db, co.ID, "1", "pagado", "", 1000, 0) // saldada por la allocation de 1000
	seedFTPayment(t, db, co.ID, 300, ftStrPtr(models.PaymentPurposeService))
	payDeuda := seedFTPayment(t, db, co.ID, 1000, ftStrPtr(models.PaymentPurposeDebt))
	seedFTAllocation(t, db, payDeuda.ID, doc.ID, 1000)

	saldo, err := svc.SaldoDocumentado(db, co.ID)
	if err != nil {
		t.Fatalf("SaldoDocumentado: %v", err)
	}
	if saldo != 0 {
		t.Fatalf("SaldoDocumentado=%v, want 0", saldo)
	}
	if saldo < 0 {
		t.Fatalf("SaldoDocumentado nunca debe ser negativo, got %v", saldo)
	}

	recibido, err := svc.DineroTotalRecibido(db, co.ID)
	if err != nil {
		t.Fatalf("DineroTotalRecibido: %v", err)
	}
	if recibido != 1300 {
		t.Fatalf("DineroTotalRecibido=%v, want 1300 (300+1000)", recibido)
	}

	aplicado, err := svc.DineroAplicadoADeudas(db, co.ID)
	if err != nil {
		t.Fatalf("DineroAplicadoADeudas: %v", err)
	}
	if aplicado != 1000 {
		t.Fatalf("DineroAplicadoADeudas=%v, want 1000", aplicado)
	}

	noAplicado, err := svc.DineroNoAplicado(db, co.ID)
	if err != nil {
		t.Fatalf("DineroNoAplicado: %v", err)
	}
	if noAplicado != 0 {
		t.Fatalf("DineroNoAplicado=%v, want 0 (el pago de deuda quedó totalmente aplicado; el de servicio nunca cuenta aquí)", noAplicado)
	}
	if noAplicado < 0 {
		t.Fatalf("DineroNoAplicado nunca debe ser negativo, got %v", noAplicado)
	}
}
