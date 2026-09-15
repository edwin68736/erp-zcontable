package services

// Tests de Fase 7 Paso 3 (docs/diseno-fase7-paso2-ui-reportes-2026-09-15.md D.1):
// PaymentService.ListVoided — vía de auditoría de pagos anulados, estructuralmente separada de
// List/ListPaged/GetByID (que nunca deben devolver un pago anulado).

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPaymentVoidedListTestDB(t *testing.T) *gorm.DB {
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
		&models.TukifacFiscalReceipt{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func seedPVLCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "PaymentVoidedList Test " + ruc, Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedPVLUser(t *testing.T, db *gorm.DB, name string) models.User {
	t.Helper()
	u := models.User{Name: name, Username: name, Password: "x", Active: true}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("user: %v", err)
	}
	return u
}

// seedPVLVoidedPayment crea un Payment ya anulado (deleted_at + voided_at fijados, igual que deja
// DeletePaymentTx), opcionalmente con Document/TaxSettlement/Allocation para probar los preloads de
// auditoría.
func seedPVLVoidedPayment(t *testing.T, db *gorm.DB, companyID, voidedByUserID uint, amount float64, when time.Time) models.Payment {
	t.Helper()
	p := models.Payment{CompanyID: companyID, Amount: amount, Type: "on_account", Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("payment: %v", err)
	}
	if err := db.Model(&models.Payment{}).Where("id = ?", p.ID).
		Updates(map[string]interface{}{
			"deleted_at": when, "voided_at": when, "voided_by": voidedByUserID, "void_reason": "motivo de prueba",
		}).Error; err != nil {
		t.Fatalf("void payment: %v", err)
	}
	return p
}

func seedPVLActivePayment(t *testing.T, db *gorm.DB, companyID uint, amount float64) models.Payment {
	t.Helper()
	p := models.Payment{CompanyID: companyID, Amount: amount, Type: "on_account", Date: time.Now(), Method: "efectivo"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("active payment: %v", err)
	}
	return p
}

// --- Solo devuelve anulados ---------------------------------------------------------------------------

func TestListVoided_ReturnsOnlyVoidedPayments(t *testing.T) {
	db := setupPaymentVoidedListTestDB(t)
	co := seedPVLCompany(t, db, "20990100001")
	u := seedPVLUser(t, db, "Auditor Uno")
	seedPVLActivePayment(t, db, co.ID, 100)
	seedPVLVoidedPayment(t, db, co.ID, u.ID, 500, time.Now())

	svc := NewPaymentService()
	list, total, err := svc.ListVoided(PaymentVoidedListParams{}, 1, 20)
	if err != nil {
		t.Fatalf("ListVoided: %v", err)
	}
	if total != 1 {
		t.Fatalf("total=%d, want 1", total)
	}
	if len(list) != 1 {
		t.Fatalf("len(list)=%d, want 1", len(list))
	}
	if list[0].VoidedAt == nil {
		t.Fatal("VoidedAt no debía ser nil")
	}
	if list[0].Amount != 500 {
		t.Fatalf("Amount=%v, want 500 (el pago activo de 100 no debe aparecer)", list[0].Amount)
	}
}

// --- Regresión: List/ListPaged/GetByID nunca devuelven un pago anulado -------------------------------

func TestListVoided_NeverOverlapsWithActiveEndpoints(t *testing.T) {
	db := setupPaymentVoidedListTestDB(t)
	co := seedPVLCompany(t, db, "20990100002")
	u := seedPVLUser(t, db, "Auditor Dos")
	active := seedPVLActivePayment(t, db, co.ID, 100)
	voided := seedPVLVoidedPayment(t, db, co.ID, u.ID, 500, time.Now())

	svc := NewPaymentService()

	list, err := svc.List(PaymentListParams{CompanyID: co.ID})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, p := range list {
		if p.ID == voided.ID {
			t.Fatal("List() no debe devolver un pago anulado")
		}
	}
	if len(list) != 1 || list[0].ID != active.ID {
		t.Fatalf("List() debía devolver únicamente el pago activo, got %d filas", len(list))
	}

	pagedList, _, err := svc.ListPaged(PaymentListParams{CompanyID: co.ID}, 1, 20)
	if err != nil {
		t.Fatalf("ListPaged: %v", err)
	}
	for _, p := range pagedList {
		if p.ID == voided.ID {
			t.Fatal("ListPaged() no debe devolver un pago anulado")
		}
	}

	if _, err := svc.GetByID(voided.ID); err == nil {
		t.Fatal("GetByID sobre un pago anulado debía fallar (record not found), no debe ser recuperable por esta vía")
	}

	// Y a la inversa: ListVoided nunca debe devolver el pago activo.
	voidedList, _, err := svc.ListVoided(PaymentVoidedListParams{CompanyID: co.ID}, 1, 20)
	if err != nil {
		t.Fatalf("ListVoided: %v", err)
	}
	for _, p := range voidedList {
		if p.ID == active.ID {
			t.Fatal("ListVoided() no debe devolver un pago activo")
		}
	}
}

// --- Filtro por empresa ---------------------------------------------------------------------------------

func TestListVoided_FiltersByCompany(t *testing.T) {
	db := setupPaymentVoidedListTestDB(t)
	coA := seedPVLCompany(t, db, "20990100003")
	coB := seedPVLCompany(t, db, "20990100004")
	u := seedPVLUser(t, db, "Auditor Tres")
	seedPVLVoidedPayment(t, db, coA.ID, u.ID, 100, time.Now())
	seedPVLVoidedPayment(t, db, coB.ID, u.ID, 200, time.Now())

	svc := NewPaymentService()
	list, total, err := svc.ListVoided(PaymentVoidedListParams{CompanyID: coA.ID}, 1, 20)
	if err != nil {
		t.Fatalf("ListVoided: %v", err)
	}
	if total != 1 || len(list) != 1 {
		t.Fatalf("esperaba exactamente 1 resultado filtrando por coA, got total=%d len=%d", total, len(list))
	}
	if list[0].CompanyID != coA.ID {
		t.Fatalf("CompanyID=%d, want %d", list[0].CompanyID, coA.ID)
	}
}

// --- Paginación ------------------------------------------------------------------------------------------

func TestListVoided_Pagination(t *testing.T) {
	db := setupPaymentVoidedListTestDB(t)
	co := seedPVLCompany(t, db, "20990100005")
	u := seedPVLUser(t, db, "Auditor Cuatro")
	base := time.Now()
	for i := 0; i < 5; i++ {
		seedPVLVoidedPayment(t, db, co.ID, u.ID, float64(100+i), base.Add(time.Duration(i)*time.Minute))
	}

	svc := NewPaymentService()
	page1, total, err := svc.ListVoided(PaymentVoidedListParams{CompanyID: co.ID}, 1, 2)
	if err != nil {
		t.Fatalf("ListVoided página 1: %v", err)
	}
	if total != 5 {
		t.Fatalf("total=%d, want 5", total)
	}
	if len(page1) != 2 {
		t.Fatalf("len(page1)=%d, want 2", len(page1))
	}
	page2, _, err := svc.ListVoided(PaymentVoidedListParams{CompanyID: co.ID}, 2, 2)
	if err != nil {
		t.Fatalf("ListVoided página 2: %v", err)
	}
	if len(page2) != 2 {
		t.Fatalf("len(page2)=%d, want 2", len(page2))
	}
	page3, _, err := svc.ListVoided(PaymentVoidedListParams{CompanyID: co.ID}, 3, 2)
	if err != nil {
		t.Fatalf("ListVoided página 3: %v", err)
	}
	if len(page3) != 1 {
		t.Fatalf("len(page3)=%d, want 1 (5 filas, tamaño 2 -> última página con 1)", len(page3))
	}
	// Sin solapamiento entre páginas.
	seen := map[uint]bool{}
	for _, p := range append(append(page1, page2...), page3...) {
		if seen[p.ID] {
			t.Fatalf("payment %d apareció en más de una página", p.ID)
		}
		seen[p.ID] = true
	}
	if len(seen) != 5 {
		t.Fatalf("total de filas distintas vistas=%d, want 5", len(seen))
	}
	// Orden: voided_at DESC -> la primera fila de la página 1 debe ser la más reciente (i=4).
	if page1[0].Amount != 104 {
		t.Fatalf("page1[0].Amount=%v, want 104 (orden voided_at DESC)", page1[0].Amount)
	}
}

// --- Preloads de auditoría ------------------------------------------------------------------------------

func TestListVoided_PreloadsAuditInfo(t *testing.T) {
	db := setupPaymentVoidedListTestDB(t)
	co := seedPVLCompany(t, db, "20990100006")
	u := seedPVLUser(t, db, "Auditor Cinco")
	ts := models.TaxSettlement{CompanyID: co.ID, IssueDate: time.Now(), Status: models.TaxSettlementStatusIssued}
	if err := db.Create(&ts).Error; err != nil {
		t.Fatalf("tax settlement: %v", err)
	}
	doc := models.Document{CompanyID: co.ID, Source: "manual", Type: "F", Number: "F-PVL", IssueDate: time.Now(), TotalAmount: 500, Status: "pagado"}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("document: %v", err)
	}
	tsID := ts.ID
	pay := models.Payment{CompanyID: co.ID, Amount: 500, Type: "applied", Date: time.Now(), Method: "efectivo", TaxSettlementID: &tsID}
	if err := db.Create(&pay).Error; err != nil {
		t.Fatalf("payment: %v", err)
	}
	if err := db.Create(&models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 500}).Error; err != nil {
		t.Fatalf("allocation: %v", err)
	}
	now := time.Now()
	if err := db.Model(&models.Payment{}).Where("id = ?", pay.ID).
		Updates(map[string]interface{}{"deleted_at": now, "voided_at": now, "voided_by": u.ID, "void_reason": "reasignar"}).Error; err != nil {
		t.Fatalf("void: %v", err)
	}
	// La allocation queda soft-eliminada (igual que hace DeletePaymentTx) — sigue consultable Unscoped.
	if err := db.Where("payment_id = ?", pay.ID).Delete(&models.PaymentAllocation{}).Error; err != nil {
		t.Fatalf("soft-delete allocation: %v", err)
	}

	svc := NewPaymentService()
	list, _, err := svc.ListVoided(PaymentVoidedListParams{CompanyID: co.ID}, 1, 20)
	if err != nil {
		t.Fatalf("ListVoided: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("len(list)=%d, want 1", len(list))
	}
	got := list[0]
	if got.VoidedByUser == nil || got.VoidedByUser.Name != "Auditor Cinco" {
		t.Fatalf("VoidedByUser no precargado correctamente: %+v", got.VoidedByUser)
	}
	if got.TaxSettlement == nil || got.TaxSettlement.ID != ts.ID {
		t.Fatal("TaxSettlement no precargado (Payment.TaxSettlementID no se limpia al anular)")
	}
	if len(got.Allocations) != 1 || got.Allocations[0].Document == nil || got.Allocations[0].Document.ID != doc.ID {
		t.Fatalf("Allocations (Unscoped) con su Document no precargadas correctamente: %+v", got.Allocations)
	}
}
