package debt_test

// Tests de Fase 2.3 (docs/implementacion-fase2-3-sobrepagos-2026-09-14.md): permitir que
// SUM(PaymentAllocation.amount) < Payment.amount cuando no hay descuento, dejando la diferencia
// como remanente sin aplicar dentro del mismo Payment — sin relajar la protección de que ninguna
// imputación individual exceda el saldo del Document que recibe.

import (
	"testing"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupRemainderTestDB(t *testing.T) *gorm.DB {
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
	return db
}

func seedRemainderCompany(t *testing.T, db *gorm.DB) models.Company {
	t.Helper()
	co := models.Company{RUC: "20900000001", BusinessName: "Empresa Remainder Test"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedRemainderDebt(t *testing.T, db *gorm.DB, companyID uint, number string, amount float64) models.Document {
	t.Helper()
	doc := models.Document{
		CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: number,
		TotalAmount: amount, BalanceAmount: amount, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed debt %s: %v", number, err)
	}
	return doc
}

func sumAllocations(db *gorm.DB, paymentID uint) float64 {
	var sum float64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", paymentID).
		Select("COALESCE(SUM(amount),0)").Scan(&sum)
	return sum
}

// --- Test 1: pago exacto (regresión, sin cambio de comportamiento) ---------------------------------

func TestOverpayment_ExactPayment_NoRemainder(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "1", 100)

	id, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 100,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err != nil {
		t.Fatalf("ApplyPaymentTx: %v", err)
	}
	applied := sumAllocations(db, id)
	if applied != 100 {
		t.Fatalf("aplicado=%v, want 100", applied)
	}
	var pay models.Payment
	db.First(&pay, id)
	remainder := pay.Amount - applied
	if remainder != 0 {
		t.Fatalf("remanente=%v, want 0", remainder)
	}
	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.BalanceAmount != 0 || reloadedDoc.Status != "pagado" {
		t.Fatalf("deuda debía quedar pagada, got balance=%v status=%s", reloadedDoc.BalanceAmount, reloadedDoc.Status)
	}
}

// --- Test 2: pago parcial de una deuda (regresión — NO es sobrepago) -------------------------------

func TestOverpayment_PartialDebtPayment_StillWorksAsBefore(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "2", 100)

	id, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 60,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 60}},
	})
	if err != nil {
		t.Fatalf("ApplyPaymentTx: %v", err)
	}
	applied := sumAllocations(db, id)
	if applied != 60 {
		t.Fatalf("aplicado=%v, want 60", applied)
	}
	var pay models.Payment
	db.First(&pay, id)
	if pay.Amount-applied != 0 {
		t.Fatalf("un pago parcial de deuda no tiene remanente propio: got %v", pay.Amount-applied)
	}
	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.BalanceAmount != 40 || reloadedDoc.Status != "parcial" {
		t.Fatalf("deuda debía quedar parcial con saldo 40, got balance=%v status=%s", reloadedDoc.BalanceAmount, reloadedDoc.Status)
	}
}

// --- Test 3: sobrepago contra una sola deuda (el caso central de esta fase) ------------------------

func TestOverpayment_SingleDebt_RemainderPreserved(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "3", 100)

	id, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 150,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err != nil {
		t.Fatalf("ApplyPaymentTx no debía fallar por sobrepago con remanente: %v", err)
	}
	applied := sumAllocations(db, id)
	if applied != 100 {
		t.Fatalf("aplicado=%v, want 100", applied)
	}
	var pay models.Payment
	db.First(&pay, id)
	if pay.Amount != 150 {
		t.Fatalf("Payment.amount debía preservarse en 150, got %v", pay.Amount)
	}
	if pay.Type != "applied" {
		t.Fatalf("Type debía ser 'applied' (tiene allocation), got %s", pay.Type)
	}
	remainder := pay.Amount - applied
	if remainder != 50 {
		t.Fatalf("remanente=%v, want 50", remainder)
	}
	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.BalanceAmount != 0 || reloadedDoc.Status != "pagado" {
		t.Fatalf("deuda debía quedar pagada, got balance=%v status=%s", reloadedDoc.BalanceAmount, reloadedDoc.Status)
	}
}

// --- Test 4: sobrepago repartido contra varias deudas ------------------------------------------------

func TestOverpayment_MultipleDebts_RemainderPreserved(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debtA := seedRemainderDebt(t, db, co.ID, "4a", 100)
	debtB := seedRemainderDebt(t, db, co.ID, "4b", 200)

	id, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 500,
		Lines: []debtsvc.PaymentAllocationLine{
			{DocumentID: debtA.ID, Amount: 100},
			{DocumentID: debtB.ID, Amount: 200},
		},
	})
	if err != nil {
		t.Fatalf("ApplyPaymentTx: %v", err)
	}
	applied := sumAllocations(db, id)
	if applied != 300 {
		t.Fatalf("aplicado=%v, want 300", applied)
	}
	var pay models.Payment
	db.First(&pay, id)
	if pay.Amount != 500 {
		t.Fatalf("Payment.amount debía preservarse en 500, got %v", pay.Amount)
	}
	if remainder := pay.Amount - applied; remainder != 200 {
		t.Fatalf("remanente=%v, want 200", remainder)
	}
	for _, d := range []models.Document{debtA, debtB} {
		var reloaded models.Document
		db.First(&reloaded, d.ID)
		if reloaded.BalanceAmount != 0 || reloaded.Status != "pagado" {
			t.Fatalf("deuda %s debía quedar pagada, got balance=%v status=%s", d.Number, reloaded.BalanceAmount, reloaded.Status)
		}
	}
}

// --- Test 5: pago muchísimo mayor que la única deuda existente --------------------------------------

func TestOverpayment_ExceedsAllAvailableDebt_RemainderPreserved(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "5", 100)

	id, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 1000,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err != nil {
		t.Fatalf("ApplyPaymentTx: %v", err)
	}
	applied := sumAllocations(db, id)
	var pay models.Payment
	db.First(&pay, id)
	if pay.Amount != 1000 {
		t.Fatalf("Payment.amount=%v, want 1000", pay.Amount)
	}
	if remainder := pay.Amount - applied; remainder != 900 {
		t.Fatalf("remanente=%v, want 900", remainder)
	}
}

// --- Test 6: NO permitir sobre-imputar el Document (la protección que NO debe relajarse) ------------

func TestOverpayment_RejectsAllocationExceedingDocumentBalance(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "6", 100)

	_, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 150,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 150}},
	})
	if err == nil {
		t.Fatal("una imputación que excede el saldo del Document debe seguir siendo inválida")
	}
	var cnt int64
	db.Model(&models.Payment{}).Count(&cnt)
	if cnt != 0 {
		t.Fatal("no debía crearse ningún Payment si la validación falla")
	}
}

// --- Test 7: NO permitir que la suma de imputaciones exceda el monto del pago -----------------------

func TestOverpayment_RejectsAllocationExceedingPaymentAmount(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "7", 200)

	_, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 100,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 150}},
	})
	if err == nil {
		t.Fatal("la suma de imputaciones no puede exceder el monto del pago, aunque el Document tenga saldo suficiente")
	}
}

// --- Test 8: Payment.amount nunca se modifica para acomodar la aplicación ---------------------------

func TestOverpayment_PaymentAmountNeverModified(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "8", 100)

	id, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 150,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err != nil {
		t.Fatalf("ApplyPaymentTx: %v", err)
	}
	var pay models.Payment
	db.First(&pay, id)
	if pay.Amount != 150 {
		t.Fatalf("Payment.amount fue modificado: got %v, want 150 (el monto real recibido)", pay.Amount)
	}
}

// --- Test 9: el Document queda correctamente pagado con sobrepago -----------------------------------

func TestOverpayment_DocumentFullyPaidWithRemainder(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "9", 100)

	id, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 150,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err != nil {
		t.Fatalf("ApplyPaymentTx: %v", err)
	}
	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.BalanceAmount != 0 {
		t.Fatalf("Document.balance=%v, want 0", reloadedDoc.BalanceAmount)
	}
	if reloadedDoc.Status != "pagado" {
		t.Fatalf("Document.status=%s, want pagado", reloadedDoc.Status)
	}
	var pay models.Payment
	db.First(&pay, id)
	applied := sumAllocations(db, id)
	if remainder := pay.Amount - applied; remainder != 50 {
		t.Fatalf("remainder=%v, want 50", remainder)
	}
}

// --- Casos que deben seguir fallando (§14 de la instrucción) ----------------------------------------

func TestOverpayment_StillRejects_NegativeAllocation(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "10", 100)

	_, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 100,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: -10}},
	})
	if err == nil {
		t.Fatal("una imputación negativa debe seguir siendo inválida")
	}
}

func TestOverpayment_StillRejects_ZeroAllocation(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "11", 100)

	_, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 100,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 0}},
	})
	if err == nil {
		t.Fatal("una imputación de monto cero debe seguir siendo inválida")
	}
}

func TestOverpayment_StillRejects_CancelledDocument(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := models.Document{CompanyID: co.ID, Source: "manual", Type: "FACTURA", Number: "12", TotalAmount: 100, BalanceAmount: 100, Status: "anulado"}
	db.Create(&debt)

	_, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 50,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 50}},
	})
	if err == nil {
		t.Fatal("no se puede imputar a un documento anulado")
	}
}

func TestOverpayment_StillRejects_DocumentFromOtherCompany(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	otherCo := models.Company{RUC: "20900000002", BusinessName: "Otra Empresa"}
	db.Create(&otherCo)
	debt := seedRemainderDebt(t, db, otherCo.ID, "13", 100)

	_, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 50,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 50}},
	})
	if err == nil {
		t.Fatal("no se puede imputar a un documento de otra empresa")
	}
}

func TestOverpayment_StillRejects_DocumentLinkedToOtherSettlement(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	tsA := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusIssued}
	db.Create(&tsA)
	tsB := models.TaxSettlement{CompanyID: co.ID, Status: models.TaxSettlementStatusIssued}
	db.Create(&tsB)
	debt := models.Document{
		CompanyID: co.ID, Source: "liquidacion", Type: "LI", Number: "14",
		TotalAmount: 100, BalanceAmount: 100, Status: "pendiente", TaxSettlementID: &tsA.ID,
	}
	db.Create(&debt)

	_, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 50, TaxSettlementID: &tsB.ID,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 50}},
	})
	if err == nil {
		t.Fatal("no se puede imputar contra una liquidación distinta a la que la deuda ya está vinculada")
	}
}

// --- Regresión: descuento sigue exigiendo igualdad exacta (sin cambios) -----------------------------

func TestOverpayment_DiscountStillRequiresExactMatch(t *testing.T) {
	db := setupRemainderTestDB(t)
	svc := debtsvc.NewService()
	co := seedRemainderCompany(t, db)
	debt := seedRemainderDebt(t, db, co.ID, "15", 100)

	// amount(90) + discount(10) = 100 = saldo completo de la deuda -> válido, sin remanente posible.
	id, err := svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 90, DiscountAmount: 10,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 100}},
	})
	if err != nil {
		t.Fatalf("descuento exacto sobre saldo completo debía seguir funcionando: %v", err)
	}
	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.Status != "pagado" {
		t.Fatalf("deuda con descuento exacto debía quedar pagada, got %s", reloadedDoc.Status)
	}
	_ = id

	// Con descuento, un remanente (sum < amount+discount) sigue sin permitirse — Fase 2.3 no toca
	// la lógica de descuentos.
	debt2 := seedRemainderDebt(t, db, co.ID, "16", 100)
	_, err = svc.ApplyPaymentTx(db, debtsvc.ApplyPaymentInput{
		CompanyID: co.ID, Amount: 90, DiscountAmount: 10,
		Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt2.ID, Amount: 90}},
	})
	if err == nil {
		t.Fatal("con descuento, la imputación debe seguir cubriendo el saldo completo de la deuda; no debe permitirse remanente")
	}
}
