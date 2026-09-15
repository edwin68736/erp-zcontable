package services

// Tests de Fase 5 Paso 2B (docs/auditoria-fase5-paso1-pos-integracion-2026-09-15.md,
// docs/auditoria-fase4-comprobantes-payments-2026-09-15.md): IssuePosSale delega en
// CreatePaymentWithComprobante (Fase 4) para crear Payment + comprobante de forma atómica. Cubre
// exactamente los 12 escenarios pedidos (A-L).

import (
	"sync"
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPosPaymentIntegrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
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
		&models.Document{},
		&models.DocumentItem{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	database.DB = db
	return db
}

func seedPPICompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "PosPaymentIntegration Test " + ruc, Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedPPISeries(t *testing.T, db *gorm.DB, sunatCode, series string) models.FiscalDocumentSeries {
	t.Helper()
	s := models.FiscalDocumentSeries{Name: "Serie " + series, SunatCode: sunatCode, Series: series, CurrentNumber: 0, Active: true}
	if err := db.Create(&s).Error; err != nil {
		t.Fatalf("seed series: %v", err)
	}
	return s
}

func ppiManualLine(amount float64) PosSaleLineInput {
	return PosSaleLineInput{Description: "Servicio POS", Quantity: 1, UnitPrice: amount, IsManual: true}
}

// --- Item A: venta POS normal ------------------------------------------------------------------------

func TestIssuePosSale_PaymentIntegration_NormalSale(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000001")
	seedPPISeries(t, db, "03", "B001")
	svc := NewPosSaleService()

	rec, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{ppiManualLine(100)},
		PaymentMethod: "efectivo",
	}, false)
	if err != nil {
		t.Fatalf("IssuePosSale: %v", err)
	}

	var receiptCount, paymentCount, allocCount, docCount int64
	db.Model(&models.TukifacFiscalReceipt{}).Count(&receiptCount)
	db.Model(&models.Payment{}).Count(&paymentCount)
	db.Model(&models.PaymentAllocation{}).Count(&allocCount)
	db.Model(&models.Document{}).Count(&docCount)

	if receiptCount != 1 {
		t.Fatalf("esperaba 1 TukifacFiscalReceipt, got %d", receiptCount)
	}
	if paymentCount != 1 {
		t.Fatalf("esperaba 1 Payment, got %d", paymentCount)
	}
	if allocCount != 0 {
		t.Fatalf("esperaba 0 PaymentAllocation, got %d", allocCount)
	}
	if docCount != 0 {
		t.Fatalf("esperaba 0 Document artificiales, got %d", docCount)
	}
	if rec.LinkedPaymentID == nil {
		t.Fatal("LinkedPaymentID no debía quedar nil")
	}
	var pay models.Payment
	if err := db.First(&pay, *rec.LinkedPaymentID).Error; err != nil {
		t.Fatalf("el Payment referenciado debe existir: %v", err)
	}
	if pay.Purpose == nil || *pay.Purpose != models.PaymentPurposeService {
		t.Fatalf("Payment.Purpose=%v, want servicio", pay.Purpose)
	}
}

// --- Item B: múltiples métodos de pago -> 1 solo Payment, desglose en fiscal_receipt_payments --------

func TestIssuePosSale_PaymentIntegration_SplitPayments_OnePaymentOnly(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000002")
	seedPPISeries(t, db, "03", "B001")
	svc := NewPosSaleService()

	rec, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{ppiManualLine(80)},
		Payments: []PosSalePaymentInput{
			{Method: "efectivo", Amount: 50},
			{Method: "Yape", Amount: 30, OperationNumber: "OP-1"},
		},
	}, false)
	if err != nil {
		t.Fatalf("IssuePosSale: %v", err)
	}

	var paymentCount int64
	db.Model(&models.Payment{}).Count(&paymentCount)
	if paymentCount != 1 {
		t.Fatalf("una venta con varios métodos debe generar 1 solo Payment, got %d", paymentCount)
	}
	var pay models.Payment
	db.First(&pay, *rec.LinkedPaymentID)
	if pay.Amount != 80 {
		t.Fatalf("Payment.Amount=%v, want 80 (50+30)", pay.Amount)
	}
	var rows []models.FiscalReceiptPayment
	db.Where("fiscal_receipt_id = ?", rec.ID).Order("sort_order ASC").Find(&rows)
	if len(rows) != 2 {
		t.Fatalf("esperaba 2 filas de desglose en fiscal_receipt_payments, got %d", len(rows))
	}
}

// --- Item C/D/E: NV, Boleta, Factura — los 3 funcionan y generan Payment enlazado -----------------------

func TestIssuePosSale_PaymentIntegration_AllReceiptKinds(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000003")
	seedPPISeries(t, db, "00", "NV01") // nota de venta
	seedPPISeries(t, db, "03", "B001") // boleta
	seedPPISeries(t, db, "01", "F001") // factura
	svc := NewPosSaleService()

	cases := []struct {
		kind        string
		docTypeWant string
	}{
		{"sale_note", "NV"},
		{"boleta", "03"},
		{"factura", "01"},
	}
	for _, c := range cases {
		rec, err := svc.IssuePosSale(0, PosSaleIssueInput{
			Kind: c.kind, CompanyID: co.ID, Lines: []PosSaleLineInput{ppiManualLine(50)},
			PaymentMethod: "efectivo",
		}, false)
		if err != nil {
			t.Fatalf("IssuePosSale kind=%s: %v", c.kind, err)
		}
		if rec.DocumentTypeID != c.docTypeWant {
			t.Fatalf("kind=%s: DocumentTypeID=%s, want %s", c.kind, rec.DocumentTypeID, c.docTypeWant)
		}
		if rec.LinkedPaymentID == nil {
			t.Fatalf("kind=%s: LinkedPaymentID no debía quedar nil", c.kind)
		}
		if rec.ReconciliationStatus != models.TukifacReceiptLinked {
			t.Fatalf("kind=%s: ReconciliationStatus=%s, want Linked", c.kind, rec.ReconciliationStatus)
		}
	}
}

// --- Item F: rollback ante fallo -> 0 Payment, 0 comprobante, 0 datos parciales --------------------------

func TestIssuePosSale_PaymentIntegration_RollbackOnFailure_NoOrphanData(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000004")
	seedPPISeries(t, db, "03", "B001")
	svc := NewPosSaleService()

	// El primer Payment de una base nueva obtiene ID=1, y la primera reserva de esta serie emite el
	// correlativo B001-00000001 -> external_id determinista que CreatePaymentWithComprobante usará:
	// "local-pc1-B001-00000001". Se pre-siembra un comprobante con ese mismo external_id para forzar
	// que la creación del comprobante falle DESPUÉS de que el Payment ya se creó dentro de la misma
	// transacción — demostrando que el rollback deshace también el Payment.
	if err := db.Create(&models.TukifacFiscalReceipt{
		ExternalID: "local-pc1-B001-00000001", CompanyID: co.ID, DocumentTypeID: "03", Number: "X",
		Total: 1, ReconciliationStatus: models.TukifacReceiptPending, Origin: models.TukifacReceiptOriginSync,
	}).Error; err != nil {
		t.Fatalf("seed receipt colisionante: %v", err)
	}

	_, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{ppiManualLine(50)},
		PaymentMethod: "efectivo",
	}, false)
	if err == nil {
		t.Fatal("la colisión de external_id debía hacer fallar la creación del comprobante")
	}

	var paymentCount int64
	db.Model(&models.Payment{}).Count(&paymentCount)
	if paymentCount != 0 {
		t.Fatalf("el Payment no debía quedar persistido tras el rollback, got %d", paymentCount)
	}
	var realReceiptCount int64
	db.Model(&models.TukifacFiscalReceipt{}).Where("origin = ?", models.TukifacReceiptOriginPOS).Count(&realReceiptCount)
	if realReceiptCount != 0 {
		t.Fatalf("no debía quedar ningún comprobante POS persistido, got %d", realReceiptCount)
	}
}

// --- Item G: idempotencia -> 1 Payment, 1 comprobante, nunca 2 ---------------------------------------------

func TestIssuePosSale_PaymentIntegration_Idempotency_OnePaymentOneReceipt(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000005")
	seedPPISeries(t, db, "03", "B001")
	svc := NewPosSaleService()

	in := PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{ppiManualLine(100)},
		PaymentMethod: "efectivo", SaleClientRef: "IDEM-G",
	}
	first, err := svc.IssuePosSale(0, in, false)
	if err != nil {
		t.Fatalf("primera emisión: %v", err)
	}
	second, err := svc.IssuePosSale(0, in, false)
	if err != nil {
		t.Fatalf("segunda emisión (retry): %v", err)
	}
	if first.ID != second.ID || *first.LinkedPaymentID != *second.LinkedPaymentID {
		t.Fatal("el retry debía devolver exactamente la misma operación (mismo comprobante, mismo Payment)")
	}
	var paymentCount, receiptCount int64
	db.Model(&models.Payment{}).Count(&paymentCount)
	db.Model(&models.TukifacFiscalReceipt{}).Where("company_id = ?", co.ID).Count(&receiptCount)
	if paymentCount != 1 {
		t.Fatalf("debía existir exactamente 1 Payment, got %d", paymentCount)
	}
	if receiptCount != 1 {
		t.Fatalf("debía existir exactamente 1 comprobante, got %d", receiptCount)
	}
}

// --- Item H: concurrencia -> mismo resultado, 1 Payment, 1 comprobante -------------------------------------

func TestIssuePosSale_PaymentIntegration_Concurrent_OnePaymentOneReceipt(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000006")
	seedPPISeries(t, db, "03", "B001")
	svc := NewPosSaleService()

	in := PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{ppiManualLine(100)},
		PaymentMethod: "efectivo", SaleClientRef: "IDEM-H",
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make([]*models.TukifacFiscalReceipt, 2)
	errs := make([]error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); <-start; results[0], errs[0] = svc.IssuePosSale(0, in, false) }()
	go func() { defer wg.Done(); <-start; results[1], errs[1] = svc.IssuePosSale(0, in, false) }()
	close(start)
	wg.Wait()

	for i, e := range errs {
		if e != nil {
			t.Fatalf("ninguna de las dos solicitudes concurrentes debía fallar, err[%d]=%v", i, e)
		}
	}
	if results[0].ID != results[1].ID {
		t.Fatalf("ambas solicitudes concurrentes debían converger al mismo comprobante, got %d y %d", results[0].ID, results[1].ID)
	}
	var paymentCount, receiptCount int64
	db.Model(&models.Payment{}).Count(&paymentCount)
	db.Model(&models.TukifacFiscalReceipt{}).Where("company_id = ?", co.ID).Count(&receiptCount)
	if paymentCount != 1 {
		t.Fatalf("la concurrencia no debe duplicar dinero: esperaba 1 Payment, got %d", paymentCount)
	}
	if receiptCount != 1 {
		t.Fatalf("esperaba 1 comprobante, got %d", receiptCount)
	}
}

// --- Item I: diferentes empresas, misma referencia -> permitido, cada una con su propia operación -----------

func TestIssuePosSale_PaymentIntegration_DifferentCompanies_SameRef_Allowed(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	coA := seedPPICompany(t, db, "20920000007")
	coB := seedPPICompany(t, db, "20920000008")
	seedPPISeries(t, db, "03", "B001")
	svc := NewPosSaleService()

	recA, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: coA.ID, Lines: []PosSaleLineInput{ppiManualLine(50)},
		PaymentMethod: "efectivo", SaleClientRef: "SAME-REF-I",
	}, false)
	if err != nil {
		t.Fatalf("venta empresa A: %v", err)
	}
	recB, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: coB.ID, Lines: []PosSaleLineInput{ppiManualLine(70)},
		PaymentMethod: "efectivo", SaleClientRef: "SAME-REF-I",
	}, false)
	if err != nil {
		t.Fatalf("venta empresa B: %v", err)
	}
	if recA.ID == recB.ID || *recA.LinkedPaymentID == *recB.LinkedPaymentID {
		t.Fatal("empresas distintas con la misma referencia deben producir operaciones (Payment+comprobante) completamente distintas")
	}
}

// --- Item J: retry tras rollback -> la referencia puede reutilizarse correctamente ----------------------------

func TestIssuePosSale_PaymentIntegration_RetryAfterRollback(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000009")
	activeSeries := seedPPISeries(t, db, "03", "B001")
	inactiveSeries := seedPPISeries(t, db, "01", "F001")
	if err := db.Model(&inactiveSeries).Update("active", false).Error; err != nil {
		t.Fatalf("desactivar serie: %v", err)
	}
	svc := NewPosSaleService()

	_, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "factura", CompanyID: co.ID, SeriesID: inactiveSeries.ID,
		Lines: []PosSaleLineInput{ppiManualLine(50)}, PaymentMethod: "efectivo", SaleClientRef: "RETRY-J",
	}, false)
	if err == nil {
		t.Fatal("la serie inactiva debía hacer fallar la emisión")
	}
	var paymentCount int64
	db.Model(&models.Payment{}).Count(&paymentCount)
	if paymentCount != 0 {
		t.Fatalf("el intento fallido no debía dejar ningún Payment persistido, got %d", paymentCount)
	}

	rec, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, SeriesID: activeSeries.ID,
		Lines: []PosSaleLineInput{ppiManualLine(50)}, PaymentMethod: "efectivo", SaleClientRef: "RETRY-J",
	}, false)
	if err != nil {
		t.Fatalf("el reintento con la misma referencia tras un fallo previo debía funcionar: %v", err)
	}
	if rec == nil || rec.LinkedPaymentID == nil {
		t.Fatal("esperaba una operación completa (Payment+comprobante) en el reintento")
	}
}

// --- Item K: integridad financiera --------------------------------------------------------------------------

func TestIssuePosSale_PaymentIntegration_FinancialIntegrity(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000010")
	seedPPISeries(t, db, "03", "B001")
	svc := NewPosSaleService()

	rec, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{ppiManualLine(123.45)},
		PaymentMethod: "efectivo",
	}, false)
	if err != nil {
		t.Fatalf("IssuePosSale: %v", err)
	}
	var docCount, allocCount int64
	db.Model(&models.Document{}).Count(&docCount)
	db.Model(&models.PaymentAllocation{}).Count(&allocCount)
	if docCount != 0 {
		t.Fatalf("una venta POS normal no debe crear Document, got %d", docCount)
	}
	if allocCount != 0 {
		t.Fatalf("una venta POS normal no debe crear PaymentAllocation, got %d", allocCount)
	}
	var pay models.Payment
	db.First(&pay, *rec.LinkedPaymentID)
	if pay.Amount != 123.45 {
		t.Fatalf("Payment.Amount=%v, want 123.45 (total de la venta)", pay.Amount)
	}
	if pay.DocumentID != nil {
		t.Fatalf("Payment.DocumentID debía ser nil, got %v", *pay.DocumentID)
	}
}

// --- Item L: LinkedPaymentID -> nunca queda pendiente de reconciliación --------------------------------------

func TestIssuePosSale_PaymentIntegration_LinkedPaymentID_NeverPending(t *testing.T) {
	db := setupPosPaymentIntegrationTestDB(t)
	co := seedPPICompany(t, db, "20920000011")
	seedPPISeries(t, db, "03", "B001")
	svc := NewPosSaleService()

	rec, err := svc.IssuePosSale(0, PosSaleIssueInput{
		Kind: "boleta", CompanyID: co.ID, Lines: []PosSaleLineInput{ppiManualLine(60)},
		PaymentMethod: "efectivo",
	}, false)
	if err != nil {
		t.Fatalf("IssuePosSale: %v", err)
	}
	if rec.ReconciliationStatus == models.TukifacReceiptPending {
		t.Fatal("una venta POS nueva no debe quedar pendiente_vincular esperando reconciliación manual")
	}
	if rec.ReconciliationStatus != models.TukifacReceiptLinked {
		t.Fatalf("ReconciliationStatus=%s, want vinculado", rec.ReconciliationStatus)
	}
	if rec.LinkedPaymentID == nil {
		t.Fatal("LinkedPaymentID no debía quedar nil")
	}
	var pay models.Payment
	if err := db.First(&pay, *rec.LinkedPaymentID).Error; err != nil {
		t.Fatalf("el Payment enlazado debe existir realmente: %v", err)
	}
}
