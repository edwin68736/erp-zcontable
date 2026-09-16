package services

// Cierre backend del ítem 6 de deuda técnica diferida (docs/resumen-cierre-blueprint-financiero-2026-09-15.md):
// ni la interfaz ni el backend impedían modificar una deuda ya exonerada/anulada. El frontend ya bloquea
// DocumentForm y oculta "Editar" para esos casos; este test cubre el mismo bloqueo en
// DocumentService.Update, que es la ruta real de persistencia (PUT /api/documents/:id) — sin esto, la
// protección de la interfaz era solo cosmética.

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupDocumentUpdateGuardTestDB(t *testing.T) *gorm.DB {
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

func TestDocumentServiceUpdate_BlocksExoneradoDocument(t *testing.T) {
	db := setupDocumentUpdateGuardTestDB(t)
	co := models.Company{RUC: "20700000001", BusinessName: "Empresa Update Guard Test 1"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	doc := models.Document{
		CompanyID: co.ID, Type: "FACTURA", Source: "manual", Number: "D-100",
		TotalAmount: 100, BalanceAmount: 0, Status: debtsvc.StatusExonerado,
		WriteoffReason: "cliente insolvente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("doc: %v", err)
	}

	svc := NewDocumentService()
	err := svc.Update(doc.ID, &models.Document{Description: "intento de edición"})
	if err == nil {
		t.Fatal("una deuda exonerada no debe poder editarse vía DocumentService.Update")
	}

	var got models.Document
	if err := db.First(&got, doc.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Description == "intento de edición" {
		t.Fatal("el documento exonerado fue modificado a pesar del bloqueo")
	}
}

func TestDocumentServiceUpdate_BlocksAnuladoDocument(t *testing.T) {
	db := setupDocumentUpdateGuardTestDB(t)
	co := models.Company{RUC: "20700000002", BusinessName: "Empresa Update Guard Test 2"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	doc := models.Document{
		CompanyID: co.ID, Type: "FACTURA", Source: "manual", Number: "D-101",
		TotalAmount: 50, BalanceAmount: 50, Status: debtsvc.StatusCancelled,
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("doc: %v", err)
	}

	svc := NewDocumentService()
	err := svc.Update(doc.ID, &models.Document{Description: "intento de edición"})
	if err == nil {
		t.Fatal("una deuda anulada no debe poder editarse vía DocumentService.Update")
	}

	var got models.Document
	if err := db.First(&got, doc.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Description == "intento de edición" {
		t.Fatal("el documento anulado fue modificado a pesar del bloqueo")
	}
}

func TestDocumentServiceUpdate_AllowsPendingDocument(t *testing.T) {
	db := setupDocumentUpdateGuardTestDB(t)
	co := models.Company{RUC: "20700000003", BusinessName: "Empresa Update Guard Test 3"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	doc := models.Document{
		CompanyID: co.ID, Type: "FACTURA", Source: "manual", Number: "D-102",
		TotalAmount: 20, BalanceAmount: 20, Status: debtsvc.StatusPending,
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("doc: %v", err)
	}

	svc := NewDocumentService()
	if err := svc.Update(doc.ID, &models.Document{Description: "edición normal"}); err != nil {
		t.Fatalf("una deuda pendiente debe poder editarse: %v", err)
	}

	var got models.Document
	if err := db.First(&got, doc.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Description != "edición normal" {
		t.Fatalf("Description=%q, want %q", got.Description, "edición normal")
	}
}
