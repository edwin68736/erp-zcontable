//go:build mysql_integration

package debt_test

// Tests de concurrencia REAL de Fase 2.5 (docs/diseno-fase2-5-locking-concurrencia-2026-09-14.md).
//
// IMPORTANTE — por qué este archivo existe separado y con build tag:
// El resto de la suite corre contra github.com/glebarez/sqlite (in-memory), cuyo propio código
// fuente descarta silenciosamente la cláusula de locking:
//
//	// glebarez/sqlite@v1.11.0/sqlite.go:115-119
//	"FOR": func(c clause.Clause, builder clause.Builder) {
//	    if _, ok := c.Expression.(clause.Locking); ok {
//	        // SQLite3 does not support row-level locking.
//	        return
//	    }
//
// Es decir: bajo SQLite, `Clauses(clause.Locking{Strength:"UPDATE"})` compila y corre sin error
// pero NO bloquea nada — es un no-op silencioso. Un test de concurrencia contra SQLite no puede
// demostrar que `FOR UPDATE` serializa nada; solo demuestra que el código no revienta. Por eso
// estos tests requieren MySQL real (igual que producción) y están detrás de un build tag
// (`mysql_integration`) para que `go test ./...` normal NO los compile ni los exija.
//
// CÓMO EJECUTARLOS (ver también docs/implementacion-fase2-5-locking-concurrencia-2026-09-14.md):
//
//  1. Levantar un MySQL desechable local (no usar una base compartida ni de producción — estos
//     tests crean datos y no hacen limpieza al finalizar):
//
//     docker run --rm -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=zcontable_test \
//     -p 3307:3306 -d --name zcontable-mysql-test mysql:8
//
//  2. Esperar a que el contenedor esté listo (unos segundos) y ejecutar:
//
//     MYSQL_TEST_DSN="root:test@tcp(127.0.0.1:3307)/zcontable_test?charset=utf8mb4&parseTime=True&loc=Local" \
//     go test -tags=mysql_integration -count=1 -v ./services/debt/... -run Concurrent
//
//  3. Al terminar: docker stop zcontable-mysql-test (--rm ya lo elimina al detenerse).
//
// Si MYSQL_TEST_DSN no está definido, cada test hace t.Skip() — nunca fallan por falta de MySQL.

import (
	"os"
	"sync"
	"testing"
	"time"

	"miappfiber/models"
	"miappfiber/services"
	debtsvc "miappfiber/services/debt"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// mustMySQLTestDB abre una conexión a un MySQL real (variable de entorno MYSQL_TEST_DSN) y aplica
// el AutoMigrate mínimo necesario para estos tests. Si la variable no está definida, salta el test
// (nunca falla el build ni la suite normal).
func mustMySQLTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("MYSQL_TEST_DSN no configurado — este test requiere MySQL real, ver cabecera de allocate_existing_concurrency_test.go")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("conectar a MySQL de prueba (%s): %v", dsn, err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.TaxSettlement{},
		&models.TaxSettlementLine{},
		&models.Document{},
		&models.DocumentItem{},
		&models.Payment{},
		&models.PaymentAllocation{},
		&models.TukifacFiscalReceipt{},
		&models.FiscalReceiptLine{},
		&models.FiscalReceiptPayment{},
	); err != nil {
		t.Fatalf("migrate MySQL de prueba: %v", err)
	}
	return db
}

// seedConcDebt / seedConcPayment: variantes locales de seedAEDebt/seedAEPayment (allocate_existing_
// test.go) que además fijan IssueDate/Date explícitamente. MySQL en modo estricto (a diferencia de
// SQLite) rechaza el time.Time cero por defecto de Go como '0000-00-00 00:00:00' en una columna
// DATETIME no nula (error 1292) — hallazgo propio de este archivo, no relevante para la suite
// SQLite existente, por lo que no se toca allocate_existing_test.go.

func seedConcDebt(t *testing.T, db *gorm.DB, companyID uint, number string, amount float64) models.Document {
	t.Helper()
	doc := models.Document{
		CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: number,
		IssueDate: time.Now(), TotalAmount: amount, BalanceAmount: amount, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed debt %s: %v", number, err)
	}
	return doc
}

func seedConcPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, ptype string, purpose *string) models.Payment {
	t.Helper()
	p := models.Payment{
		CompanyID: companyID, Amount: amount, Type: ptype, Purpose: purpose,
		Date: time.Now(), Method: "Yape", Reference: "OP-ORIGINAL", Description: "desc original",
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	return p
}

// --- Test A: mismo Payment, 700+600 > 1000 -> exactamente una debe fallar por remanente ------------

func TestAllocateExisting_Concurrent_SamePayment_NeverExceedsAmount(t *testing.T) {
	db := mustMySQLTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debtA := seedConcDebt(t, db, co.ID, "concA-1", 700)
	debtB := seedConcDebt(t, db, co.ID, "concA-2", 600)
	pay := seedConcPayment(t, db, co.ID, 1000, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		errs[0] = db.Transaction(func(tx *gorm.DB) error {
			return svc.AllocateExistingPaymentTx(tx, debtsvc.AllocateExistingInput{
				PaymentID: pay.ID, CompanyID: co.ID,
				Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debtA.ID, Amount: 700}},
			})
		})
	}()
	go func() {
		defer wg.Done()
		<-start
		errs[1] = db.Transaction(func(tx *gorm.DB) error {
			return svc.AllocateExistingPaymentTx(tx, debtsvc.AllocateExistingInput{
				PaymentID: pay.ID, CompanyID: co.ID,
				Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debtB.ID, Amount: 600}},
			})
		})
	}()
	close(start) // libera ambas goroutines lo más simultáneamente posible
	wg.Wait()

	succeeded := 0
	for _, e := range errs {
		if e == nil {
			succeeded++
		}
	}
	if succeeded != 1 {
		t.Fatalf("700+600=1300 excede Payment.amount=1000: exactamente una operación debía tener éxito, tuvieron éxito %d (errs=%v)", succeeded, errs)
	}
	applied := aeAppliedSum(db, pay.ID)
	if applied > 1000+debtsvc.MoneyEpsilon {
		t.Fatalf("SUM(allocations)=%v nunca debe exceder Payment.amount=1000", applied)
	}
}

// --- Test B: mismo Payment, 400+500=900<=1000 -> ambas deben tener éxito, remanente=100 -------------

func TestAllocateExisting_Concurrent_SamePayment_BothFit(t *testing.T) {
	db := mustMySQLTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debtA := seedConcDebt(t, db, co.ID, "concB-1", 400)
	debtB := seedConcDebt(t, db, co.ID, "concB-2", 500)
	pay := seedConcPayment(t, db, co.ID, 1000, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		errs[0] = db.Transaction(func(tx *gorm.DB) error {
			return svc.AllocateExistingPaymentTx(tx, debtsvc.AllocateExistingInput{
				PaymentID: pay.ID, CompanyID: co.ID,
				Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debtA.ID, Amount: 400}},
			})
		})
	}()
	go func() {
		defer wg.Done()
		<-start
		errs[1] = db.Transaction(func(tx *gorm.DB) error {
			return svc.AllocateExistingPaymentTx(tx, debtsvc.AllocateExistingInput{
				PaymentID: pay.ID, CompanyID: co.ID,
				Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debtB.ID, Amount: 500}},
			})
		})
	}()
	close(start)
	wg.Wait()

	for i, e := range errs {
		if e != nil {
			t.Fatalf("400+500=900<=1000 caben ambas; el lock debe serializar, no rechazar trabajo legítimo — err[%d]=%v", i, e)
		}
	}
	applied := aeAppliedSum(db, pay.ID)
	if applied != 900 {
		t.Fatalf("SUM(allocations)=%v, want 900", applied)
	}
	var reloaded models.Payment
	if err := db.First(&reloaded, pay.ID).Error; err != nil {
		t.Fatalf("recargar payment: %v", err)
	}
	if remainder := reloaded.Amount - applied; remainder != 100 {
		t.Fatalf("remanente=%v, want 100", remainder)
	}
}

// --- Test C: Payments distintos, mismo Document (saldo=500), 400+300>500 ----------------------------

func TestAllocateExisting_Concurrent_DifferentPayments_SameDocument(t *testing.T) {
	db := mustMySQLTestDB(t)
	svc := debtsvc.NewService()
	co := seedAECompany(t, db)
	debt := seedConcDebt(t, db, co.ID, "concC-1", 500)
	pay1 := seedConcPayment(t, db, co.ID, 400, "on_account", aeStrPtr(models.PaymentPurposeDebt))
	pay2 := seedConcPayment(t, db, co.ID, 300, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		errs[0] = db.Transaction(func(tx *gorm.DB) error {
			return svc.AllocateExistingPaymentTx(tx, debtsvc.AllocateExistingInput{
				PaymentID: pay1.ID, CompanyID: co.ID,
				Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 400}},
			})
		})
	}()
	go func() {
		defer wg.Done()
		<-start
		errs[1] = db.Transaction(func(tx *gorm.DB) error {
			return svc.AllocateExistingPaymentTx(tx, debtsvc.AllocateExistingInput{
				PaymentID: pay2.ID, CompanyID: co.ID,
				Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 300}},
			})
		})
	}()
	close(start)
	wg.Wait()

	succeeded := 0
	for _, e := range errs {
		if e == nil {
			succeeded++
		}
	}
	if succeeded != 1 {
		t.Fatalf("400+300=700 excede el saldo del documento (500): exactamente una operación debía tener éxito, tuvieron éxito %d (errs=%v)", succeeded, errs)
	}

	var totalApplied float64
	db.Model(&models.PaymentAllocation{}).Where("document_id = ?", debt.ID).
		Select("COALESCE(SUM(amount),0)").Scan(&totalApplied)
	if totalApplied > 500+debtsvc.MoneyEpsilon {
		t.Fatalf("SUM(allocations) sobre el documento=%v nunca debe exceder su total_amount=500", totalApplied)
	}
	var reloadedDoc models.Document
	if err := db.First(&reloadedDoc, debt.ID).Error; err != nil {
		t.Fatalf("recargar documento: %v", err)
	}
	if reloadedDoc.BalanceAmount < 0 {
		t.Fatalf("balance_amount nunca debe quedar negativo, got %v", reloadedDoc.BalanceAmount)
	}
}

// --- Test D: AllocateExisting(P,600) concurrente con DeletePaymentTx(P) -----------------------------

func TestAllocateExisting_Concurrent_AllocateAndDeletePayment(t *testing.T) {
	db := mustMySQLTestDB(t)
	svc := debtsvc.NewService()
	paySvc := services.NewPaymentService()
	co := seedAECompany(t, db)
	debt := seedConcDebt(t, db, co.ID, "concD-1", 600)
	pay := seedConcPayment(t, db, co.ID, 1000, "on_account", aeStrPtr(models.PaymentPurposeDebt))

	var wg sync.WaitGroup
	start := make(chan struct{})
	var allocErr, deleteErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		allocErr = db.Transaction(func(tx *gorm.DB) error {
			return svc.AllocateExistingPaymentTx(tx, debtsvc.AllocateExistingInput{
				PaymentID: pay.ID, CompanyID: co.ID,
				Lines: []debtsvc.PaymentAllocationLine{{DocumentID: debt.ID, Amount: 600}},
			})
		})
	}()
	go func() {
		defer wg.Done()
		<-start
		deleteErr = db.Transaction(func(tx *gorm.DB) error {
			return paySvc.DeletePaymentTx(tx, pay.ID)
		})
	}()
	close(start)
	wg.Wait()

	var remainingAllocs int64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", pay.ID).Count(&remainingAllocs)
	var remainingPayment int64
	db.Model(&models.Payment{}).Where("id = ?", pay.ID).Count(&remainingPayment)

	t.Logf("allocErr=%v deleteErr=%v remainingPayment=%d remainingAllocs=%d", allocErr, deleteErr, remainingPayment, remainingAllocs)

	// Estados consistentes aceptados (docs/diseno-fase2-5-...md §2.3):
	//   A. Delete gana:            Payment inexistente + allocations inexistentes.
	//   B. Allocate gana y Delete
	//      lo limpia después:      Payment inexistente + allocations inexistentes (delete las borró).
	//   C. Allocate gana y Delete
	//      no llega a tiempo:      Payment existente + allocation válida.
	// Nunca: allocation huérfana, allocation sobreviviendo a un Payment eliminado, Payment eliminado
	// con allocation persistente, o estado parcial (más de 1 allocation para un solo intento).
	if remainingPayment == 0 {
		if remainingAllocs != 0 {
			t.Fatalf("allocation huérfana: el Payment %d fue eliminado pero quedaron %d PaymentAllocation", pay.ID, remainingAllocs)
		}
	} else {
		if remainingAllocs > 1 {
			t.Fatalf("estado inconsistente: %d allocations para un solo intento de asignación sobre un Payment que sigue existiendo", remainingAllocs)
		}
	}
}
