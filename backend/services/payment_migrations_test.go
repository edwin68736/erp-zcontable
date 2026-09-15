package services

// Tests de Fase 2.1 + 2.2 (docs/implementacion-fase2-1-2-2-payment-purpose-2026-09-14.md):
// Payment.Purpose (modelo, migración) y el backfill histórico. Cubre los 20 casos mínimos pedidos.

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPaymentPurposeTestDB(t *testing.T) *gorm.DB {
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
		&models.TukifacFiscalReceipt{},
		&models.FiscalReceiptLine{},
		&models.FiscalReceiptPayment{},
		&models.DocumentConsolidationLog{},
		&models.SchemaMigration{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func seedPPCompany(t *testing.T, db *gorm.DB) models.Company {
	t.Helper()
	co := models.Company{RUC: "20800000001", BusinessName: "Empresa Purpose Test"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func strPtr(s string) *string { return &s }

// --- Modelo (items 1-3): Purpose puede ser deuda / servicio / NULL, y persiste correctamente ------

func TestPaymentPurpose_ModelRoundTrip_DeudaServicioNull(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)

	pDeuda := models.Payment{CompanyID: co.ID, Amount: 100, Type: "on_account", Purpose: strPtr(models.PaymentPurposeDebt)}
	pServicio := models.Payment{CompanyID: co.ID, Amount: 200, Type: "on_account", Purpose: strPtr(models.PaymentPurposeService)}
	pNull := models.Payment{CompanyID: co.ID, Amount: 300, Type: "on_account"}
	for _, p := range []*models.Payment{&pDeuda, &pServicio, &pNull} {
		if err := db.Create(p).Error; err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	var r1, r2, r3 models.Payment
	db.First(&r1, pDeuda.ID)
	db.First(&r2, pServicio.ID)
	db.First(&r3, pNull.ID)

	if r1.Purpose == nil || *r1.Purpose != models.PaymentPurposeDebt {
		t.Fatalf("esperaba purpose=deuda, got %v", r1.Purpose)
	}
	if r2.Purpose == nil || *r2.Purpose != models.PaymentPurposeService {
		t.Fatalf("esperaba purpose=servicio, got %v", r2.Purpose)
	}
	if r3.Purpose != nil {
		t.Fatalf("esperaba purpose=NULL, got %v", *r3.Purpose)
	}
}

// --- Migración (items 4-5): agrega la columna, payments existentes quedan NULL sin fallar ----------

func TestRunPaymentMigrations_ExistingPaymentsStayNullAndDontFail(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	p := models.Payment{CompanyID: co.ID, Amount: 50, Type: "on_account"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Antes de correr cualquier backfill, un Payment recién creado sin Purpose explícito ya nace NULL
	// (columna nullable, sin default) — confirma que la migración de esquema no falla ni fuerza un
	// valor sobre datos existentes.
	var reloaded models.Payment
	db.First(&reloaded, p.ID)
	if reloaded.Purpose != nil {
		t.Fatalf("un Payment recién creado sin Purpose explícito debía quedar NULL, got %v", *reloaded.Purpose)
	}

	if err := RunPaymentMigrations(db); err != nil {
		t.Fatalf("RunPaymentMigrations: %v", err)
	}
	// Sin allocation/documentID/comprobante -> sigue ambiguo, sigue NULL tras el backfill.
	db.First(&reloaded, p.ID)
	if reloaded.Purpose != nil {
		t.Fatalf("pago ambiguo no debía clasificarse, got %v", *reloaded.Purpose)
	}
}

// --- Backfill: Caso A — PaymentAllocation → deuda (item 6) -----------------------------------------

func TestBackfillPaymentPurpose_WithAllocation_ClassifiesAsDeuda(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	doc := models.Document{CompanyID: co.ID, Source: "liquidacion", Type: "LI", Number: "1", TotalAmount: 100, BalanceAmount: 0, Status: "pagado"}
	db.Create(&doc)
	p := models.Payment{CompanyID: co.ID, Amount: 100, Type: "applied"}
	db.Create(&p)
	db.Create(&models.PaymentAllocation{PaymentID: p.ID, DocumentID: doc.ID, Amount: 100})

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Payment
	db.First(&reloaded, p.ID)
	if reloaded.Purpose == nil || *reloaded.Purpose != models.PaymentPurposeDebt {
		t.Fatalf("esperaba deuda, got %v", reloaded.Purpose)
	}
}

// --- Caso B — Payment.DocumentID legacy → deuda (item 7) -------------------------------------------

func TestBackfillPaymentPurpose_LegacyDocumentID_ClassifiesAsDeuda(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	doc := models.Document{CompanyID: co.ID, Source: "manual", Type: "FACTURA", Number: "2", TotalAmount: 50, BalanceAmount: 0, Status: "pagado"}
	db.Create(&doc)
	p := models.Payment{CompanyID: co.ID, Amount: 50, Type: "applied", DocumentID: &doc.ID}
	db.Create(&p)

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Payment
	db.First(&reloaded, p.ID)
	if reloaded.Purpose == nil || *reloaded.Purpose != models.PaymentPurposeDebt {
		t.Fatalf("esperaba deuda (via DocumentID legacy), got %v", reloaded.Purpose)
	}
}

// --- Documento de liquidación (item 8) / recurrente (item 9) / manual (item 10) — todos deuda ------

func TestBackfillPaymentPurpose_DocumentSourceVariants_AllClassifyAsDeuda(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)

	sources := []string{"liquidacion", "recurrente_plan", "manual"}
	var paymentIDs []uint
	for i, src := range sources {
		doc := models.Document{CompanyID: co.ID, Source: src, Type: "X", Number: string(rune('A' + i)), TotalAmount: 10, BalanceAmount: 0, Status: "pagado"}
		if err := db.Create(&doc).Error; err != nil {
			t.Fatalf("seed doc %s: %v", src, err)
		}
		p := models.Payment{CompanyID: co.ID, Amount: 10, Type: "applied"}
		if err := db.Create(&p).Error; err != nil {
			t.Fatalf("seed payment %s: %v", src, err)
		}
		if err := db.Create(&models.PaymentAllocation{PaymentID: p.ID, DocumentID: doc.ID, Amount: 10}).Error; err != nil {
			t.Fatalf("seed alloc %s: %v", src, err)
		}
		paymentIDs = append(paymentIDs, p.ID)
	}

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	for i, pid := range paymentIDs {
		var reloaded models.Payment
		db.First(&reloaded, pid)
		if reloaded.Purpose == nil || *reloaded.Purpose != models.PaymentPurposeDebt {
			t.Fatalf("source=%s: esperaba deuda, got %v", sources[i], reloaded.Purpose)
		}
	}
}

// --- Caso D — comprobante POS vinculado, sin allocation/documentID → servicio (item 11) ------------

func TestBackfillPaymentPurpose_POSReceiptLinked_ClassifiesAsServicio(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	p := models.Payment{CompanyID: co.ID, Amount: 300, Type: "on_account"}
	db.Create(&p)
	receipt := models.TukifacFiscalReceipt{
		ExternalID: "pos-test-1", CompanyID: co.ID, Number: "NV03-000001", Total: 300,
		ReconciliationStatus: models.TukifacReceiptLinked, LinkedPaymentID: &p.ID,
		Origin: models.TukifacReceiptOriginPOS,
	}
	if err := db.Create(&receipt).Error; err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Payment
	db.First(&reloaded, p.ID)
	if reloaded.Purpose == nil || *reloaded.Purpose != models.PaymentPurposeService {
		t.Fatalf("esperaba servicio (comprobante POS vinculado), got %v", reloaded.Purpose)
	}
}

// Un comprobante issued_local vinculado (nace de un Payment ya existente en Finanzas, puede ser un
// a-cuenta genuino) NO debe clasificarse como servicio por esta señal — debe quedar ambiguo.
func TestBackfillPaymentPurpose_IssuedLocalReceiptLinked_StaysAmbiguous(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	p := models.Payment{CompanyID: co.ID, Amount: 300, Type: "on_account"}
	db.Create(&p)
	receipt := models.TukifacFiscalReceipt{
		ExternalID: "local-test-1", CompanyID: co.ID, Number: "B001-000001", Total: 300,
		ReconciliationStatus: models.TukifacReceiptLinked, LinkedPaymentID: &p.ID,
		Origin: models.TukifacReceiptOriginIssuedLocal,
	}
	if err := db.Create(&receipt).Error; err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Payment
	db.First(&reloaded, p.ID)
	if reloaded.Purpose != nil {
		t.Fatalf("un comprobante issued_local no debe clasificar como servicio; esperaba NULL, got %v", *reloaded.Purpose)
	}
}

// --- Caso E — on_account totalmente ambiguo → NULL (item 12) ---------------------------------------

func TestBackfillPaymentPurpose_TrulyAmbiguous_StaysNull(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	p := models.Payment{CompanyID: co.ID, Amount: 500, Type: "on_account"}
	db.Create(&p)

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Payment
	db.First(&reloaded, p.ID)
	if reloaded.Purpose != nil {
		t.Fatalf("sin ninguna evidencia, esperaba NULL, got %v", *reloaded.Purpose)
	}
}

// --- Ya clasificado no se toca (item 13) ------------------------------------------------------------

func TestBackfillPaymentPurpose_AlreadyClassified_NotOverwritten(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	// Un operador (o un proceso futuro de Fase 2.6) ya clasificó este pago como servicio, aunque hoy
	// no tenga ninguna de las señales que el backfill usaría — el backfill NUNCA debe pisarlo.
	p := models.Payment{CompanyID: co.ID, Amount: 100, Type: "on_account", Purpose: strPtr(models.PaymentPurposeService)}
	db.Create(&p)

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var reloaded models.Payment
	db.First(&reloaded, p.ID)
	if reloaded.Purpose == nil || *reloaded.Purpose != models.PaymentPurposeService {
		t.Fatalf("un pago ya clasificado no debía modificarse, got %v", reloaded.Purpose)
	}
}

// --- Idempotencia: ejecutar dos veces produce el mismo resultado (item 14) -------------------------

func TestBackfillPaymentPurpose_RunTwice_Idempotent(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	doc := models.Document{CompanyID: co.ID, Source: "liquidacion", Type: "LI", Number: "1", TotalAmount: 100, BalanceAmount: 0, Status: "pagado"}
	db.Create(&doc)
	pDeuda := models.Payment{CompanyID: co.ID, Amount: 100, Type: "applied"}
	db.Create(&pDeuda)
	db.Create(&models.PaymentAllocation{PaymentID: pDeuda.ID, DocumentID: doc.ID, Amount: 100})
	pAmbiguo := models.Payment{CompanyID: co.ID, Amount: 20, Type: "on_account"}
	db.Create(&pAmbiguo)

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill 1: %v", err)
	}
	var after1Deuda, after1Ambiguo models.Payment
	db.First(&after1Deuda, pDeuda.ID)
	db.First(&after1Ambiguo, pAmbiguo.ID)

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill 2: %v", err)
	}
	var after2Deuda, after2Ambiguo models.Payment
	db.First(&after2Deuda, pDeuda.ID)
	db.First(&after2Ambiguo, pAmbiguo.ID)

	if *after1Deuda.Purpose != *after2Deuda.Purpose {
		t.Fatalf("resultado cambió entre corridas: %s vs %s", *after1Deuda.Purpose, *after2Deuda.Purpose)
	}
	if after1Ambiguo.Purpose != nil || after2Ambiguo.Purpose != nil {
		t.Fatalf("el ambiguo debía seguir NULL en ambas corridas, got %v / %v", after1Ambiguo.Purpose, after2Ambiguo.Purpose)
	}
}

// Ejecutar RunPaymentMigrations (con su guardado en schema_migrations) dos veces: la segunda no debe
// re-ejecutar el cuerpo del backfill (verificable porque no falla ni duplica logs de forma
// descontrolada; el propio mecanismo de Fase 1 ya prueba este patrón, aquí solo confirmamos que
// correr dos veces no rompe nada para el caso de pagos).
func TestRunPaymentMigrations_RunTwice_NoError(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	db.Create(&models.Payment{CompanyID: co.ID, Amount: 30, Type: "on_account"})

	if err := RunPaymentMigrations(db); err != nil {
		t.Fatalf("primera corrida: %v", err)
	}
	if err := RunPaymentMigrations(db); err != nil {
		t.Fatalf("segunda corrida no debía fallar: %v", err)
	}
}

// --- Un pago independiente clasificado como servicio NO recibe allocations (item 15) ----------------

func TestBackfillPaymentPurpose_ServicePayment_NeverGetsAllocations(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	p := models.Payment{CompanyID: co.ID, Amount: 300, Type: "on_account"}
	db.Create(&p)
	receipt := models.TukifacFiscalReceipt{
		ExternalID: "pos-test-2", CompanyID: co.ID, Number: "NV03-000002", Total: 300,
		ReconciliationStatus: models.TukifacReceiptLinked, LinkedPaymentID: &p.ID,
		Origin: models.TukifacReceiptOriginPOS,
	}
	db.Create(&receipt)

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var allocCount int64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", p.ID).Count(&allocCount)
	if allocCount != 0 {
		t.Fatalf("el backfill de Purpose NUNCA debe crear PaymentAllocation, got %d", allocCount)
	}
}

// --- El backfill no modifica amount/type/document_id/balances/no crea ni borra Payments (16-20) -----

func TestBackfillPaymentPurpose_NeverModifiesUnrelatedFields(t *testing.T) {
	db := setupPaymentPurposeTestDB(t)
	co := seedPPCompany(t, db)
	doc := models.Document{CompanyID: co.ID, Source: "manual", Type: "FACTURA", Number: "9", TotalAmount: 70, BalanceAmount: 20, Status: "parcial"}
	db.Create(&doc)
	p := models.Payment{CompanyID: co.ID, Amount: 50, Type: "applied", DocumentID: &doc.ID, Method: "Yape", Reference: "OP-1"}
	db.Create(&p)

	var totalPaymentsBefore, totalDocsBefore int64
	db.Model(&models.Payment{}).Count(&totalPaymentsBefore)
	db.Model(&models.Document{}).Count(&totalDocsBefore)

	if err := migratePaymentsPurposeBackfill(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	var reloadedPay models.Payment
	db.First(&reloadedPay, p.ID)
	if reloadedPay.Amount != 50 {
		t.Fatalf("Amount fue modificado: %v", reloadedPay.Amount)
	}
	if reloadedPay.Type != "applied" {
		t.Fatalf("Type fue modificado: %v", reloadedPay.Type)
	}
	if reloadedPay.DocumentID == nil || *reloadedPay.DocumentID != doc.ID {
		t.Fatalf("DocumentID fue modificado: %v", reloadedPay.DocumentID)
	}
	if reloadedPay.Method != "Yape" || reloadedPay.Reference != "OP-1" {
		t.Fatalf("otros campos fueron modificados: method=%s reference=%s", reloadedPay.Method, reloadedPay.Reference)
	}

	var reloadedDoc models.Document
	db.First(&reloadedDoc, doc.ID)
	if reloadedDoc.BalanceAmount != 20 || reloadedDoc.Status != "parcial" {
		t.Fatalf("el backfill de Purpose no debe tocar el saldo/estado del Document: balance=%v status=%s", reloadedDoc.BalanceAmount, reloadedDoc.Status)
	}

	var totalPaymentsAfter, totalDocsAfter int64
	db.Model(&models.Payment{}).Count(&totalPaymentsAfter)
	db.Model(&models.Document{}).Count(&totalDocsAfter)
	if totalPaymentsAfter != totalPaymentsBefore {
		t.Fatalf("el backfill no debe crear ni borrar Payments: antes=%d después=%d", totalPaymentsBefore, totalPaymentsAfter)
	}
	if totalDocsAfter != totalDocsBefore {
		t.Fatalf("el backfill de Purpose no debe crear ni borrar Documents: antes=%d después=%d", totalDocsBefore, totalDocsAfter)
	}
}
