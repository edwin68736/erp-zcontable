package services

// Cubre el pedido del usuario (2026-09-17): la fecha de inicio de suscripción ya no es un campo
// propio del formulario — siempre debe quedar igual a la fecha de inicio de servicio, sin importar
// lo que mande el cliente — y el nuevo default_payment_document_type (rh/factura) que precarga el
// tipo de documento al crear una liquidación para la empresa.

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupCompanySubscriptionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.Company{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func baseValidCompany(ruc, code string, serviceStart time.Time) *models.Company {
	return &models.Company{
		RUC: ruc, BusinessName: "Empresa " + ruc, InternalCode: code,
		IgvRate: models.CompanyIGVRate18, TaxRegime: models.CompanyTaxRegimeMype,
		ServiceStartAt: &serviceStart,
	}
}

func TestCreate_SyncsSubscriptionStartedAtWithServiceStartAt(t *testing.T) {
	setupCompanySubscriptionTestDB(t)
	svc := NewCompanyService()

	serviceStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	// Empresa manda una fecha de suscripción DISTINTA a propósito — Create debe ignorarla y usar
	// service_start_at de todas formas.
	otherDate := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	input := baseValidCompany("20600000001", "T001", serviceStart)
	input.SubscriptionStartedAt = &otherDate

	if err := svc.Create(input); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if input.SubscriptionStartedAt == nil || !input.SubscriptionStartedAt.Equal(serviceStart) {
		t.Fatalf("SubscriptionStartedAt=%v, want igual a ServiceStartAt=%v", input.SubscriptionStartedAt, serviceStart)
	}
}

func TestUpdate_SyncsSubscriptionStartedAtWithServiceStartAt(t *testing.T) {
	db := setupCompanySubscriptionTestDB(t)
	svc := NewCompanyService()

	serviceStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	seed := baseValidCompany("20600000002", "T002", serviceStart)
	if err := svc.Create(seed); err != nil {
		t.Fatalf("seed Create: %v", err)
	}

	newServiceStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	otherDate := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	update := &models.Company{ServiceStartAt: &newServiceStart, SubscriptionStartedAt: &otherDate, SubscriptionActive: true}
	if err := svc.Update(seed.ID, update); err != nil {
		t.Fatalf("Update: %v", err)
	}

	var got models.Company
	if err := db.First(&got, seed.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.SubscriptionStartedAt == nil || !got.SubscriptionStartedAt.Equal(newServiceStart) {
		t.Fatalf("SubscriptionStartedAt=%v, want igual al nuevo ServiceStartAt=%v", got.SubscriptionStartedAt, newServiceStart)
	}
}

func TestCreate_DefaultPaymentDocumentType_DefaultsToRHWhenEmpty(t *testing.T) {
	setupCompanySubscriptionTestDB(t)
	svc := NewCompanyService()

	serviceStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	input := baseValidCompany("20600000003", "T003", serviceStart)
	// DefaultPaymentDocumentType queda en "" a propósito.

	if err := svc.Create(input); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if input.DefaultPaymentDocumentType != models.TaxSettlementPaymentDocTypeRH {
		t.Fatalf("DefaultPaymentDocumentType=%q, want %q", input.DefaultPaymentDocumentType, models.TaxSettlementPaymentDocTypeRH)
	}
}

func TestCreate_DefaultPaymentDocumentType_AcceptsFactura(t *testing.T) {
	setupCompanySubscriptionTestDB(t)
	svc := NewCompanyService()

	serviceStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	input := baseValidCompany("20600000004", "T004", serviceStart)
	input.DefaultPaymentDocumentType = models.TaxSettlementPaymentDocTypeFactura

	if err := svc.Create(input); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if input.DefaultPaymentDocumentType != models.TaxSettlementPaymentDocTypeFactura {
		t.Fatalf("DefaultPaymentDocumentType=%q, want %q", input.DefaultPaymentDocumentType, models.TaxSettlementPaymentDocTypeFactura)
	}
}

func TestCreate_DefaultPaymentDocumentType_RejectsInvalidValue(t *testing.T) {
	setupCompanySubscriptionTestDB(t)
	svc := NewCompanyService()

	serviceStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	input := baseValidCompany("20600000005", "T005", serviceStart)
	input.DefaultPaymentDocumentType = "boleta_manual"

	if err := svc.Create(input); err == nil {
		t.Fatal("Create debía rechazar un default_payment_document_type que no sea rh/factura")
	}
}

func TestUpdate_DefaultPaymentDocumentType_ChangesWhenProvided(t *testing.T) {
	db := setupCompanySubscriptionTestDB(t)
	svc := NewCompanyService()

	serviceStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	seed := baseValidCompany("20600000006", "T006", serviceStart)
	if err := svc.Create(seed); err != nil {
		t.Fatalf("seed Create: %v", err)
	}
	if seed.DefaultPaymentDocumentType != models.TaxSettlementPaymentDocTypeRH {
		t.Fatalf("seed DefaultPaymentDocumentType=%q, want rh", seed.DefaultPaymentDocumentType)
	}

	update := &models.Company{
		ServiceStartAt: &serviceStart, SubscriptionActive: true,
		DefaultPaymentDocumentType: models.TaxSettlementPaymentDocTypeFactura,
	}
	if err := svc.Update(seed.ID, update); err != nil {
		t.Fatalf("Update: %v", err)
	}

	var got models.Company
	if err := db.First(&got, seed.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.DefaultPaymentDocumentType != models.TaxSettlementPaymentDocTypeFactura {
		t.Fatalf("DefaultPaymentDocumentType=%q, want factura", got.DefaultPaymentDocumentType)
	}
}
