package services

// Tests de Fase 7 Paso 3 (docs/diseno-fase7-paso2-ui-reportes-2026-09-15.md A.2/A.3): GetCompanyBalance
// y GetCompanyStatement ya no calculan TotalPayments con un SUM ad-hoc propio (sin filtro voided_at) —
// GetCompanyBalance llama directamente a DineroTotalRecibido; GetCompanyStatement filtra
// "voided_at IS NULL" en la consulta upstream que alimenta tanto TotalPayments como el Ledger
// (finance_statement_ledger.go, sin cambios propios — hereda el filtro de la slice que recibe).

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupFinanceVoidedTestDB(t *testing.T) *gorm.DB {
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

func seedFinVoidedCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "FinanceVoided Test " + ruc, Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

// seedFinVoidedPayment crea un Payment; si voided=true queda con voided_at (y deleted_at) fijados,
// simulando exactamente lo que deja DeletePaymentTx (Fase 6).
func seedFinVoidedPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, voided bool) models.Payment {
	t.Helper()
	p := models.Payment{CompanyID: companyID, Amount: amount, Type: "on_account", Date: time.Now(), Method: "efectivo"}
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
	}
	return p
}

func TestGetCompanyBalance_TotalPayments_ExcludesVoided(t *testing.T) {
	db := setupFinanceVoidedTestDB(t)
	co := seedFinVoidedCompany(t, db, "20980000001")
	seedFinVoidedPayment(t, db, co.ID, 100, false)
	seedFinVoidedPayment(t, db, co.ID, 500, true) // anulado

	svc := NewFinanceService()
	bal, err := svc.GetCompanyBalance(co.ID)
	if err != nil {
		t.Fatalf("GetCompanyBalance: %v", err)
	}
	if bal.TotalPayments != 100 {
		t.Fatalf("TotalPayments=%v, want 100 (el pago anulado de 500 no debe contar)", bal.TotalPayments)
	}
}

func TestGetCompanyStatement_ExcludesVoidedPayment(t *testing.T) {
	db := setupFinanceVoidedTestDB(t)
	co := seedFinVoidedCompany(t, db, "20980000002")
	seedFinVoidedPayment(t, db, co.ID, 250, false)
	seedFinVoidedPayment(t, db, co.ID, 900, true) // anulado

	svc := NewFinanceService()
	now := time.Now()
	stmt, err := svc.GetCompanyStatement(co.ID, now.Year(), int(now.Month()), nil, nil)
	if err != nil {
		t.Fatalf("GetCompanyStatement: %v", err)
	}
	if stmt.TotalPayments != 250 {
		t.Fatalf("TotalPayments=%v, want 250 (el pago anulado de 900 no debe contar)", stmt.TotalPayments)
	}
	if len(stmt.Payments) != 1 {
		t.Fatalf("Payments tiene %d filas, want 1 (el pago anulado no debe aparecer en la lista)", len(stmt.Payments))
	}
	if stmt.Ledger == nil {
		t.Fatal("Ledger no debía ser nil")
	}
	if stmt.Ledger.TotalAbonos != 250 {
		t.Fatalf("Ledger.TotalAbonos=%v, want 250 (el ledger hereda el filtro de voided_at de la slice de pagos)", stmt.Ledger.TotalAbonos)
	}
}

func TestGetCompanyStatement_DateRange_ExcludesVoidedPayment(t *testing.T) {
	db := setupFinanceVoidedTestDB(t)
	co := seedFinVoidedCompany(t, db, "20980000003")
	seedFinVoidedPayment(t, db, co.ID, 250, false)
	seedFinVoidedPayment(t, db, co.ID, 900, true)

	svc := NewFinanceService()
	from := time.Now().AddDate(0, 0, -1)
	to := time.Now().AddDate(0, 0, 1)
	stmt, err := svc.GetCompanyStatement(co.ID, 0, 0, &from, &to)
	if err != nil {
		t.Fatalf("GetCompanyStatement (rango de fechas): %v", err)
	}
	if stmt.Ledger.TotalAbonos != 250 {
		t.Fatalf("Ledger.TotalAbonos (rango de fechas)=%v, want 250", stmt.Ledger.TotalAbonos)
	}
}
