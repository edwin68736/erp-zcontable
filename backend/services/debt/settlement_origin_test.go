package debt_test

// Tests de la Fase 1 del Blueprint financiero (docs/blueprint-financiero-definitivo-2026-09-14.md,
// §7-10): Document.OriginSettlementID (inmutable) vs TaxSettlementID (mutable), IsSettlementOwnedDebt
// reescrito para usar exclusivamente el origen, y la regla de seguridad de borrado físico en
// CleanupSettlementDebtsNotInLines / PurgeSettlementDocumentsOnDelete.

import (
	"testing"
	"time"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupSettlementOriginTestDB(t *testing.T) *gorm.DB {
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
	return db
}

func seedOriginCompany(t *testing.T, db *gorm.DB) models.Company {
	t.Helper()
	co := models.Company{RUC: "20600000001", BusinessName: "Empresa Origen Test"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedOriginSettlement(t *testing.T, db *gorm.DB, companyID uint, status string) models.TaxSettlement {
	t.Helper()
	ts := models.TaxSettlement{CompanyID: companyID, Status: status, IssueDate: time.Now()}
	if err := db.Create(&ts).Error; err != nil {
		t.Fatalf("settlement: %v", err)
	}
	return ts
}

// --- Test 1 -----------------------------------------------------------------------------------
// Document nuevo creado por Settlement A: origin=A, tax_settlement=A.
func TestOriginSettlement_NewDebt_OriginEqualsCurrent(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)
	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)

	line := models.TaxSettlementLine{TaxSettlementID: a.ID, LineType: models.TaxSettlementLineAdjust, Concept: "Honorarios setiembre", Amount: 400}
	if err := db.Create(&line).Error; err != nil {
		t.Fatalf("seed line: %v", err)
	}
	lines := []models.TaxSettlementLine{line}
	if err := svc.EnsureSettlementLineDebts(db, a.ID, co.ID, time.Now(), "2026-09", lines); err != nil {
		t.Fatalf("EnsureSettlementLineDebts: %v", err)
	}
	if lines[0].DocumentID == nil {
		t.Fatal("esperaba document_id asignado a la línea")
	}

	var doc models.Document
	if err := db.First(&doc, *lines[0].DocumentID).Error; err != nil {
		t.Fatalf("doc: %v", err)
	}
	if doc.OriginSettlementID == nil || *doc.OriginSettlementID != a.ID {
		t.Fatalf("origin_settlement_id=%v, want %d", doc.OriginSettlementID, a.ID)
	}
	if doc.TaxSettlementID == nil || *doc.TaxSettlementID != a.ID {
		t.Fatalf("tax_settlement_id=%v, want %d", doc.TaxSettlementID, a.ID)
	}
}

// --- Test 2 -----------------------------------------------------------------------------------
// Document arrastrado a otra liquidación: origin NO cambia, tax_settlement_id sí.
func TestOriginSettlement_DraggedDebt_OriginNeverChanges(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)
	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusClosed)

	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, Type: models.DocumentTypeLiquidacion,
		Source: "liquidacion", Number: "000001", TotalAmount: 500, BalanceAmount: 500, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed doc: %v", err)
	}

	b := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)
	lineB := models.TaxSettlementLine{TaxSettlementID: b.ID, LineType: models.TaxSettlementLineDocRef, DocumentID: &doc.ID, Concept: "Arrastre setiembre", Amount: 500}
	if err := db.Create(&lineB).Error; err != nil {
		t.Fatalf("seed line b: %v", err)
	}
	linesB := []models.TaxSettlementLine{lineB}
	if err := svc.EnsureSettlementLineDebts(db, b.ID, co.ID, time.Now(), "2026-10", linesB); err != nil {
		t.Fatalf("EnsureSettlementLineDebts: %v", err)
	}

	var reloaded models.Document
	if err := db.First(&reloaded, doc.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.OriginSettlementID == nil || *reloaded.OriginSettlementID != a.ID {
		t.Fatalf("el origen cambió: %v, want %d (nunca debe cambiar)", reloaded.OriginSettlementID, a.ID)
	}
	if reloaded.TaxSettlementID == nil || *reloaded.TaxSettlementID != b.ID {
		t.Fatalf("tax_settlement_id=%v, want %d", reloaded.TaxSettlementID, b.ID)
	}
}

// --- Tests 3, 4, 10 -----------------------------------------------------------------------------
// IsSettlementOwnedDebt debe basarse EXCLUSIVAMENTE en OriginSettlementID.
func TestIsSettlementOwnedDebt_UsesOriginNotCurrent(t *testing.T) {
	a := uint(1)
	b := uint(2)
	d := &models.Document{OriginSettlementID: &a, TaxSettlementID: &b, Source: "liquidacion", Type: models.DocumentTypeLiquidacion}

	if !debtsvc.IsSettlementOwnedDebt(d, a) {
		t.Fatal("Test 3: IsSettlementOwnedDebt(D, A) con origin=A debería ser true")
	}
	if debtsvc.IsSettlementOwnedDebt(d, b) {
		t.Fatal("Test 4: IsSettlementOwnedDebt(D, B) con origin=A (aunque tax_settlement=B) debería ser false")
	}

	// Test 10: origin=NULL nunca debe considerarse propiedad de ningún settlement, aunque
	// tax_settlement_id sí apunte a uno (documento manual enlazado, o histórico sin evidencia).
	dNil := &models.Document{OriginSettlementID: nil, TaxSettlementID: &b, Source: "liquidacion", Type: models.DocumentTypeLiquidacion}
	if debtsvc.IsSettlementOwnedDebt(dNil, b) {
		t.Fatal("Test 10: origin_settlement_id=nil nunca debe considerarse dueño de ningún settlement")
	}
	if debtsvc.IsSettlementOwnedDebt(dNil, 0) {
		t.Fatal("settlementID=0 nunca debe dar true")
	}
}

// --- Test 5 -----------------------------------------------------------------------------------
// Deuda propia (origin = la liquidación en edición), borrador, sin historial: DELETE permitido.
func TestCleanup_OwnDraftDebtNoHistory_HardDeletes(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)
	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)

	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, TaxSettlementID: &a.ID,
		Type: models.DocumentTypeLiquidacion, Source: "liquidacion", Number: "000002",
		TotalAmount: 300, BalanceAmount: 300, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := svc.CleanupSettlementDebtsNotInLines(db, a.ID, co.ID, map[uint]bool{}); err != nil {
		t.Fatalf("Cleanup: %v", err)
	}

	var cnt int64
	db.Model(&models.Document{}).Where("id = ?", doc.ID).Count(&cnt)
	if cnt != 0 {
		t.Fatalf("esperaba que la deuda propia sin historial se eliminara físicamente, sigue existiendo (cnt=%d)", cnt)
	}
}

// --- Test 6 / Test 12 (regresión del bug real) --------------------------------------------------
// Reproduce EXACTAMENTE el escenario que causó pérdida de datos en producción (5 empresas afectadas,
// jun-sep 2026, ver docs/auditoria-logica-financiera-2026-09-14.md §14):
//
//	Liquidación A crea Document D (origin=A) → A se cierra, D queda impaga y libre →
//	Liquidación B arrastra D (tax_settlement_id=B, origin sigue=A) → alguien quita la línea de D en B.
//
// ANTES del fix: CleanupSettlementDebtsNotInLines creía que D pertenecía a B (por TaxSettlementID
// mutable + Source/Type genéricos) y la borraba físicamente. DESPUÉS: debe solo desvincularse.
func TestRegression_DraggedDebtNeverHardDeletedFromLaterSettlement(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)

	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusClosed) // ya cerrada, como en el caso real
	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, TaxSettlementID: nil, // liberada al cerrar A
		Type: models.DocumentTypeLiquidacion, Source: "liquidacion", Number: "000003",
		TotalAmount: 400, BalanceAmount: 400, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed doc: %v", err)
	}

	b := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)
	// Arrastre: B toma la deuda (document_ref) — mismo mecanismo real (LinkDebtToDraft).
	if err := db.Model(&models.Document{}).Where("id = ?", doc.ID).Update("tax_settlement_id", b.ID).Error; err != nil {
		t.Fatalf("simular arrastre: %v", err)
	}

	// El usuario quita la línea de D del borrador de B y guarda (kept vacío == la línea ya no está).
	if err := svc.CleanupSettlementDebtsNotInLines(db, b.ID, co.ID, map[uint]bool{}); err != nil {
		t.Fatalf("Cleanup: %v", err)
	}

	var reloaded models.Document
	if err := db.First(&reloaded, doc.ID).Error; err != nil {
		t.Fatalf("REGRESIÓN DEL BUG: el documento fue eliminado físicamente (%v) — debía sobrevivir, solo desvincularse", err)
	}
	if reloaded.TaxSettlementID != nil {
		t.Fatalf("esperaba tax_settlement_id=nil (desvinculado de B), got %v", *reloaded.TaxSettlementID)
	}
	if reloaded.OriginSettlementID == nil || *reloaded.OriginSettlementID != a.ID {
		t.Fatalf("origin_settlement_id debía seguir siendo %d, got %v", a.ID, reloaded.OriginSettlementID)
	}
}

// --- Test 7 -----------------------------------------------------------------------------------
// Deuda propia con PaymentAllocation: DELETE prohibido (Cleanup debe devolver error, no borrar).
func TestCleanup_OwnDebtWithAllocation_NeverDeleted(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)
	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)

	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, TaxSettlementID: &a.ID,
		Type: models.DocumentTypeLiquidacion, Source: "liquidacion", Number: "000004",
		TotalAmount: 400, BalanceAmount: 0, Status: "pagado",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed doc: %v", err)
	}
	pay := models.Payment{CompanyID: co.ID, Amount: 400, Type: "applied"}
	if err := db.Create(&pay).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	alloc := models.PaymentAllocation{PaymentID: pay.ID, DocumentID: doc.ID, Amount: 400}
	if err := db.Create(&alloc).Error; err != nil {
		t.Fatalf("seed allocation: %v", err)
	}

	err := svc.CleanupSettlementDebtsNotInLines(db, a.ID, co.ID, map[uint]bool{})
	if err == nil {
		t.Fatal("esperaba error: no se puede quitar/eliminar una deuda con imputaciones de pago")
	}
	var cnt int64
	db.Model(&models.Document{}).Where("id = ?", doc.ID).Count(&cnt)
	if cnt == 0 {
		t.Fatal("la deuda con PaymentAllocation NUNCA debe eliminarse físicamente")
	}
}

// --- Test 8 -----------------------------------------------------------------------------------
// Deuda propia con Payment.DocumentID legacy: DELETE prohibido.
func TestCleanup_OwnDebtWithLegacyPayment_NeverDeleted(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)
	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)

	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, TaxSettlementID: &a.ID,
		Type: models.DocumentTypeLiquidacion, Source: "liquidacion", Number: "000005",
		TotalAmount: 200, BalanceAmount: 0, Status: "pagado",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed doc: %v", err)
	}
	legacyPay := models.Payment{CompanyID: co.ID, DocumentID: &doc.ID, Amount: 200, Type: "applied"}
	if err := db.Create(&legacyPay).Error; err != nil {
		t.Fatalf("seed legacy payment: %v", err)
	}

	err := svc.CleanupSettlementDebtsNotInLines(db, a.ID, co.ID, map[uint]bool{})
	if err == nil {
		t.Fatal("esperaba error: existe un pago legacy vinculado a la deuda")
	}
	var cnt int64
	db.Model(&models.Document{}).Where("id = ?", doc.ID).Count(&cnt)
	if cnt == 0 {
		t.Fatal("la deuda con Payment.DocumentID legacy NUNCA debe eliminarse físicamente")
	}
}

// --- Test 9 -----------------------------------------------------------------------------------
// Deuda propia de A, sin pagos, pero referenciada también desde otra liquidación (histórico de un
// arrastre previo): no debe eliminarse, debe desvincularse.
func TestCleanup_OwnDebtReferencedByOtherSettlement_UnlinksNotDeletes(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)
	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)
	z := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusClosed) // otra liquidación, ya cerrada

	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, TaxSettlementID: &a.ID,
		Type: models.DocumentTypeLiquidacion, Source: "liquidacion", Number: "000006",
		TotalAmount: 100, BalanceAmount: 100, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed doc: %v", err)
	}
	// Línea histórica de Z (otra liquidación) referenciando el mismo documento.
	otherLine := models.TaxSettlementLine{TaxSettlementID: z.ID, LineType: models.TaxSettlementLineDocRef, DocumentID: &doc.ID, Concept: "Historico Z", Amount: 100}
	if err := db.Create(&otherLine).Error; err != nil {
		t.Fatalf("seed other line: %v", err)
	}

	if err := svc.CleanupSettlementDebtsNotInLines(db, a.ID, co.ID, map[uint]bool{}); err != nil {
		t.Fatalf("Cleanup no debería fallar, solo desvincular: %v", err)
	}

	var reloaded models.Document
	if err := db.First(&reloaded, doc.ID).Error; err != nil {
		t.Fatalf("la deuda referenciada por otra liquidación NUNCA debe eliminarse físicamente: %v", err)
	}
	if reloaded.TaxSettlementID != nil {
		t.Fatalf("esperaba desvinculación (tax_settlement_id=nil), got %v", *reloaded.TaxSettlementID)
	}
}

// --- Test 11 ----------------------------------------------------------------------------------
// Carry-forward múltiple A → B → C: el origen se mantiene en A en todo momento, y al quitar la
// línea en C tampoco se elimina físicamente.
func TestOriginSettlement_MultipleCarryForward_OriginStaysAtA(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)

	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusClosed)
	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, TaxSettlementID: nil,
		Type: models.DocumentTypeLiquidacion, Source: "liquidacion", Number: "000007",
		TotalAmount: 250, BalanceAmount: 250, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	b := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusClosed)
	lineB := models.TaxSettlementLine{TaxSettlementID: b.ID, LineType: models.TaxSettlementLineDocRef, DocumentID: &doc.ID, Amount: 250, Concept: "Arrastre B"}
	if err := db.Create(&lineB).Error; err != nil {
		t.Fatalf("seed lineB: %v", err)
	}
	linesB := []models.TaxSettlementLine{lineB}
	if err := svc.EnsureSettlementLineDebts(db, b.ID, co.ID, time.Now(), "2026-10", linesB); err != nil {
		t.Fatalf("arrastre a B: %v", err)
	}

	c := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)
	lineC := models.TaxSettlementLine{TaxSettlementID: c.ID, LineType: models.TaxSettlementLineDocRef, DocumentID: &doc.ID, Amount: 250, Concept: "Arrastre C"}
	if err := db.Create(&lineC).Error; err != nil {
		t.Fatalf("seed lineC: %v", err)
	}
	linesC := []models.TaxSettlementLine{lineC}
	if err := svc.EnsureSettlementLineDebts(db, c.ID, co.ID, time.Now(), "2026-11", linesC); err != nil {
		t.Fatalf("arrastre a C: %v", err)
	}

	var afterC models.Document
	db.First(&afterC, doc.ID)
	if afterC.OriginSettlementID == nil || *afterC.OriginSettlementID != a.ID {
		t.Fatalf("tras A→B→C, origin debía seguir siendo %d, got %v", a.ID, afterC.OriginSettlementID)
	}
	if afterC.TaxSettlementID == nil || *afterC.TaxSettlementID != c.ID {
		t.Fatalf("tax_settlement_id=%v, want %d", afterC.TaxSettlementID, c.ID)
	}

	// Quitar la línea de C: no debe eliminarse, solo desvincular; origen sigue en A.
	if err := svc.CleanupSettlementDebtsNotInLines(db, c.ID, co.ID, map[uint]bool{}); err != nil {
		t.Fatalf("Cleanup en C: %v", err)
	}
	var final models.Document
	if err := db.First(&final, doc.ID).Error; err != nil {
		t.Fatalf("no debía eliminarse al quitarla de C: %v", err)
	}
	if final.TaxSettlementID != nil {
		t.Fatalf("esperaba desvinculada de C, got tax_settlement_id=%v", *final.TaxSettlementID)
	}
	if final.OriginSettlementID == nil || *final.OriginSettlementID != a.ID {
		t.Fatalf("origin final=%v, want %d (nunca debe cambiar)", final.OriginSettlementID, a.ID)
	}
}

// --- Purge: mismas protecciones que Cleanup, al eliminar la liquidación completa -----------------
func TestPurge_OwnDraftDebtNoHistory_HardDeletes(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)
	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)

	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, TaxSettlementID: &a.ID,
		Type: models.DocumentTypeLiquidacion, Source: "liquidacion", Number: "000008",
		TotalAmount: 100, BalanceAmount: 100, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	line := models.TaxSettlementLine{TaxSettlementID: a.ID, LineType: models.TaxSettlementLineAdjust, DocumentID: &doc.ID, Amount: 100, Concept: "x"}
	if err := db.Create(&line).Error; err != nil {
		t.Fatalf("seed line: %v", err)
	}

	if err := svc.PurgeSettlementDocumentsOnDelete(db, &a, []models.TaxSettlementLine{line}); err != nil {
		t.Fatalf("Purge: %v", err)
	}
	var cnt int64
	db.Model(&models.Document{}).Where("id = ?", doc.ID).Count(&cnt)
	if cnt != 0 {
		t.Fatal("esperaba eliminación física de deuda propia sin historial al borrar su liquidación de origen")
	}
}

func TestPurge_DraggedDebt_NeverDeletedWhenOtherSettlementDeleted(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)

	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusClosed)
	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: &a.ID, TaxSettlementID: nil,
		Type: models.DocumentTypeLiquidacion, Source: "liquidacion", Number: "000009",
		TotalAmount: 150, BalanceAmount: 150, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed doc: %v", err)
	}

	b := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)
	if err := db.Model(&models.Document{}).Where("id = ?", doc.ID).Update("tax_settlement_id", b.ID).Error; err != nil {
		t.Fatalf("simular arrastre: %v", err)
	}
	lineB := models.TaxSettlementLine{TaxSettlementID: b.ID, LineType: models.TaxSettlementLineDocRef, DocumentID: &doc.ID, Amount: 150, Concept: "Arrastre"}
	if err := db.Create(&lineB).Error; err != nil {
		t.Fatalf("seed line: %v", err)
	}

	// Se elimina la liquidación B (la que solo tomó prestada la deuda, no la creó).
	if err := svc.PurgeSettlementDocumentsOnDelete(db, &b, []models.TaxSettlementLine{lineB}); err != nil {
		t.Fatalf("Purge: %v", err)
	}
	var reloaded models.Document
	if err := db.First(&reloaded, doc.ID).Error; err != nil {
		t.Fatalf("al eliminar B, la deuda arrastrada (origen=A) NUNCA debe eliminarse: %v", err)
	}
	if reloaded.TaxSettlementID != nil {
		t.Fatalf("esperaba desvinculada de B, got %v", *reloaded.TaxSettlementID)
	}
	if reloaded.OriginSettlementID == nil || *reloaded.OriginSettlementID != a.ID {
		t.Fatalf("origin debía seguir siendo %d, got %v", a.ID, reloaded.OriginSettlementID)
	}
}

// Documento manual (origin=nil) enlazado (document_ref) a una liquidación: nunca se interpreta
// como propiedad de esa liquidación, nunca se elimina por su lógica de ownership.
func TestCleanup_ManualDocumentLinked_NeverOwnedNeverDeleted(t *testing.T) {
	db := setupSettlementOriginTestDB(t)
	svc := debtsvc.NewService()
	co := seedOriginCompany(t, db)
	a := seedOriginSettlement(t, db, co.ID, models.TaxSettlementStatusDraft)

	doc := models.Document{
		CompanyID: co.ID, OriginSettlementID: nil, TaxSettlementID: &a.ID,
		Type: "FACTURA", Source: "manual", Number: "MAN-001",
		TotalAmount: 80, BalanceAmount: 80, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := svc.CleanupSettlementDebtsNotInLines(db, a.ID, co.ID, map[uint]bool{}); err != nil {
		t.Fatalf("Cleanup: %v", err)
	}
	var reloaded models.Document
	if err := db.First(&reloaded, doc.ID).Error; err != nil {
		t.Fatalf("documento manual jamás debe eliminarse por ownership de liquidación: %v", err)
	}
	if reloaded.TaxSettlementID != nil {
		t.Fatalf("esperaba desvinculado, got %v", *reloaded.TaxSettlementID)
	}
}
