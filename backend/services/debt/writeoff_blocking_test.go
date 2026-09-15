package debt_test

// Fase 6 Paso 3 (docs/diseno-fase6-paso2-cancelaciones-writeoff-2026-09-15.md C.3, decisión E.4):
// WriteOffUnlinkedDebt debe bloquear exonerar/anular una deuda que todavía tiene dinero real
// aplicado (vía PaymentAllocation o vía el esquema legacy Payment.DocumentID) y saldo pendiente.

import (
	"testing"
	"time"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupWriteoffBlockingTestDB(t *testing.T) *gorm.DB {
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

func seedWOCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "Writeoff Blocking Test " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedWODocument(t *testing.T, db *gorm.DB, companyID uint, total, balance float64) models.Document {
	t.Helper()
	d := models.Document{
		CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: "F-WO",
		IssueDate: time.Now(), TotalAmount: total, BalanceAmount: balance, Status: debtsvc.StatusPartial,
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatalf("document: %v", err)
	}
	return d
}

// --- Item 10: bloqueado con PaymentAllocation + saldo pendiente ----------------------------------------

func TestWriteOffUnlinkedDebt_BlockedWithAllocationAndPendingBalance(t *testing.T) {
	db := setupWriteoffBlockingTestDB(t)
	svc := debtsvc.NewService()
	co := seedWOCompany(t, db, "20960000001")
	doc := seedWODocument(t, db, co.ID, 1000, 600)

	pay := models.Payment{CompanyID: co.ID, Amount: 400, Type: "applied", Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&pay).Error; err != nil {
		t.Fatalf("payment: %v", err)
	}
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}).Error; err != nil {
		t.Fatalf("allocation: %v", err)
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		_, e := svc.WriteOffUnlinkedDebt(tx, doc.ID, debtsvc.WriteoffActionExonerar, "condonación comercial", 1)
		return e
	})
	if err == nil {
		t.Fatal("debía bloquearse: existe PaymentAllocation > 0 y balance_amount > 0")
	}

	var got models.Document
	db.First(&got, doc.ID)
	if got.Status != debtsvc.StatusPartial || got.BalanceAmount != 600 {
		t.Fatalf("el documento no debía modificarse tras el bloqueo, got status=%s balance=%v", got.Status, got.BalanceAmount)
	}
}

// --- Item 10b (E.4): bloqueado también con pago legacy (Payment.DocumentID directo, sin Allocation) ----

func TestWriteOffUnlinkedDebt_BlockedWithLegacyPaymentAndPendingBalance(t *testing.T) {
	db := setupWriteoffBlockingTestDB(t)
	svc := debtsvc.NewService()
	co := seedWOCompany(t, db, "20960000002")
	doc := seedWODocument(t, db, co.ID, 1000, 600)

	did := doc.ID
	legacyPay := models.Payment{CompanyID: co.ID, DocumentID: &did, Amount: 400, Type: "applied", Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&legacyPay).Error; err != nil {
		t.Fatalf("legacy payment: %v", err)
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		_, e := svc.WriteOffUnlinkedDebt(tx, doc.ID, debtsvc.WriteoffActionEliminar, "anulación comercial", 1)
		return e
	})
	if err == nil {
		t.Fatal("debía bloquearse también con un pago legacy (E.4), no solo con PaymentAllocation")
	}
}

// --- Item 11: permitido sin ningún pago (regresión — no debe romperse el comportamiento existente) -----

func TestWriteOffUnlinkedDebt_AllowedWithoutAnyPayment(t *testing.T) {
	db := setupWriteoffBlockingTestDB(t)
	svc := debtsvc.NewService()
	co := seedWOCompany(t, db, "20960000003")
	doc := seedWODocument(t, db, co.ID, 500, 500)

	var got *models.Document
	err := db.Transaction(func(tx *gorm.DB) error {
		d, e := svc.WriteOffUnlinkedDebt(tx, doc.ID, debtsvc.WriteoffActionExonerar, "sin pagos", 1)
		got = d
		return e
	})
	if err != nil {
		t.Fatalf("una deuda sin ningún pago debía poder exonerarse: %v", err)
	}
	if got.Status != debtsvc.StatusExonerado || got.BalanceAmount != 0 {
		t.Fatalf("status=%s balance=%v, want exonerado/0", got.Status, got.BalanceAmount)
	}
	if got.WriteoffReason != "sin pagos" || got.WriteoffBy == nil || *got.WriteoffBy != 1 {
		t.Fatal("writeoff_reason/writeoff_by debían quedar fijados (comportamiento preexistente)")
	}
}

// --- Item 12: permitido tras liberar el dinero ya aplicado (revertir la allocation primero) ------------

func TestWriteOffUnlinkedDebt_AllowedAfterAllocationReverted(t *testing.T) {
	db := setupWriteoffBlockingTestDB(t)
	svc := debtsvc.NewService()
	co := seedWOCompany(t, db, "20960000004")
	doc := seedWODocument(t, db, co.ID, 1000, 600)

	pay := models.Payment{CompanyID: co.ID, Amount: 400, Type: "applied", Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&pay).Error; err != nil {
		t.Fatalf("payment: %v", err)
	}
	alloc := models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}
	if err := db.Create(&alloc).Error; err != nil {
		t.Fatalf("allocation: %v", err)
	}

	// Bloqueado mientras exista la allocation.
	err := db.Transaction(func(tx *gorm.DB) error {
		_, e := svc.WriteOffUnlinkedDebt(tx, doc.ID, debtsvc.WriteoffActionExonerar, "primero bloqueado", 1)
		return e
	})
	if err == nil {
		t.Fatal("debía seguir bloqueado con la allocation todavía presente")
	}

	// Se libera el dinero (simula la reversión que haría DeletePaymentTx: borra la allocation).
	if err := db.Delete(&alloc).Error; err != nil {
		t.Fatalf("revertir allocation: %v", err)
	}

	var got *models.Document
	err = db.Transaction(func(tx *gorm.DB) error {
		d, e := svc.WriteOffUnlinkedDebt(tx, doc.ID, debtsvc.WriteoffActionExonerar, "ahora sí", 1)
		got = d
		return e
	})
	if err != nil {
		t.Fatalf("tras liberar el dinero aplicado, el write-off debía permitirse: %v", err)
	}
	if got.Status != debtsvc.StatusExonerado {
		t.Fatalf("status=%s, want exonerado", got.Status)
	}
}
