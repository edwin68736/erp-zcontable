package debt_test

// Tests de Fase 2.4 (docs/implementacion-fase2-4-allocate-existing-2026-09-14.md):
// debt.AllocateExistingPaymentTx — aplicar dinero de un Payment ya existente a una o varias deudas,
// sin crear un Payment ni un Document nuevo.

import (
	"testing"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupAllocateExistingTestDB(t *testing.T) *gorm.DB {
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
		&models.TukifacFiscalReceipt{},
		&models.FiscalReceiptLine{},
		&models.FiscalReceiptPayment{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func aeStrPtr(s string) *string { return &s }

func seedAECompany(t *testing.T, db *gorm.DB) models.Company {
	t.Helper()
	co := models.Company{RUC: "20920000001", BusinessName: "AllocateExisting Test Co"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedAEDebt(t *testing.T, db *gorm.DB, companyID uint, number string, amount float64) models.Document {
	t.Helper()
	doc := models.Document{CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: number, TotalAmount: amount, BalanceAmount: amount, Status: "pendiente"}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed debt %s: %v", number, err)
	}
	return doc
}

func seedAEPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, ptype string, purpose *string) models.Payment {
	t.Helper()
	p := models.Payment{CompanyID: companyID, Amount: amount, Type: ptype, Purpose: purpose, Method: "Yape", Reference: "OP-ORIGINAL", Description: "desc original"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	return p
}

func aeAppliedSum(db *gorm.DB, paymentID uint) float64 {
	var sum float64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", paymentID).
		Select("COALESCE(SUM(amount),0)").Scan(&sum)
	return sum
}

// --- Item 1: on_account -> allocation parcial -------------------------------------------------------

func TestAllocateExisting_OnAccount_PartialAllocation(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "1", 300)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 300}},
	})
	if err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}
	if applied := aeAppliedSum(db, pay.ID); applied != 300 {
		t.Fatalf("aplicado=%v, want 300", applied)
	}
	var reloaded models.Payment
	db.First(&reloaded, pay.ID)
	if reloaded.Amount != 500 {
		t.Fatalf("Payment.amount=%v, want 500", reloaded.Amount)
	}
}

// --- Item 2: on_account -> allocation completa -------------------------------------------------------

func TestAllocateExisting_OnAccount_FullAllocation(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "2", 500)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 500}},
	}); err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}
	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.BalanceAmount != 0 || reloadedDoc.Status != "pagado" {
		t.Fatalf("deuda debía quedar pagada, got balance=%v status=%s", reloadedDoc.BalanceAmount, reloadedDoc.Status)
	}
}

// --- Item 3 / test explícito §17: Payment=1000, existing=600, new=250 -> total=850, remainder=150 ---

func TestAllocateExisting_PartiallyApplied_ApplyRemainder(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debtA := seedAEDebt(t, db, co.ID, "3a", 600)
	debtB := seedAEDebt(t, db, co.ID, "3b", 250)
	pay := seedAEPayment(t, db, co.ID, 1000, "applied", aeStrPtr(models.PaymentPurposeDebt))
	db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: debtA.ID, Amount: 600})

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debtB.ID, Amount: 250}},
	}); err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}
	applied := aeAppliedSum(db, pay.ID)
	if applied != 850 {
		t.Fatalf("total allocations=%v, want 850", applied)
	}
	var reloaded models.Payment
	db.First(&reloaded, pay.ID)
	if reloaded.Amount != 1000 {
		t.Fatalf("Payment.amount=%v, want 1000", reloaded.Amount)
	}
	if remainder := reloaded.Amount - applied; remainder != 150 {
		t.Fatalf("remainder=%v, want 150", remainder)
	}
}

// --- Item 4: múltiples documentos --------------------------------------------------------------------

func TestAllocateExisting_MultipleDocuments(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debtA := seedAEDebt(t, db, co.ID, "4a", 200)
	debtB := seedAEDebt(t, db, co.ID, "4b", 300)
	debtC := seedAEDebt(t, db, co.ID, "4c", 100)
	pay := seedAEPayment(t, db, co.ID, 1000, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{
			{DocumentID: debtA.ID, Amount: 200},
			{DocumentID: debtB.ID, Amount: 300},
			{DocumentID: debtC.ID, Amount: 100},
		},
	}); err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}
	applied := aeAppliedSum(db, pay.ID)
	if applied != 600 {
		t.Fatalf("aplicado=%v, want 600", applied)
	}
	var reloaded models.Payment
	db.First(&reloaded, pay.ID)
	if remainder := reloaded.Amount - applied; remainder != 400 {
		t.Fatalf("remainder=%v, want 400", remainder)
	}
}

// --- Item 5: sin remanente disponible -> rechazar ----------------------------------------------------

func TestAllocateExisting_Rejects_NoRemainderAvailable(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debtA := seedAEDebt(t, db, co.ID, "5a", 1000)
	debtB := seedAEDebt(t, db, co.ID, "5b", 100)
	pay := seedAEPayment(t, db, co.ID, 1000, "applied", aeStrPtr(models.PaymentPurposeDebt))
	db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: debtA.ID, Amount: 1000})

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debtB.ID, Amount: 1}},
	})
	if err == nil {
		t.Fatal("un pago sin remanente disponible debe rechazar cualquier nueva imputación")
	}
}

// --- Item 6 / §19 rollback: allocation > remainder -> rechazo total, nada persiste -------------------

func TestAllocateExisting_Rejects_ExceedsRemainder_NoPartialPersist(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debtA := seedAEDebt(t, db, co.ID, "6a", 200)
	debtB := seedAEDebt(t, db, co.ID, "6b", 400)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{
			{DocumentID: debtA.ID, Amount: 200},
			{DocumentID: debtB.ID, Amount: 400}, // 200+400=600 > disponible 500
		},
	})
	if err == nil {
		t.Fatal("la suma de las nuevas imputaciones excede el disponible; debía rechazarse por completo")
	}
	if applied := aeAppliedSum(db, pay.ID); applied != 0 {
		t.Fatalf("ROLLBACK esperado: no debía persistir ninguna allocation (ni A ni B), got total=%v", applied)
	}
	var reloadedA, reloadedB models.Document
	db.First(&reloadedA, debtA.ID)
	db.First(&reloadedB, debtB.ID)
	if reloadedA.BalanceAmount != 200 || reloadedB.BalanceAmount != 400 {
		t.Fatalf("los documentos no debían modificarse: A=%v B=%v", reloadedA.BalanceAmount, reloadedB.BalanceAmount)
	}
}

// --- Item 7: allocation > saldo del Document ---------------------------------------------------------

func TestAllocateExisting_Rejects_ExceedsDocumentBalance(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "7", 100)
	pay := seedAEPayment(t, db, co.ID, 1000, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 150}},
	})
	if err == nil {
		t.Fatal("aunque el pago tenga dinero suficiente, no puede exceder el saldo del documento")
	}
}

// --- Item 8: purpose=servicio -> rechazar --------------------------------------------------------------

func TestAllocateExisting_Rejects_PurposeServicio(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "8", 100)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeService))

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err == nil {
		t.Fatal("un pago purpose=servicio nunca debe poder aplicarse a una deuda")
	}
}

// --- Item 9: purpose=NULL -> rechazar --------------------------------------------------------------

func TestAllocateExisting_Rejects_PurposeNull(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "9", 100)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", nil)

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err == nil {
		t.Fatal("un pago sin Purpose clasificado no debe poder aplicarse a una deuda (no se adivina)")
	}
}

// --- Item 10: Estado B legacy (DocumentID sin allocations) -> rechazar --------------------------------

func TestAllocateExisting_Rejects_LegacyDocumentIDStateB(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	legacyDoc := seedAEDebt(t, db, co.ID, "10-legacy", 200)
	newDoc := seedAEDebt(t, db, co.ID, "10-new", 100)
	pay := models.Payment{
		CompanyID: co.ID, Amount: 200, Type: "applied", Purpose: aeStrPtr(models.PaymentPurposeDebt),
		DocumentID: &legacyDoc.ID, // Estado B: DocumentID set, CERO PaymentAllocation todavía
	}
	if err := db.Create(&pay).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: newDoc.ID, Amount: 100}},
	})
	if err == nil {
		t.Fatal("Estado B (DocumentID legacy sin allocations sincronizadas) debe rechazarse explícitamente")
	}
	if applied := aeAppliedSum(db, pay.ID); applied != 0 {
		t.Fatalf("no debía crearse ninguna allocation, got %v", applied)
	}
}

// --- Item 11 + Estado C/E: DocumentID legacy YA sincronizado (con allocation) -> permitir -------------

func TestAllocateExisting_AllowsStateC_LegacyDocumentIDAlreadySynced(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	legacyDoc := seedAEDebt(t, db, co.ID, "11-legacy", 400)
	newDoc := seedAEDebt(t, db, co.ID, "11-new", 100)
	pay := models.Payment{
		CompanyID: co.ID, Amount: 500, Type: "applied", Purpose: aeStrPtr(models.PaymentPurposeDebt),
		DocumentID: &legacyDoc.ID, // Estado C: DocumentID legacy, PERO ya tiene su allocation equivalente
	}
	if err := db.Create(&pay).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: legacyDoc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("seed alloc: %v", err)
	}

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: newDoc.ID, Amount: 100}},
	}); err != nil {
		t.Fatalf("Estado C (DocumentID legacy ya sincronizado) debía permitirse: %v", err)
	}
	if applied := aeAppliedSum(db, pay.ID); applied != 500 {
		t.Fatalf("aplicado=%v, want 500", applied)
	}
	var reloadedPay models.Payment
	db.First(&reloadedPay, pay.ID)
	if reloadedPay.DocumentID == nil || *reloadedPay.DocumentID != legacyDoc.ID {
		t.Fatalf("DocumentID legacy no debía modificarse, got %v", reloadedPay.DocumentID)
	}
}

// --- Item 12: comprobante vinculado permanece intacto --------------------------------------------------

func TestAllocateExisting_DoesNotTouchFiscalReceipt(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "12", 300)
	pay := seedAEPayment(t, db, co.ID, 300, "on_account", aeStrPtr(models.PaymentPurposeDebt))
	receipt := models.TukifacFiscalReceipt{
		ExternalID: "issued-test-12", CompanyID: co.ID, Number: "B001-000012", Total: 300,
		ReconciliationStatus: models.TukifacReceiptLinked, LinkedPaymentID: &pay.ID,
		Origin: models.TukifacReceiptOriginIssuedLocal,
	}
	if err := db.Create(&receipt).Error; err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 300}},
	}); err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}
	var reloadedReceipt models.TukifacFiscalReceipt
	db.First(&reloadedReceipt, receipt.ID)
	if reloadedReceipt.Total != 300 || reloadedReceipt.ReconciliationStatus != models.TukifacReceiptLinked {
		t.Fatalf("el comprobante vinculado fue modificado: total=%v status=%s", reloadedReceipt.Total, reloadedReceipt.ReconciliationStatus)
	}
	if reloadedReceipt.LinkedPaymentID == nil || *reloadedReceipt.LinkedPaymentID != pay.ID {
		t.Fatalf("el vínculo del comprobante fue alterado: %v", reloadedReceipt.LinkedPaymentID)
	}
}

// --- Item 13-15 + §18 no-mutación: amount/date/method/reference/description/Purpose/DocumentID -------

func TestAllocateExisting_NoMutationOfUnrelatedFields(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "13", 300)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))
	originalDate := pay.Date

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 300}},
	}); err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}

	var reloaded models.Payment
	db.First(&reloaded, pay.ID)
	if reloaded.Amount != 500 {
		t.Fatalf("Amount modificado: %v", reloaded.Amount)
	}
	if !reloaded.Date.Equal(originalDate) {
		t.Fatalf("Date modificado: %v vs %v", reloaded.Date, originalDate)
	}
	if reloaded.Method != "Yape" {
		t.Fatalf("Method modificado: %v", reloaded.Method)
	}
	if reloaded.Reference != "OP-ORIGINAL" {
		t.Fatalf("Reference modificado: %v", reloaded.Reference)
	}
	if reloaded.Description != "desc original" {
		t.Fatalf("Description modificado: %v", reloaded.Description)
	}
	if reloaded.Purpose == nil || *reloaded.Purpose != models.PaymentPurposeDebt {
		t.Fatalf("Purpose modificado: %v", reloaded.Purpose)
	}
	if reloaded.DocumentID != nil {
		t.Fatalf("DocumentID no debía poblarse por AllocateExisting: %v", *reloaded.DocumentID)
	}
	// Único campo que SÍ debe cambiar: Type (on_account -> applied), verificado en tests dedicados.
	if reloaded.Type != "applied" {
		t.Fatalf("Type debía pasar a applied (única mutación esperada), got %s", reloaded.Type)
	}
}

// --- Item 14: Type on_account -> applied ---------------------------------------------------------------

func TestAllocateExisting_TypeChangesOnAccountToApplied(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "14", 100)
	pay := seedAEPayment(t, db, co.ID, 100, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	}); err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}
	var reloaded models.Payment
	db.First(&reloaded, pay.ID)
	if reloaded.Type != "applied" {
		t.Fatalf("Type=%s, want applied", reloaded.Type)
	}
}

// --- Item 15: Type applied permanece applied ------------------------------------------------------------

func TestAllocateExisting_TypeStaysAppliedIfAlreadyApplied(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debtA := seedAEDebt(t, db, co.ID, "15a", 100)
	debtB := seedAEDebt(t, db, co.ID, "15b", 100)
	pay := seedAEPayment(t, db, co.ID, 300, "applied", aeStrPtr(models.PaymentPurposeDebt))
	db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: debtA.ID, Amount: 100})

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debtB.ID, Amount: 100}},
	}); err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}
	var reloaded models.Payment
	db.First(&reloaded, pay.ID)
	if reloaded.Type != "applied" {
		t.Fatalf("Type=%s, want applied (sin cambios)", reloaded.Type)
	}
}

// --- Items 16-17: Document.balance_amount y status recalculados correctamente ---------------------------

func TestAllocateExisting_DocumentBalanceAndStatusRecalculated(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "16", 300)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	if err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 200}},
	}); err != nil {
		t.Fatalf("AllocateExistingPaymentTx: %v", err)
	}
	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.BalanceAmount != 100 {
		t.Fatalf("balance=%v, want 100", reloadedDoc.BalanceAmount)
	}
	if reloadedDoc.Status != "parcial" {
		t.Fatalf("status=%s, want parcial", reloadedDoc.Status)
	}
}

// --- Item 19: CompanyID incorrecto -> rechazar ---------------------------------------------------------

func TestAllocateExisting_Rejects_CompanyIDMismatch(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	otherCo := models.Company{RUC: "20920000002", BusinessName: "Otra Empresa"}
	db.Create(&otherCo)
	debt := seedAEDebt(t, db, co.ID, "19", 100)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: otherCo.ID, // company incorrecta
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err == nil {
		t.Fatal("un CompanyID que no coincide con el del pago debe rechazarse")
	}
}

// --- Revisión de cobertura 2026-09-14: Document de UNA LÍNEA perteneciente a otra empresa distinta
// a la del Payment (in.CompanyID SÍ coincide con pay.CompanyID; el documento imputado es el que no
// pertenece). Distinto del caso anterior (in.CompanyID incorrecto). ValidateAllocationsTx ya está
// probado para ApplyPaymentTx (payment_apply_remainder_test.go), pero se agrega aquí como
// verificación de regresión propia del nuevo punto de integración AllocateExistingPaymentTx.

func TestAllocateExisting_Rejects_DocumentFromDifferentCompany(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	otherCo := models.Company{RUC: "20920000003", BusinessName: "Empresa Del Documento"}
	db.Create(&otherCo)
	foreignDebt := seedAEDebt(t, db, otherCo.ID, "19b", 100) // pertenece a otherCo, no a co
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID, // CompanyID del request SÍ coincide con el del pago
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: foreignDebt.ID, Amount: 50}},
	})
	if err == nil {
		t.Fatal("un documento que pertenece a otra empresa distinta a la del pago debe rechazarse, aunque el CompanyID del request sea correcto")
	}
	if applied := aeAppliedSum(db, pay.ID); applied != 0 {
		t.Fatalf("no debía persistir ninguna allocation, got %v", applied)
	}
}

// --- Item 20: Document anulado -> rechazar --------------------------------------------------------------

func TestAllocateExisting_Rejects_CancelledDocument(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := models.Document{CompanyID: co.ID, Source: "manual", Type: "FACTURA", Number: "20", TotalAmount: 100, BalanceAmount: 100, Status: "anulado"}
	db.Create(&debt)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 50}},
	})
	if err == nil {
		t.Fatal("no se puede imputar a un documento anulado")
	}
}

// --- Item 21: Document repetido en la misma llamada -> rechazar ------------------------------------------

func TestAllocateExisting_Rejects_DuplicateDocumentInSameCall(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "21", 300)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{
			{DocumentID: debt.ID, Amount: 100},
			{DocumentID: debt.ID, Amount: 100},
		},
	})
	if err == nil {
		t.Fatal("no se puede repetir el mismo documento dentro de la misma llamada")
	}
}

// --- Item 22: Payment inexistente -> rechazar -------------------------------------------------------------

func TestAllocateExisting_Rejects_PaymentNotFound(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "22", 100)

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: 999999, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 50}},
	})
	if err == nil {
		t.Fatal("un payment_id inexistente debe rechazarse")
	}
}

// --- Item 23: Payment soft-deleted -> rechazar --------------------------------------------------------------

func TestAllocateExisting_Rejects_SoftDeletedPayment(t *testing.T) {
	db := setupAllocateExistingTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedAEDebt(t, db, co.ID, "23", 100)
	pay := seedAEPayment(t, db, co.ID, 500, "on_account", aeStrPtr(models.PaymentPurposeDebt))
	if err := db.Delete(&pay).Error; err != nil { // soft delete
		t.Fatalf("soft delete: %v", err)
	}

	err := svc.AllocateExistingPaymentTx(db, debtsvc.AllocateExistingInput{
		PaymentID: pay.ID, CompanyID: co.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 50}},
	})
	if err == nil {
		t.Fatal("un pago eliminado (soft-delete) no debe poder recibir nuevas aplicaciones")
	}
}
