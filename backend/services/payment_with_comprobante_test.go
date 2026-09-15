package services

// Tests de Fase 4 Paso 2 (docs/auditoria-fase4-comprobantes-payments-2026-09-15.md):
//   - Objetivo A: PaymentCreateParams.Purpose (tests A-C).
//   - Objetivo B: FiscalReceiptIssueService.CreatePaymentWithComprobante (tests D-K).

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPaymentComprobanteTestDB(t *testing.T) *gorm.DB {
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
		&models.TaxSettlementLine{},
		&models.FiscalDocumentSeries{},
		&models.TukifacFiscalReceipt{},
		&models.FiscalReceiptLine{},
		&models.FiscalReceiptPayment{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func pwcStrPtr(s string) *string { return &s }

func seedPWCCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "PaymentComprobante Test " + ruc}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

// seedPWCSeries crea una serie local activa para el DocumentTypeID/kind indicado (SUNAT "03" boleta
// por defecto en la mayoría de tests).
func seedPWCSeries(t *testing.T, db *gorm.DB, sunatCode, series string) models.FiscalDocumentSeries {
	t.Helper()
	s := models.FiscalDocumentSeries{Name: "Serie test " + series, SunatCode: sunatCode, Series: series, CurrentNumber: 0, Active: true}
	if err := db.Create(&s).Error; err != nil {
		t.Fatalf("seed series: %v", err)
	}
	return s
}

func seedPWCDocument(t *testing.T, db *gorm.DB, companyID uint, number string, amount float64) models.Document {
	t.Helper()
	doc := models.Document{
		CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: number,
		IssueDate: time.Now(), TotalAmount: amount, BalanceAmount: amount, Status: "pendiente",
	}
	if err := db.Create(&doc).Error; err != nil {
		t.Fatalf("seed document: %v", err)
	}
	return doc
}

// --- Objetivo A: Purpose en PaymentCreateParams -----------------------------------------------------

// Item A: Purpose=servicio (on_account) se persiste correctamente.
func TestCreateFromParams_PurposeServicio_Persisted(t *testing.T) {
	setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, database.DB, "20990000001")
	svc := NewPaymentService()

	id, err := svc.CreateFromParams(&PaymentCreateParams{
		CompanyID: co.ID, Amount: 300, Type: "on_account", Purpose: pwcStrPtr(models.PaymentPurposeService),
	})
	if err != nil {
		t.Fatalf("CreateFromParams: %v", err)
	}
	var pay models.Payment
	if err := database.DB.First(&pay, id).Error; err != nil {
		t.Fatalf("recargar payment: %v", err)
	}
	if pay.Purpose == nil || *pay.Purpose != models.PaymentPurposeService {
		t.Fatalf("Purpose=%v, want servicio", pay.Purpose)
	}
}

// Item B: Purpose=deuda (applied, con allocation) se persiste correctamente.
func TestCreateFromParams_PurposeDeuda_Persisted(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000002")
	doc := seedPWCDocument(t, db, co.ID, "1", 500)
	svc := NewPaymentService()

	id, err := svc.CreateFromParams(&PaymentCreateParams{
		CompanyID: co.ID, Amount: 500, Type: "applied", DocumentID: &doc.ID,
		Purpose: pwcStrPtr(models.PaymentPurposeDebt),
	})
	if err != nil {
		t.Fatalf("CreateFromParams: %v", err)
	}
	var pay models.Payment
	if err := database.DB.First(&pay, id).Error; err != nil {
		t.Fatalf("recargar payment: %v", err)
	}
	if pay.Purpose == nil || *pay.Purpose != models.PaymentPurposeDebt {
		t.Fatalf("Purpose=%v, want deuda", pay.Purpose)
	}
}

// Item C: Purpose inválido se rechaza.
func TestCreateFromParams_PurposeInvalid_Rejected(t *testing.T) {
	setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, database.DB, "20990000003")
	svc := NewPaymentService()

	_, err := svc.CreateFromParams(&PaymentCreateParams{
		CompanyID: co.ID, Amount: 100, Type: "on_account", Purpose: pwcStrPtr("invalido"),
	})
	if err == nil {
		t.Fatal("un Purpose fuera de {deuda, servicio} debe rechazarse")
	}
}

// --- Objetivo B: CreatePaymentWithComprobante ----------------------------------------------------------

func basicServiceLine(amount float64) PaymentWithComprobanteLine {
	subtotal := roundFiscalMoney(amount / 1.18)
	tax := roundFiscalMoney(amount - subtotal)
	return PaymentWithComprobanteLine{
		LineType: models.FiscalReceiptLineTypeManual, ProductName: "Servicio independiente",
		Description: "Servicio independiente", UnitTypeID: "NIU", Quantity: 1, UnitPrice: amount,
		LineSubtotal: subtotal, IGVRate: 18, IGVAmount: tax, LineTotal: amount,
	}
}

// Item D: creación exitosa — Payment existe, comprobante existe, LinkedPaymentID correcto,
// ReconciliationStatus=Linked, Payment.Purpose correcto.
func TestCreatePaymentWithComprobante_Success(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000004")
	ser := seedPWCSeries(t, db, "03", "B001")
	svc := NewFiscalReceiptIssueService()

	rec, err := svc.CreatePaymentWithComprobante(PaymentWithComprobanteInput{
		CompanyID: co.ID, Kind: "boleta", SeriesID: ser.ID, Origin: models.TukifacReceiptOriginPOS,
		Purpose: models.PaymentPurposeService, Amount: 100, Method: "efectivo",
		Lines: []PaymentWithComprobanteLine{basicServiceLine(100)},
	})
	if err != nil {
		t.Fatalf("CreatePaymentWithComprobante: %v", err)
	}
	if rec.LinkedPaymentID == nil {
		t.Fatal("LinkedPaymentID no debía quedar nil")
	}
	if rec.ReconciliationStatus != models.TukifacReceiptLinked {
		t.Fatalf("ReconciliationStatus=%s, want Linked", rec.ReconciliationStatus)
	}
	var pay models.Payment
	if err := database.DB.First(&pay, *rec.LinkedPaymentID).Error; err != nil {
		t.Fatalf("el Payment referenciado debe existir: %v", err)
	}
	if pay.Purpose == nil || *pay.Purpose != models.PaymentPurposeService {
		t.Fatalf("Payment.Purpose=%v, want servicio", pay.Purpose)
	}
	if pay.Amount != 100 {
		t.Fatalf("Payment.Amount=%v, want 100", pay.Amount)
	}
}

// Item E: si falla la creación del comprobante (colisión de ExternalID), el Payment NO debe quedar
// persistido — demuestra que el rollback de la transacción es real.
func TestCreatePaymentWithComprobante_ReceiptCreationFails_PaymentNotPersisted(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000005")
	ser := seedPWCSeries(t, db, "03", "B001")
	svc := NewFiscalReceiptIssueService()

	// El primer Payment de una base nueva obtiene ID=1, y la primera reserva de esta serie emite el
	// correlativo B001-00000001 -> external_id determinista: "local-pc1-B001-00000001".
	if err := db.Create(&models.TukifacFiscalReceipt{
		ExternalID: "local-pc1-B001-00000001", CompanyID: co.ID, DocumentTypeID: "03", Number: "X",
		Total: 1, ReconciliationStatus: models.TukifacReceiptPending, Origin: models.TukifacReceiptOriginSync,
	}).Error; err != nil {
		t.Fatalf("seed receipt colisionante: %v", err)
	}

	var paymentsBefore int64
	db.Model(&models.Payment{}).Count(&paymentsBefore)

	_, err := svc.CreatePaymentWithComprobante(PaymentWithComprobanteInput{
		CompanyID: co.ID, Kind: "boleta", SeriesID: ser.ID, Origin: models.TukifacReceiptOriginPOS,
		Purpose: models.PaymentPurposeService, Amount: 50, Method: "efectivo",
		Lines: []PaymentWithComprobanteLine{basicServiceLine(50)},
	})
	if err == nil {
		t.Fatal("la colisión de external_id debía hacer fallar la creación del comprobante")
	}
	var paymentsAfter int64
	db.Model(&models.Payment{}).Count(&paymentsAfter)
	if paymentsAfter != paymentsBefore {
		t.Fatalf("el Payment no debía quedar persistido tras el rollback: antes=%d después=%d", paymentsBefore, paymentsAfter)
	}
}

// Item F: las líneas cuyo total no coincide con el monto se rechazan antes de crear nada (ni
// Payment ni Document ni comprobante) — incluso más estricto que un rollback, no se abre la
// transacción con datos que ya se sabe que no cuadran.
func TestCreatePaymentWithComprobante_LinesMismatch_RejectsNothingPersisted(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000006")
	ser := seedPWCSeries(t, db, "03", "B001")
	svc := NewFiscalReceiptIssueService()

	_, err := svc.CreatePaymentWithComprobante(PaymentWithComprobanteInput{
		CompanyID: co.ID, Kind: "boleta", SeriesID: ser.ID, Origin: models.TukifacReceiptOriginPOS,
		Purpose: models.PaymentPurposeService, Amount: 100, Method: "efectivo",
		Lines: []PaymentWithComprobanteLine{basicServiceLine(60)}, // línea de 60 contra Amount=100
	})
	if err == nil {
		t.Fatal("el total de las líneas (60) no coincide con Amount (100); debía rechazarse")
	}
	var paymentsCount int64
	db.Model(&models.Payment{}).Count(&paymentsCount)
	if paymentsCount != 0 {
		t.Fatalf("no debía crearse ningún Payment, got %d", paymentsCount)
	}
}

// Item G: los montos de fiscal_receipt_payments que no cuadran con el total se rechazan antes de
// crear nada (normalizePosPayments ya hace esta validación, reutilizada aquí sin duplicarla).
func TestCreatePaymentWithComprobante_SplitPaymentsMismatch_RejectsNothingPersisted(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000007")
	ser := seedPWCSeries(t, db, "03", "B001")
	svc := NewFiscalReceiptIssueService()

	_, err := svc.CreatePaymentWithComprobante(PaymentWithComprobanteInput{
		CompanyID: co.ID, Kind: "boleta", SeriesID: ser.ID, Origin: models.TukifacReceiptOriginPOS,
		Purpose: models.PaymentPurposeService, Amount: 80,
		Payments: []PosSalePaymentInput{
			{Method: "efectivo", Amount: 50},
			{Method: "Yape", Amount: 20, OperationNumber: "OP-1"}, // 50+20=70 != 80
		},
		Lines: []PaymentWithComprobanteLine{basicServiceLine(80)},
	})
	if err == nil {
		t.Fatal("50+20=70 no coincide con Amount=80; debía rechazarse")
	}
	var receiptsCount int64
	db.Model(&models.TukifacFiscalReceipt{}).Count(&receiptsCount)
	if receiptsCount != 0 {
		t.Fatalf("no debía crearse ningún comprobante, got %d", receiptsCount)
	}
}

// Item H: métodos de pago divididos — Payment.Amount = suma de métodos, y el snapshot del
// comprobante (FiscalReceiptPayment) coincide línea por línea.
func TestCreatePaymentWithComprobante_SplitPayments_MatchesAmount(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000008")
	ser := seedPWCSeries(t, db, "03", "B001")
	svc := NewFiscalReceiptIssueService()

	rec, err := svc.CreatePaymentWithComprobante(PaymentWithComprobanteInput{
		CompanyID: co.ID, Kind: "boleta", SeriesID: ser.ID, Origin: models.TukifacReceiptOriginPOS,
		Purpose: models.PaymentPurposeService, Amount: 80,
		Payments: []PosSalePaymentInput{
			{Method: "efectivo", Amount: 50},
			{Method: "Yape", Amount: 30, OperationNumber: "OP-2"},
		},
		Lines: []PaymentWithComprobanteLine{basicServiceLine(80)},
	})
	if err != nil {
		t.Fatalf("CreatePaymentWithComprobante: %v", err)
	}
	var pay models.Payment
	if err := database.DB.First(&pay, *rec.LinkedPaymentID).Error; err != nil {
		t.Fatalf("recargar payment: %v", err)
	}
	if pay.Amount != 80 {
		t.Fatalf("Payment.Amount=%v, want 80 (50+30)", pay.Amount)
	}
	var rows []models.FiscalReceiptPayment
	database.DB.Where("fiscal_receipt_id = ?", rec.ID).Order("sort_order ASC").Find(&rows)
	if len(rows) != 2 {
		t.Fatalf("esperaba 2 filas de FiscalReceiptPayment, got %d", len(rows))
	}
	if rows[0].Amount != 50 || rows[1].Amount != 30 {
		t.Fatalf("montos del snapshot no coinciden: %v / %v, want 50 / 30", rows[0].Amount, rows[1].Amount)
	}
}

// Item I: servicio independiente — Purpose=servicio, sin allocations, sin Document creado.
func TestCreatePaymentWithComprobante_ServiceIndependent_NoDocumentCreated(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000009")
	ser := seedPWCSeries(t, db, "03", "B001")
	svc := NewFiscalReceiptIssueService()

	var docsBefore int64
	db.Model(&models.Document{}).Count(&docsBefore)

	rec, err := svc.CreatePaymentWithComprobante(PaymentWithComprobanteInput{
		CompanyID: co.ID, Kind: "boleta", SeriesID: ser.ID, Origin: models.TukifacReceiptOriginPOS,
		Purpose: models.PaymentPurposeService, Amount: 120, Method: "efectivo",
		Lines: []PaymentWithComprobanteLine{basicServiceLine(120)},
	})
	if err != nil {
		t.Fatalf("CreatePaymentWithComprobante: %v", err)
	}
	var docsAfter int64
	db.Model(&models.Document{}).Count(&docsAfter)
	if docsAfter != docsBefore {
		t.Fatalf("no debía crearse ningún Document, antes=%d después=%d", docsBefore, docsAfter)
	}
	var allocCount int64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", *rec.LinkedPaymentID).Count(&allocCount)
	if allocCount != 0 {
		t.Fatalf("no debía crearse ninguna PaymentAllocation, got %d", allocCount)
	}
}

// Item J: Payment.DocumentID continúa NULL en el nuevo flujo.
func TestCreatePaymentWithComprobante_DocumentIDStaysNull(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000010")
	ser := seedPWCSeries(t, db, "03", "B001")
	svc := NewFiscalReceiptIssueService()

	rec, err := svc.CreatePaymentWithComprobante(PaymentWithComprobanteInput{
		CompanyID: co.ID, Kind: "boleta", SeriesID: ser.ID, Origin: models.TukifacReceiptOriginPOS,
		Purpose: models.PaymentPurposeService, Amount: 90, Method: "efectivo",
		Lines: []PaymentWithComprobanteLine{basicServiceLine(90)},
	})
	if err != nil {
		t.Fatalf("CreatePaymentWithComprobante: %v", err)
	}
	var pay models.Payment
	if err := database.DB.First(&pay, *rec.LinkedPaymentID).Error; err != nil {
		t.Fatalf("recargar payment: %v", err)
	}
	if pay.DocumentID != nil {
		t.Fatalf("Payment.DocumentID debía seguir NULL, got %v", *pay.DocumentID)
	}
}

// Item K: CompanyID — Payment y comprobante quedan con la empresa correcta.
func TestCreatePaymentWithComprobante_CompanyIDConsistent(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000011")
	other := seedPWCCompany(t, db, "20990000012")
	ser := seedPWCSeries(t, db, "03", "B001")
	svc := NewFiscalReceiptIssueService()

	rec, err := svc.CreatePaymentWithComprobante(PaymentWithComprobanteInput{
		CompanyID: co.ID, Kind: "boleta", SeriesID: ser.ID, Origin: models.TukifacReceiptOriginPOS,
		Purpose: models.PaymentPurposeService, Amount: 70, Method: "efectivo",
		Lines: []PaymentWithComprobanteLine{basicServiceLine(70)},
	})
	if err != nil {
		t.Fatalf("CreatePaymentWithComprobante: %v", err)
	}
	if rec.CompanyID != co.ID || rec.CompanyID == other.ID {
		t.Fatalf("rec.CompanyID=%v, want %v (nunca la otra empresa)", rec.CompanyID, co.ID)
	}
	var pay models.Payment
	if err := database.DB.First(&pay, *rec.LinkedPaymentID).Error; err != nil {
		t.Fatalf("recargar payment: %v", err)
	}
	if pay.CompanyID != co.ID {
		t.Fatalf("pay.CompanyID=%v, want %v", pay.CompanyID, co.ID)
	}
}
