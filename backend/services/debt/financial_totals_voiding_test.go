package debt_test

// Fase 6 Paso 3 (docs/diseno-fase6-paso2-cancelaciones-writeoff-2026-09-15.md C.2): un Payment
// anulado (VoidedAt != nil) no debe contar en ninguno de los 4 cálculos financieros oficiales ni en
// PaidTotal/EffectiveBalance.

import (
	"testing"
	"time"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupFinancialVoidingTestDB(t *testing.T) *gorm.DB {
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

func seedFVCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "Financial Voiding Test " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedFVDocument(t *testing.T, db *gorm.DB, companyID uint, total, balance float64) models.Document {
	t.Helper()
	d := models.Document{
		CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: "F-FV",
		IssueDate: time.Now(), TotalAmount: total, BalanceAmount: balance, Status: debtsvc.StatusPartial,
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatalf("document: %v", err)
	}
	return d
}

// seedFVPayment crea un Payment; si voided=true, queda con VoidedAt/By/Reason Y deleted_at fijados
// (mismo efecto que produce hoy DeletePaymentTx — se simula directo para no depender de esa función).
func seedFVPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, purpose *string, voided bool) models.Payment {
	t.Helper()
	p := models.Payment{CompanyID: companyID, Amount: amount, Type: "on_account", Purpose: purpose, Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("payment: %v", err)
	}
	if voided {
		now := time.Now()
		uid := uint(1)
		if err := db.Model(&models.Payment{}).Where("id = ?", p.ID).
			Updates(map[string]interface{}{"deleted_at": now, "voided_at": now, "voided_by": uid, "void_reason": "test"}).Error; err != nil {
			t.Fatalf("void payment: %v", err)
		}
		p.DeletedAt.Time = now
		p.DeletedAt.Valid = true
		p.VoidedAt = &now
	}
	return p
}

func seedFVAllocation(t *testing.T, db *gorm.DB, paymentID, documentID uint, amount float64) {
	t.Helper()
	a := models.PaymentAllocation{PaymentID: paymentID, DocumentID: documentID, Amount: amount}
	if err := db.Create(&a).Error; err != nil {
		t.Fatalf("allocation: %v", err)
	}
}

func TestDineroTotalRecibido_ExcludesVoidedPayment(t *testing.T) {
	db := setupFinancialVoidingTestDB(t)
	svc := debtsvc.NewService()
	co := seedFVCompany(t, db, "20950000001")
	seedFVPayment(t, db, co.ID, 100, nil, false)
	seedFVPayment(t, db, co.ID, 500, nil, true) // anulado -> no debe contar

	total, err := svc.DineroTotalRecibido(db, co.ID)
	if err != nil {
		t.Fatalf("DineroTotalRecibido: %v", err)
	}
	if total != 100 {
		t.Fatalf("total=%v, want 100 (el pago anulado de 500 no debe contar)", total)
	}
}

func TestDineroAplicadoADeudas_ExcludesVoidedPayment(t *testing.T) {
	db := setupFinancialVoidingTestDB(t)
	svc := debtsvc.NewService()
	co := seedFVCompany(t, db, "20950000002")
	doc := seedFVDocument(t, db, co.ID, 1000, 700)

	active := seedFVPayment(t, db, co.ID, 300, nil, false)
	seedFVAllocation(t, db, active.ID, doc.ID, 300)

	voided := seedFVPayment(t, db, co.ID, 400, nil, false)
	seedFVAllocation(t, db, voided.ID, doc.ID, 400)
	// Anular DESPUÉS de crear la allocation (igual que hace DeletePaymentTx: primero existió, luego se
	// anula sin borrar la allocation histórica en esta simulación directa — el escenario real revierte
	// la allocation también, pero aquí se aísla específicamente el filtro voided_at del JOIN).
	now := time.Now()
	uid := uint(1)
	if err := db.Model(&models.Payment{}).Where("id = ?", voided.ID).
		Updates(map[string]interface{}{"voided_at": now, "voided_by": uid, "void_reason": "test"}).Error; err != nil {
		t.Fatalf("void: %v", err)
	}

	total, err := svc.DineroAplicadoADeudas(db, co.ID)
	if err != nil {
		t.Fatalf("DineroAplicadoADeudas: %v", err)
	}
	if total != 300 {
		t.Fatalf("total=%v, want 300 (la allocation de un pago anulado no debe contar aunque siga existiendo la fila)", total)
	}
}

func TestDineroNoAplicado_ExcludesVoidedPayment(t *testing.T) {
	db := setupFinancialVoidingTestDB(t)
	svc := debtsvc.NewService()
	co := seedFVCompany(t, db, "20950000003")
	purposeDebt := models.PaymentPurposeDebt
	seedFVPayment(t, db, co.ID, 200, &purposeDebt, false) // remanente sin aplicar -> cuenta
	seedFVPayment(t, db, co.ID, 900, &purposeDebt, true)  // anulado -> no debe contar

	total, err := svc.DineroNoAplicado(db, co.ID)
	if err != nil {
		t.Fatalf("DineroNoAplicado: %v", err)
	}
	if total != 200 {
		t.Fatalf("total=%v, want 200 (el pago anulado de 900 no debe contar)", total)
	}
}

func TestPaidTotalAndEffectiveBalance_ExcludeVoidedPayment(t *testing.T) {
	db := setupFinancialVoidingTestDB(t)
	svc := debtsvc.NewService()
	co := seedFVCompany(t, db, "20950000004")
	doc := seedFVDocument(t, db, co.ID, 1000, 1000)

	voided := seedFVPayment(t, db, co.ID, 400, nil, false)
	seedFVAllocation(t, db, voided.ID, doc.ID, 400)
	now := time.Now()
	uid := uint(1)
	db.Model(&models.Payment{}).Where("id = ?", voided.ID).
		Updates(map[string]interface{}{"voided_at": now, "voided_by": uid, "void_reason": "test"})

	paid := svc.PaidTotal(db, doc.ID)
	if paid != 0 {
		t.Fatalf("PaidTotal=%v, want 0 (la allocation del pago anulado no debe contar)", paid)
	}

	doc.BalanceAmount = 1000
	bal := svc.EffectiveBalance(db, &doc)
	if bal != 1000 {
		t.Fatalf("EffectiveBalance=%v, want 1000 (delega en PaidTotal, ya corregido)", bal)
	}
}
