package services

// Test de Fase 7 Paso 3 (docs/diseno-fase7-paso2-ui-reportes-2026-09-15.md A.2 categoría 3):
// companyTotalsForReport (usada por GetFinancialReportRows / Reporte Financiero) filtra
// "voided_at IS NULL" — verificado con rango de fechas, el caso que no puede delegar directamente en
// DineroTotalRecibido (decisión J.1: no se le agregó soporte de fechas).

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupFinancialReportVoidedTestDB(t *testing.T) *gorm.DB {
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

func TestGetFinancialReportRows_TotalPayments_ExcludesVoided_WithDateRange(t *testing.T) {
	db := setupFinancialReportVoidedTestDB(t)
	co := models.Company{RUC: "20990000001", BusinessName: "FinReport Voided Test", Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}

	active := models.Payment{CompanyID: co.ID, Amount: 150, Type: "on_account", Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&active).Error; err != nil {
		t.Fatalf("active payment: %v", err)
	}
	voided := models.Payment{CompanyID: co.ID, Amount: 800, Type: "on_account", Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&voided).Error; err != nil {
		t.Fatalf("voided payment: %v", err)
	}
	now := time.Now()
	uid := uint(1)
	if err := db.Model(&models.Payment{}).Where("id = ?", voided.ID).
		Updates(map[string]interface{}{"deleted_at": now, "voided_at": now, "voided_by": uid, "void_reason": "test"}).Error; err != nil {
		t.Fatalf("void: %v", err)
	}

	svc := NewFinanceService()
	from := time.Now().AddDate(0, 0, -1)
	to := time.Now().AddDate(0, 0, 1)
	rows, _, grandPays, _, err := svc.GetFinancialReportRows(FinancialReportParams{
		IsAdmin: true, DateFrom: &from, DateToExclusive: &to,
	})
	if err != nil {
		t.Fatalf("GetFinancialReportRows: %v", err)
	}
	var got *FinancialCompanyReportRow
	for i := range rows {
		if rows[i].Company.ID == co.ID {
			got = &rows[i]
		}
	}
	if got == nil {
		t.Fatal("empresa no encontrada en las filas del reporte")
	}
	if got.TotalPayments != 150 {
		t.Fatalf("TotalPayments=%v, want 150 (el pago anulado de 800 no debe contar)", got.TotalPayments)
	}
	if grandPays != 150 {
		t.Fatalf("grandPays=%v, want 150", grandPays)
	}
}
