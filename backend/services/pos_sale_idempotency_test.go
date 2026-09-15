package services

// Tests de Fase 5 Paso 2A (docs/diseno-fase5-paso2a-idempotencia-pos-2026-09-15.md): mecanismo de
// idempotencia de IssuePosSale vía SaleClientRef + UNIQUE INDEX (company_id, sale_client_ref).
// Cubre exactamente los 5 escenarios pedidos (A-E) — no se prueba todavía la integración
// POS→Payment (Fase 5 Paso 2), que sigue sin implementarse.

import (
	"sync"
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPosIdempotencyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		// Mismo TranslateError habilitado en producción (database/database.go) — sin esto,
		// errors.Is(err, gorm.ErrDuplicatedKey) no detectaría la colisión del índice único.
		TranslateError: true,
	})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.User{},
		&models.CompanyAssignment{},
		&models.FiscalDocumentSeries{},
		&models.TukifacFiscalReceipt{},
		&models.FiscalReceiptLine{},
		&models.FiscalReceiptPayment{},
		&models.Payment{},
		&models.PaymentAllocation{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// sqlite ":memory:" sin cache compartido: cada conexión física del pool ve una base distinta y
	// vacía. Con 1 sola conexión en el pool, las goroutines concurrentes de los tests comparten
	// siempre la misma base ya migrada (no afecta la lógica bajo prueba: el manejo de la colisión de
	// gorm.ErrDuplicatedKey en el código de producción es el mismo sin importar cuántas conexiones
	// físicas sirvan las consultas).
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	database.DB = db
	return db
}

func seedPosIdemCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "PosIdempotency Test " + ruc, Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedPosIdemSeries(t *testing.T, db *gorm.DB, sunatCode, series string, active bool) models.FiscalDocumentSeries {
	t.Helper()
	s := models.FiscalDocumentSeries{Name: "Serie " + series, SunatCode: sunatCode, Series: series, CurrentNumber: 0, Active: true}
	if err := db.Create(&s).Error; err != nil {
		t.Fatalf("seed series: %v", err)
	}
	if !active {
		// Active:false en el literal de Create sería sustituido por el default:true de GORM (el
		// zero-value de bool coincide con "no provisto" para un campo con tag `default`) — se crea
		// activa y se desactiva con un UPDATE aparte, que sí respeta el valor explícito.
		if err := db.Model(&s).Update("active", false).Error; err != nil {
			t.Fatalf("desactivar series: %v", err)
		}
		s.Active = false
	}
	return s
}

func posIdemManualLine() PosSaleLineInput {
	return PosSaleLineInput{Description: "Servicio", Quantity: 1, UnitPrice: 100, IsManual: true}
}

// --- Item A: misma referencia + misma empresa -> la segunda devuelve la venta existente, sin crear otra ---

func TestIssuePosSale_Idempotency_SameRefSameCompany_ReturnsExisting(t *testing.T) {
	db := setupPosIdempotencyTestDB(t)
	co := seedPosIdemCompany(t, db, "20910000001")
	seedPosIdemSeries(t, db, "03", "B001", true)
	svc := NewPosSaleService()

	in := PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{posIdemManualLine()},
		PaymentMethod: "efectivo", SaleClientRef: "ABC123",
	}

	first, err := svc.IssuePosSale(0, in, false)
	if err != nil {
		t.Fatalf("primera emisión: %v", err)
	}
	second, err := svc.IssuePosSale(0, in, false)
	if err != nil {
		t.Fatalf("segunda emisión (retry) no debía fallar: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("la segunda llamada debía devolver la misma venta (ID=%d), got ID=%d", first.ID, second.ID)
	}
	var count int64
	db.Model(&models.TukifacFiscalReceipt{}).Where("company_id = ? AND sale_client_ref = ?", co.ID, "ABC123").Count(&count)
	if count != 1 {
		t.Fatalf("debía existir exactamente 1 venta con esa referencia, got %d", count)
	}
}

// --- Item B: misma referencia en compañías diferentes -> permitido, ambas se crean ------------------------

func TestIssuePosSale_Idempotency_SameRefDifferentCompanies_BothAllowed(t *testing.T) {
	db := setupPosIdempotencyTestDB(t)
	coA := seedPosIdemCompany(t, db, "20910000002")
	coB := seedPosIdemCompany(t, db, "20910000003")
	seedPosIdemSeries(t, db, "03", "B001", true)
	svc := NewPosSaleService()

	recA, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: coA.ID, Lines: []PosSaleLineInput{posIdemManualLine()},
		PaymentMethod: "efectivo", SaleClientRef: "SAME-REF",
	}, false)
	if err != nil {
		t.Fatalf("venta empresa A: %v", err)
	}
	recB, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: coB.ID, Lines: []PosSaleLineInput{posIdemManualLine()},
		PaymentMethod: "efectivo", SaleClientRef: "SAME-REF",
	}, false)
	if err != nil {
		t.Fatalf("venta empresa B: %v", err)
	}
	if recA.ID == recB.ID {
		t.Fatal("empresas distintas con la misma referencia deben producir ventas distintas")
	}
}

// --- Item C: la primera operación falla (rollback / ni siquiera llega a crear el receipt) -> la referencia
//     queda libre para reintentar ------------------------------------------------------------------------

func TestIssuePosSale_Idempotency_FailedAttempt_RefReusable(t *testing.T) {
	db := setupPosIdempotencyTestDB(t)
	co := seedPosIdemCompany(t, db, "20910000004")
	inactiveSeries := seedPosIdemSeries(t, db, "03", "B002", false) // serie inactiva -> ReserveNextNumber falla
	activeSeries := seedPosIdemSeries(t, db, "03", "B001", true)
	svc := NewPosSaleService()

	_, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, SeriesID: inactiveSeries.ID,
		Lines: []PosSaleLineInput{posIdemManualLine()}, PaymentMethod: "efectivo", SaleClientRef: "RETRY-1",
	}, false)
	if err == nil {
		t.Fatal("la serie inactiva debía hacer fallar la emisión")
	}
	var countAfterFailure int64
	db.Model(&models.TukifacFiscalReceipt{}).Where("company_id = ? AND sale_client_ref = ?", co.ID, "RETRY-1").Count(&countAfterFailure)
	if countAfterFailure != 0 {
		t.Fatalf("el intento fallido no debía dejar ninguna venta persistida, got %d", countAfterFailure)
	}

	// Reintento con la MISMA referencia, ahora con una serie válida -> debe funcionar sin ningún
	// rechazo por "referencia ya usada".
	rec, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, SeriesID: activeSeries.ID,
		Lines: []PosSaleLineInput{posIdemManualLine()}, PaymentMethod: "efectivo", SaleClientRef: "RETRY-1",
	}, false)
	if err != nil {
		t.Fatalf("el reintento con la misma referencia tras un fallo previo debía funcionar: %v", err)
	}
	if rec == nil {
		t.Fatal("esperaba una venta creada en el reintento")
	}
}

// --- Item D: dos solicitudes concurrentes con la misma referencia nunca producen dos ventas válidas --------

func TestIssuePosSale_Idempotency_Concurrent_NeverTwoValidSales(t *testing.T) {
	db := setupPosIdempotencyTestDB(t)
	co := seedPosIdemCompany(t, db, "20910000005")
	seedPosIdemSeries(t, db, "03", "B001", true)
	svc := NewPosSaleService()

	in := PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{posIdemManualLine()},
		PaymentMethod: "efectivo", SaleClientRef: "CONCURRENT-1",
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make([]*models.TukifacFiscalReceipt, 2)
	errs := make([]error, 2)

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		results[0], errs[0] = svc.IssuePosSale(0, in, false)
	}()
	go func() {
		defer wg.Done()
		<-start
		results[1], errs[1] = svc.IssuePosSale(0, in, false)
	}()
	close(start)
	wg.Wait()

	for i, e := range errs {
		if e != nil {
			t.Fatalf("ninguna de las dos solicitudes debía fallar (la colisión debe resolverse devolviendo la venta existente), err[%d]=%v", i, e)
		}
	}
	if results[0].ID != results[1].ID {
		t.Fatalf("ambas solicitudes concurrentes debían converger a la misma venta, got IDs %d y %d", results[0].ID, results[1].ID)
	}
	var count int64
	db.Model(&models.TukifacFiscalReceipt{}).Where("company_id = ? AND sale_client_ref = ?", co.ID, "CONCURRENT-1").Count(&count)
	if count != 1 {
		t.Fatalf("nunca debe haber más de una venta válida para la misma referencia, got %d", count)
	}
}

// --- Item E: sin referencia -> comportamiento retrocompatible, sin ninguna protección ------------------------

func TestIssuePosSale_Idempotency_NoRef_BackwardCompatible_NoProtection(t *testing.T) {
	db := setupPosIdempotencyTestDB(t)
	co := seedPosIdemCompany(t, db, "20910000006")
	seedPosIdemSeries(t, db, "03", "B001", true)
	svc := NewPosSaleService()

	in := PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{posIdemManualLine()},
		PaymentMethod: "efectivo", // SaleClientRef vacío/omitido
	}

	first, err := svc.IssuePosSale(0, in, false)
	if err != nil {
		t.Fatalf("primera emisión: %v", err)
	}
	second, err := svc.IssuePosSale(0, in, false)
	if err != nil {
		t.Fatalf("segunda emisión: %v", err)
	}
	if first.ID == second.ID {
		t.Fatal("sin SaleClientRef no debe haber ninguna deduplicación — cada llamada crea una venta nueva")
	}
	if first.SaleClientRef != nil || second.SaleClientRef != nil {
		t.Fatal("SaleClientRef debe quedar NULL cuando el cliente no lo envía")
	}
}
