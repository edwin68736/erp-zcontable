package services

// Tests de Fase 6 Paso 3 (docs/diseno-fase6-paso2-cancelaciones-writeoff-2026-09-15.md): cancelación
// auditable de Payment (VoidedAt/VoidedBy/VoidReason), reversión del vínculo deuda<->liquidación,
// propagación de reason/userID en cascadas de TaxSettlementService, e idempotencia/concurrencia.

import (
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"
	debtsvc "miappfiber/services/debt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPaymentVoidingTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.Document{},
		&models.DocumentItem{},
		&models.Payment{},
		&models.PaymentAllocation{},
		&models.TaxSettlement{},
		&models.TaxSettlementLine{},
		&models.TukifacFiscalReceipt{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	database.DB = db
	return db
}

func seedPVCompany(t *testing.T, db *gorm.DB, ruc string) models.Company {
	t.Helper()
	co := models.Company{RUC: ruc, BusinessName: "PaymentVoiding Test " + ruc, Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

func seedPVDocument(t *testing.T, db *gorm.DB, companyID uint, total, balance float64, status string, tsID *uint) models.Document {
	t.Helper()
	d := models.Document{
		CompanyID: companyID, Source: "manual", Type: "FACTURA", Number: "F-PV",
		IssueDate: time.Now(), TotalAmount: total, BalanceAmount: balance, Status: status,
		TaxSettlementID: tsID,
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatalf("document: %v", err)
	}
	return d
}

func seedPVPayment(t *testing.T, db *gorm.DB, companyID uint, amount float64, tsID *uint) models.Payment {
	t.Helper()
	p := models.Payment{
		CompanyID: companyID, Amount: amount, Type: "applied", Date: time.Now(),
		Method: "efectivo", TaxSettlementID: tsID,
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("payment: %v", err)
	}
	return p
}

func seedPVAllocation(t *testing.T, db *gorm.DB, paymentID, documentID uint, amount float64) {
	t.Helper()
	a := models.PaymentAllocation{PaymentID: paymentID, DocumentID: documentID, Amount: amount}
	if err := db.Create(&a).Error; err != nil {
		t.Fatalf("allocation: %v", err)
	}
}

func seedPVTaxSettlement(t *testing.T, db *gorm.DB, companyID uint, status string) models.TaxSettlement {
	t.Helper()
	ts := models.TaxSettlement{CompanyID: companyID, IssueDate: time.Now(), Status: status}
	if err := db.Create(&ts).Error; err != nil {
		t.Fatalf("tax settlement: %v", err)
	}
	return ts
}

func seedPVReceipt(t *testing.T, db *gorm.DB, companyID, paymentID uint, externalID string) models.TukifacFiscalReceipt {
	t.Helper()
	r := models.TukifacFiscalReceipt{
		ExternalID: externalID, CompanyID: companyID, DocumentTypeID: "03", Number: externalID,
		Total: 1, ReconciliationStatus: models.TukifacReceiptLinked, Origin: models.TukifacReceiptOriginPOS,
		LinkedPaymentID: &paymentID,
	}
	if err := db.Create(&r).Error; err != nil {
		t.Fatalf("receipt: %v", err)
	}
	return r
}

// --- Item 1: cancelación manual simple -----------------------------------------------------------------

func TestDeletePaymentTx_VoidPayment_AuditFieldsAndRevertsEverything(t *testing.T) {
	db := setupPaymentVoidingTestDB(t)
	co := seedPVCompany(t, db, "20940000001")
	doc := seedPVDocument(t, db, co.ID, 1000, 600, debtsvc.StatusPartial, nil)
	pay := seedPVPayment(t, db, co.ID, 400, nil)
	seedPVAllocation(t, db, pay.ID, doc.ID, 400)
	rec := seedPVReceipt(t, db, co.ID, pay.ID, "ext-1")

	svc := NewPaymentService()
	if err := svc.Delete(pay.ID, "pago duplicado", 7); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	var got models.Payment
	if err := db.Unscoped().First(&got, pay.ID).Error; err != nil {
		t.Fatalf("reload payment: %v", err)
	}
	if got.VoidedAt == nil {
		t.Fatal("VoidedAt no debía quedar nil")
	}
	if got.VoidedBy == nil || *got.VoidedBy != 7 {
		t.Fatalf("VoidedBy=%v, want 7", got.VoidedBy)
	}
	if got.VoidReason != "pago duplicado" {
		t.Fatalf("VoidReason=%q, want %q", got.VoidReason, "pago duplicado")
	}
	if !got.DeletedAt.Valid {
		t.Fatal("DeletedAt debía seguir fijándose (soft-delete preexistente sin cambios)")
	}

	var allocCount int64
	db.Model(&models.PaymentAllocation{}).Where("payment_id = ?", pay.ID).Count(&allocCount)
	if allocCount != 0 {
		t.Fatalf("la allocation debía revertirse, got %d", allocCount)
	}

	var gotDoc models.Document
	db.First(&gotDoc, doc.ID)
	if gotDoc.BalanceAmount != 1000 {
		t.Fatalf("Document.BalanceAmount=%v, want 1000 tras revertir el pago", gotDoc.BalanceAmount)
	}

	var gotRec models.TukifacFiscalReceipt
	db.First(&gotRec, rec.ID)
	if gotRec.LinkedPaymentID != nil {
		t.Fatal("el comprobante debía desvincularse (LinkedPaymentID=nil)")
	}
	if gotRec.ReconciliationStatus != models.TukifacReceiptPending {
		t.Fatalf("ReconciliationStatus=%s, want pendiente_vincular", gotRec.ReconciliationStatus)
	}
}

// --- Item 2: motivo vacío rechazado --------------------------------------------------------------------

func TestDeletePaymentTx_EmptyReason_Rejected(t *testing.T) {
	db := setupPaymentVoidingTestDB(t)
	co := seedPVCompany(t, db, "20940000002")
	pay := seedPVPayment(t, db, co.ID, 100, nil)

	svc := NewPaymentService()
	if err := svc.Delete(pay.ID, "   ", 1); err == nil {
		t.Fatal("un motivo vacío/blanco debía rechazarse")
	}

	var got models.Payment
	db.First(&got, pay.ID)
	if got.VoidedAt != nil {
		t.Fatal("nada debía modificarse tras el rechazo")
	}
}

// --- Item 3: reversión del vínculo deuda<->liquidación (un solo pago) ---------------------------------

func TestDeletePaymentTx_RevertsSettlementLink_SinglePayment(t *testing.T) {
	db := setupPaymentVoidingTestDB(t)
	co := seedPVCompany(t, db, "20940000003")
	ts := seedPVTaxSettlement(t, db, co.ID, models.TaxSettlementStatusIssued)
	tsID := ts.ID
	doc := seedPVDocument(t, db, co.ID, 500, 0, debtsvc.StatusPaid, &tsID)
	pay := seedPVPayment(t, db, co.ID, 500, &tsID)
	seedPVAllocation(t, db, pay.ID, doc.ID, 500)

	svc := NewPaymentService()
	if err := svc.Delete(pay.ID, "revertir", 1); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	var gotDoc models.Document
	db.First(&gotDoc, doc.ID)
	if gotDoc.TaxSettlementID != nil {
		t.Fatalf("Document.TaxSettlementID debía quedar nil, got %v", *gotDoc.TaxSettlementID)
	}
}

// --- Item 4: NO se revierte si otro pago activo sigue sosteniendo el vínculo --------------------------

func TestDeletePaymentTx_KeepsSettlementLink_WhenOtherActivePaymentSustainsIt(t *testing.T) {
	db := setupPaymentVoidingTestDB(t)
	co := seedPVCompany(t, db, "20940000004")
	ts := seedPVTaxSettlement(t, db, co.ID, models.TaxSettlementStatusIssued)
	tsID := ts.ID
	doc := seedPVDocument(t, db, co.ID, 1000, 400, debtsvc.StatusPartial, &tsID)
	pay1 := seedPVPayment(t, db, co.ID, 600, &tsID)
	seedPVAllocation(t, db, pay1.ID, doc.ID, 600)
	pay2 := seedPVPayment(t, db, co.ID, 400, &tsID)
	seedPVAllocation(t, db, pay2.ID, doc.ID, 400)

	svc := NewPaymentService()
	if err := svc.Delete(pay1.ID, "revertir parcial", 1); err != nil {
		t.Fatalf("Delete pay1: %v", err)
	}

	var gotDoc models.Document
	db.First(&gotDoc, doc.ID)
	if gotDoc.TaxSettlementID == nil || *gotDoc.TaxSettlementID != tsID {
		t.Fatal("el vínculo NO debía revertirse: pay2 sigue activo sosteniéndolo")
	}

	// Anular también pay2 -> ahora sí debe liberarse.
	if err := svc.Delete(pay2.ID, "revertir el resto", 1); err != nil {
		t.Fatalf("Delete pay2: %v", err)
	}
	db.First(&gotDoc, doc.ID)
	if gotDoc.TaxSettlementID != nil {
		t.Fatal("tras anular ambos pagos, el vínculo sí debía revertirse")
	}
}

// --- Item 5: cascada TaxSettlementService.Delete -------------------------------------------------------

func TestTaxSettlementService_Delete_VoidsLinkedPayments_WithSyntheticReason(t *testing.T) {
	db := setupPaymentVoidingTestDB(t)
	co := seedPVCompany(t, db, "20940000005")
	ts := seedPVTaxSettlement(t, db, co.ID, models.TaxSettlementStatusIssued)
	tsID := ts.ID
	doc := seedPVDocument(t, db, co.ID, 500, 0, debtsvc.StatusPaid, &tsID)
	pay := seedPVPayment(t, db, co.ID, 500, &tsID)
	seedPVAllocation(t, db, pay.ID, doc.ID, 500)

	svc := NewTaxSettlementService()
	voided, err := svc.Delete(ts.ID, 9)
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if len(voided) != 1 || voided[0].ID != pay.ID || voided[0].Amount != 500 {
		t.Fatalf("voided=%+v, want [{ID:%d Amount:500}]", voided, pay.ID)
	}

	var gotPay models.Payment
	if err := db.Unscoped().First(&gotPay, pay.ID).Error; err != nil {
		t.Fatalf("reload payment: %v", err)
	}
	if gotPay.VoidedAt == nil {
		t.Fatal("el pago debía quedar anulado por la cascada")
	}
	if gotPay.VoidedBy == nil || *gotPay.VoidedBy != 9 {
		t.Fatalf("VoidedBy=%v, want 9", gotPay.VoidedBy)
	}
	wantReason := "Liquidación #" + strconv.FormatUint(uint64(ts.ID), 10) + " eliminada"
	if gotPay.VoidReason != wantReason {
		t.Fatalf("VoidReason=%q, want %q", gotPay.VoidReason, wantReason)
	}
}

// --- Item 6: cascada RevertToDraft ----------------------------------------------------------------------

func TestTaxSettlementService_RevertToDraft_VoidsLinkedPayments(t *testing.T) {
	db := setupPaymentVoidingTestDB(t)
	co := seedPVCompany(t, db, "20940000006")
	ts := seedPVTaxSettlement(t, db, co.ID, models.TaxSettlementStatusIssued)
	tsID := ts.ID
	doc := seedPVDocument(t, db, co.ID, 300, 0, debtsvc.StatusPaid, &tsID)
	pay := seedPVPayment(t, db, co.ID, 300, &tsID)
	seedPVAllocation(t, db, pay.ID, doc.ID, 300)

	svc := NewTaxSettlementService()
	got, voided, err := svc.RevertToDraft(ts.ID, 3)
	if err != nil {
		t.Fatalf("RevertToDraft: %v", err)
	}
	if got.Status != models.TaxSettlementStatusDraft {
		t.Fatalf("Status=%s, want borrador", got.Status)
	}
	if len(voided) != 1 || voided[0].ID != pay.ID || voided[0].Amount != 300 {
		t.Fatalf("voided=%+v, want [{ID:%d Amount:300}]", voided, pay.ID)
	}

	var gotPay models.Payment
	db.Unscoped().First(&gotPay, pay.ID)
	if gotPay.VoidedAt == nil || gotPay.VoidedBy == nil || *gotPay.VoidedBy != 3 {
		t.Fatal("el pago debía quedar anulado con actor=3 por la cascada de RevertToDraft")
	}
}

// --- Item 8: idempotencia — segunda anulación devuelve ErrPaymentAlreadyVoided -------------------------

func TestDeletePaymentTx_Idempotent_SecondCallReturnsAlreadyVoided(t *testing.T) {
	db := setupPaymentVoidingTestDB(t)
	co := seedPVCompany(t, db, "20940000008")
	pay := seedPVPayment(t, db, co.ID, 100, nil)

	svc := NewPaymentService()
	if err := svc.Delete(pay.ID, "primera vez", 1); err != nil {
		t.Fatalf("primera anulación: %v", err)
	}
	var afterFirst models.Payment
	db.Unscoped().First(&afterFirst, pay.ID)

	err := svc.Delete(pay.ID, "segunda vez", 2)
	if err == nil {
		t.Fatal("la segunda anulación debía devolver ErrPaymentAlreadyVoided")
	}
	if !isErrPaymentAlreadyVoided(err) {
		t.Fatalf("error inesperado: %v, want ErrPaymentAlreadyVoided", err)
	}

	var afterSecond models.Payment
	db.Unscoped().First(&afterSecond, pay.ID)
	if !afterFirst.VoidedAt.Equal(*afterSecond.VoidedAt) {
		t.Fatal("VoidedAt no debía cambiar en el segundo intento (sin efectos repetidos)")
	}
	if afterSecond.VoidReason != "primera vez" {
		t.Fatalf("VoidReason cambió a %q, no debía repetirse ningún efecto", afterSecond.VoidReason)
	}
}

func isErrPaymentAlreadyVoided(err error) bool {
	return errors.Is(err, ErrPaymentAlreadyVoided)
}

// --- Item 9: concurrencia — dos anulaciones simultáneas del mismo pago, solo una tiene efecto ----------

func TestDeletePaymentTx_Concurrent_OnlyOneVoidTakesEffect(t *testing.T) {
	db := setupPaymentVoidingTestDB(t)
	co := seedPVCompany(t, db, "20940000009")
	pay := seedPVPayment(t, db, co.ID, 100, nil)

	svc := NewPaymentService()
	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); <-start; errs[0] = svc.Delete(pay.ID, "concurrente A", 1) }()
	go func() { defer wg.Done(); <-start; errs[1] = svc.Delete(pay.ID, "concurrente B", 2) }()
	close(start)
	wg.Wait()

	successes, alreadyVoided := 0, 0
	for _, e := range errs {
		switch {
		case e == nil:
			successes++
		case isErrPaymentAlreadyVoided(e):
			alreadyVoided++
		default:
			t.Fatalf("error inesperado en anulación concurrente: %v", e)
		}
	}
	if successes != 1 || alreadyVoided != 1 {
		t.Fatalf("esperaba exactamente 1 éxito y 1 ErrPaymentAlreadyVoided, got %d éxitos y %d already-voided", successes, alreadyVoided)
	}

	var got models.Payment
	db.Unscoped().First(&got, pay.ID)
	if got.VoidedAt == nil {
		t.Fatal("el pago debía terminar anulado")
	}
}
