package services

// Test de Fase 7 Paso 3 (docs/diseno-fase7-paso2-ui-reportes-2026-09-15.md C/E.2):
// DocumentService.GetByID/List/ListPaged precargan WriteoffByUser (mismo patrón que
// TukifacFiscalReceipt.IssuedByUser) para que el detalle de deuda pueda mostrar quién dio de baja la
// deuda, no solo el ID crudo. La lógica de bloqueo/permiso de WriteOffUnlinkedDebt en sí (Fase 6) no
// se toca ni se reprueba aquí — solo se verifica el preload nuevo de Fase 7.

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupDocWriteoffUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.User{},
		&models.Document{},
		&models.DocumentItem{},
		&models.Payment{},
		&models.PaymentAllocation{},
		&models.TaxSettlement{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func TestDocumentService_GetByID_PreloadsWriteoffByUser(t *testing.T) {
	db := setupDocWriteoffUserTestDB(t)
	co := models.Company{RUC: "20992000001", BusinessName: "DocWriteoffUser Test", Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	u := models.User{Name: "Supervisor Baja", Username: "sup-baja", Password: "x", Active: true}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("user: %v", err)
	}
	doc := models.Document{
		CompanyID: co.ID, Source: "manual", Type: "F", Number: "F-DWU",
		IssueDate: time.Now(), TotalAmount: 500, BalanceAmount: 500, Status: debtsvc.StatusPending,
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("document: %v", err)
	}

	debtSvc := debtsvc.NewService()
	var updated *models.Document
	err := db.Transaction(func(tx *gorm.DB) error {
		d, e := debtSvc.WriteOffUnlinkedDebt(tx, doc.ID, debtsvc.WriteoffActionExonerar, "cliente insolvente", u.ID)
		updated = d
		return e
	})
	if err != nil {
		t.Fatalf("WriteOffUnlinkedDebt: %v", err)
	}
	if updated.Status != debtsvc.StatusExonerado {
		t.Fatalf("Status=%s, want exonerado", updated.Status)
	}

	docSvc := NewDocumentService()
	got, err := docSvc.GetByID(doc.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Status != debtsvc.StatusExonerado {
		t.Fatalf("GetByID: Status=%s, want exonerado", got.Status)
	}
	if got.WriteoffReason != "cliente insolvente" {
		t.Fatalf("WriteoffReason=%q, want %q", got.WriteoffReason, "cliente insolvente")
	}
	if got.WriteoffAt == nil {
		t.Fatal("WriteoffAt no debía ser nil")
	}
	if got.WriteoffByUser == nil || got.WriteoffByUser.Name != "Supervisor Baja" {
		t.Fatalf("WriteoffByUser no precargado correctamente: %+v", got.WriteoffByUser)
	}

	list, err := docSvc.List(DocumentListParams{CompanyID: co.ID})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var listed *models.Document
	for i := range list {
		if list[i].ID == doc.ID {
			listed = &list[i]
		}
	}
	if listed == nil {
		t.Fatal("documento exonerado no encontrado en List() (ScopeActiveDocuments no debe excluirlo — sigue siendo un documento activo, solo con estado terminal)")
	}
	if listed.WriteoffByUser == nil || listed.WriteoffByUser.Name != "Supervisor Baja" {
		t.Fatalf("List(): WriteoffByUser no precargado correctamente: %+v", listed.WriteoffByUser)
	}
}
