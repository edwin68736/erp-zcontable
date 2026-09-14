package services

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupTaxSettlementTestDB crea una BD sqlite en memoria con las tablas necesarias para
// TaxSettlement, replicando el caso reportado: empresa con liquidación "cerrada" de un
// periodo debe verse igual desde Finanzas y desde Supervisores.
func setupTaxSettlementTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.TaxSettlement{},
		&models.TaxSettlementLine{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

// TestSupervisorDraftByCompanies_IncludesClosedSettlement reproduce el caso reportado: la empresa
// RUC 20616053664 (company_id=286 en producción) tiene la liquidación de agosto 2026 con status
// "cerrada". La vista de Supervisores debe reportarla (no "Sin liquidación"), igual que Finanzas.
func TestSupervisorDraftByCompanies_IncludesClosedSettlement(t *testing.T) {
	db := setupTaxSettlementTestDB(t)

	co := models.Company{RUC: "20616053664", BusinessName: "Angeles Lanudos"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}

	closed := models.TaxSettlement{
		CompanyID:         co.ID,
		Status:            models.TaxSettlementStatusClosed,
		LiquidationPeriod: "2026-08",
		PeriodLabel:       "agosto 2026",
	}
	if err := db.Create(&closed).Error; err != nil {
		t.Fatalf("seed closed settlement: %v", err)
	}

	svc := NewTaxSettlementService()
	out, err := svc.SupervisorDraftByCompanies([]uint{co.ID}, "2026-08")
	if err != nil {
		t.Fatalf("SupervisorDraftByCompanies: %v", err)
	}
	got, ok := out[co.ID]
	if !ok {
		t.Fatalf("esperaba encontrar la liquidación cerrada para company_id=%d, el supervisor la vería como 'Sin liquidación'", co.ID)
	}
	if got.Status != models.TaxSettlementStatusClosed || got.SettlementID != closed.ID {
		t.Fatalf("draft inesperado: %+v", got)
	}
}

// TestDuplicateLiquidationPeriod_BlocksWhenClosed asegura que, con la misma regla, no se pueda
// crear una segunda liquidación para una empresa y periodo que ya tiene una "cerrada" — antes del
// fix solo se bloqueaba contra borrador/emitida, permitiendo duplicar sobre un periodo ya cerrado.
func TestDuplicateLiquidationPeriod_BlocksWhenClosed(t *testing.T) {
	db := setupTaxSettlementTestDB(t)

	co := models.Company{RUC: "20616053664", BusinessName: "Angeles Lanudos"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	closed := models.TaxSettlement{
		CompanyID:         co.ID,
		Status:            models.TaxSettlementStatusClosed,
		LiquidationPeriod: "2026-08",
	}
	if err := db.Create(&closed).Error; err != nil {
		t.Fatalf("seed closed settlement: %v", err)
	}

	dup, err := duplicateLiquidationPeriod(db, co.ID, "2026-08", 0)
	if err != nil {
		t.Fatalf("duplicateLiquidationPeriod: %v", err)
	}
	if !dup {
		t.Fatalf("se esperaba bloquear la creación: ya existe una liquidación cerrada para ese periodo")
	}
}

// TestDuplicateLiquidationPeriod_AllowsWhenVoidOrDeleted confirma que sigue permitido volver a
// crear cuando la existente fue anulada o eliminada (regla de negocio explícita del usuario).
func TestDuplicateLiquidationPeriod_AllowsWhenVoidOrDeleted(t *testing.T) {
	db := setupTaxSettlementTestDB(t)

	co := models.Company{RUC: "20616053664", BusinessName: "Angeles Lanudos"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	void := models.TaxSettlement{
		CompanyID:         co.ID,
		Status:            models.TaxSettlementStatusVoid,
		LiquidationPeriod: "2026-08",
	}
	if err := db.Create(&void).Error; err != nil {
		t.Fatalf("seed void settlement: %v", err)
	}

	dup, err := duplicateLiquidationPeriod(db, co.ID, "2026-08", 0)
	if err != nil {
		t.Fatalf("duplicateLiquidationPeriod: %v", err)
	}
	if dup {
		t.Fatalf("no debería bloquear: la única liquidación existente está anulada")
	}

	deleted := models.TaxSettlement{
		CompanyID:         co.ID,
		Status:            models.TaxSettlementStatusDraft,
		LiquidationPeriod: "2026-07",
	}
	if err := db.Create(&deleted).Error; err != nil {
		t.Fatalf("seed to-delete settlement: %v", err)
	}
	if err := db.Delete(&deleted).Error; err != nil { // soft delete (gorm.DeletedAt)
		t.Fatalf("soft delete: %v", err)
	}
	dup, err = duplicateLiquidationPeriod(db, co.ID, "2026-07", 0)
	if err != nil {
		t.Fatalf("duplicateLiquidationPeriod: %v", err)
	}
	if dup {
		t.Fatalf("no debería bloquear: la única liquidación existente fue eliminada (soft delete)")
	}
}
