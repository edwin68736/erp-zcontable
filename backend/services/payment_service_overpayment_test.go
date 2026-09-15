package services

// Tests de Fase 2.3 a través de la API pública real (CreateFromParams) — confirma que el sobrepago
// con remanente funciona en los modos single, fifo y manual tal como los usa la aplicación, no solo
// a nivel del motor interno de debt.ApplyPaymentTx.

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupOverpaymentTestDB(t *testing.T) *gorm.DB {
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

func seedOverpaymentDebt(t *testing.T, db *gorm.DB, companyID uint, number string, amount float64) models.Document {
	t.Helper()
	doc := models.Document{CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: number, TotalAmount: amount, BalanceAmount: amount, Status: "pendiente"}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed debt: %v", err)
	}
	return doc
}

// Ejemplo principal de la instrucción: Deuda A = 700, Payment (FIFO) = 1000 → Allocation=700,
// Remainder=300, sin crear un segundo Document ni un segundo Payment.
func TestCreateFromParams_FIFO_Overpayment_RemainderPreserved(t *testing.T) {
	db := setupOverpaymentTestDB(t)
	co := models.Company{RUC: "20910000001", BusinessName: "FIFO Overpay Co"}
	db.Create(&co)
	debt := seedOverpaymentDebt(t, db, co.ID, "A", 700)

	svc := NewPaymentService()
	id, err := svc.CreateFromParams(&PaymentCreateParams{
		CompanyID: co.ID, Amount: 1000, Type: "applied", AllocationMode: "fifo",
	})
	if err != nil {
		t.Fatalf("CreateFromParams (fifo) no debía fallar por sobrepago: %v", err)
	}

	var pay models.Payment
	db.First(&pay, id)
	if pay.Amount != 1000 {
		t.Fatalf("Payment.amount=%v, want 1000", pay.Amount)
	}
	if pay.Type != "applied" {
		t.Fatalf("Type=%s, want applied", pay.Type)
	}

	var applied float64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", id).Select("COALESCE(SUM(amount),0)").Scan(&applied)
	if applied != 700 {
		t.Fatalf("aplicado=%v, want 700", applied)
	}
	if remainder := pay.Amount - applied; remainder != 300 {
		t.Fatalf("remanente=%v, want 300", remainder)
	}

	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.BalanceAmount != 0 || reloadedDoc.Status != "pagado" {
		t.Fatalf("deuda debía quedar pagada, got balance=%v status=%s", reloadedDoc.BalanceAmount, reloadedDoc.Status)
	}

	var totalPayments, totalDocs int64
	db.Model(&models.Payment{}).Count(&totalPayments)
	db.Model(&models.Document{}).Count(&totalDocs)
	if totalPayments != 1 {
		t.Fatalf("no debía crearse un segundo Payment, count=%d", totalPayments)
	}
	if totalDocs != 1 {
		t.Fatalf("no debía crearse un Document artificial para el remanente, count=%d", totalDocs)
	}
}

// Modo "single" (un solo documento vía document_id): Payment=150, Debt=100 -> Allocation=100,
// Remainder=50 (antes de Fase 2.3 esto fallaba porque intentaba imputar el monto completo, 150,
// contra un saldo de 100).
func TestCreateFromParams_SingleDocument_Overpayment_RemainderPreserved(t *testing.T) {
	db := setupOverpaymentTestDB(t)
	co := models.Company{RUC: "20910000002", BusinessName: "Single Overpay Co"}
	db.Create(&co)
	debt := seedOverpaymentDebt(t, db, co.ID, "B", 100)

	svc := NewPaymentService()
	docID := debt.ID
	id, err := svc.CreateFromParams(&PaymentCreateParams{
		CompanyID: co.ID, Amount: 150, Type: "applied", DocumentID: &docID,
	})
	if err != nil {
		t.Fatalf("CreateFromParams (single) no debía fallar por sobrepago: %v", err)
	}

	var pay models.Payment
	db.First(&pay, id)
	if pay.Amount != 150 {
		t.Fatalf("Payment.amount=%v, want 150", pay.Amount)
	}

	var applied float64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", id).Select("COALESCE(SUM(amount),0)").Scan(&applied)
	if applied != 100 {
		t.Fatalf("aplicado=%v, want 100", applied)
	}
	if remainder := pay.Amount - applied; remainder != 50 {
		t.Fatalf("remanente=%v, want 50", remainder)
	}

	var reloadedDoc models.Document
	db.First(&reloadedDoc, debt.ID)
	if reloadedDoc.BalanceAmount != 0 || reloadedDoc.Status != "pagado" {
		t.Fatalf("deuda debía quedar pagada, got balance=%v status=%s", reloadedDoc.BalanceAmount, reloadedDoc.Status)
	}
}

// Modo manual, sobrepago repartido contra varias deudas.
func TestCreateFromParams_Manual_Overpayment_MultipleDebts(t *testing.T) {
	db := setupOverpaymentTestDB(t)
	co := models.Company{RUC: "20910000003", BusinessName: "Manual Overpay Co"}
	db.Create(&co)
	debtA := seedOverpaymentDebt(t, db, co.ID, "C", 300)
	debtB := seedOverpaymentDebt(t, db, co.ID, "D", 200)

	svc := NewPaymentService()
	id, err := svc.CreateFromParams(&PaymentCreateParams{
		CompanyID: co.ID, Amount: 1000, Type: "applied",
		Allocations: []PaymentAllocationInput{
			{DocumentID: debtA.ID, Amount: 300},
			{DocumentID: debtB.ID, Amount: 200},
		},
	})
	if err != nil {
		t.Fatalf("CreateFromParams (manual) no debía fallar por sobrepago: %v", err)
	}
	var applied float64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", id).Select("COALESCE(SUM(amount),0)").Scan(&applied)
	if applied != 500 {
		t.Fatalf("aplicado=%v, want 500", applied)
	}
	var pay models.Payment
	db.First(&pay, id)
	if remainder := pay.Amount - applied; remainder != 500 {
		t.Fatalf("remanente=%v, want 500", remainder)
	}
}

// Pago exacto contra la única deuda (regresión: debe funcionar exactamente igual que antes).
func TestCreateFromParams_FIFO_ExactPayment_NoRemainder(t *testing.T) {
	db := setupOverpaymentTestDB(t)
	co := models.Company{RUC: "20910000004", BusinessName: "Exact Co"}
	db.Create(&co)
	seedOverpaymentDebt(t, db, co.ID, "E", 1000)

	svc := NewPaymentService()
	id, err := svc.CreateFromParams(&PaymentCreateParams{
		CompanyID: co.ID, Amount: 1000, Type: "applied", AllocationMode: "fifo",
	})
	if err != nil {
		t.Fatalf("CreateFromParams: %v", err)
	}
	var applied float64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", id).Select("COALESCE(SUM(amount),0)").Scan(&applied)
	if applied != 1000 {
		t.Fatalf("aplicado=%v, want 1000", applied)
	}
}

// FIFO sin ninguna deuda en absoluto (allowPartial no expuesto por la API) sigue rechazándose —
// comportamiento sin cambios, fuera del alcance de Fase 2.3.
func TestCreateFromParams_FIFO_NoDebtAtAll_StillRejected(t *testing.T) {
	db := setupOverpaymentTestDB(t)
	co := models.Company{RUC: "20910000005", BusinessName: "No Debt Co"}
	db.Create(&co)

	svc := NewPaymentService()
	_, err := svc.CreateFromParams(&PaymentCreateParams{
		CompanyID: co.ID, Amount: 500, Type: "applied", AllocationMode: "fifo",
	})
	if err == nil {
		t.Fatal("FIFO sin ninguna deuda pendiente debe seguir rechazándose (comportamiento sin cambios en Fase 2.3)")
	}
}
