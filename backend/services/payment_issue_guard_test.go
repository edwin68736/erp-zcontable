package services

// Reglas de pagos y comprobantes definidas tras la auditoría de pagos y liquidaciones (2026-11-11):
//   - todo pago de Finanzas nace con propósito (deuda por defecto);
//   - un pago solo puede tener un comprobante vigente (emitirlo dos veces duplicaría la facturación);
//   - un pago libre (sin liquidación) también puede emitir su comprobante, después de creado.

import (
	"errors"
	"testing"

	"miappfiber/database"
	"miappfiber/models"
)

func TestCreateFromParams_SinPropositoNaceComoDeuda(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000010")
	doc := seedPWCDocument(t, db, co.ID, "10", 200)
	svc := NewPaymentService()

	aplicado, err := svc.CreateFromParams(&PaymentCreateParams{CompanyID: co.ID, Amount: 200, Type: "applied", DocumentID: &doc.ID})
	if err != nil {
		t.Fatalf("pago aplicado: %v", err)
	}
	aCuenta, err := svc.CreateFromParams(&PaymentCreateParams{CompanyID: co.ID, Amount: 50, Type: "on_account"})
	if err != nil {
		t.Fatalf("pago a cuenta: %v", err)
	}
	for name, id := range map[string]uint{"aplicado": aplicado, "a cuenta": aCuenta} {
		var p models.Payment
		if err := database.DB.First(&p, id).Error; err != nil {
			t.Fatalf("recargar %s: %v", name, err)
		}
		if p.Purpose == nil || *p.Purpose != models.PaymentPurposeDebt {
			t.Fatalf("pago %s: purpose=%v, want deuda", name, p.Purpose)
		}
	}
}

func TestCreateFromParams_PropositoExplicitoSeRespeta(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000011")
	svc := NewPaymentService()
	id, err := svc.CreateFromParams(&PaymentCreateParams{CompanyID: co.ID, Amount: 80, Type: "on_account", Purpose: pwcStrPtr(models.PaymentPurposeService)})
	if err != nil {
		t.Fatalf("CreateFromParams: %v", err)
	}
	var p models.Payment
	database.DB.First(&p, id)
	if p.Purpose == nil || *p.Purpose != models.PaymentPurposeService {
		t.Fatalf("purpose=%v, want servicio (no se debe pisar lo explícito)", p.Purpose)
	}
}

// Un pago libre (sin liquidación) puede emitir su comprobante, y solo una vez.
func TestIssueComprobanteFromPayment_PagoLibre_UnaSolaVez(t *testing.T) {
	db := setupPaymentComprobanteTestDB(t)
	co := seedPWCCompany(t, db, "20990000012")
	doc := seedPWCDocument(t, db, co.ID, "12", 200)
	ser := seedPWCSeries(t, db, "03", "B777")
	pay := NewPaymentService()
	issue := NewFiscalReceiptIssueService()

	id, err := pay.CreateFromParams(&PaymentCreateParams{CompanyID: co.ID, Amount: 200, Type: "applied", DocumentID: &doc.ID})
	if err != nil {
		t.Fatalf("crear pago libre: %v", err)
	}
	in := PaymentComprobanteIssueInput{Kind: "boleta", SeriesID: ser.ID}

	rec, err := issue.IssueComprobanteFromPayment(id, in)
	if err != nil {
		t.Fatalf("primera emisión: %v", err)
	}
	if rec == nil || rec.LinkedPaymentID == nil || *rec.LinkedPaymentID != id {
		t.Fatalf("el comprobante debía quedar vinculado al pago: %+v", rec)
	}
	var p models.Payment
	database.DB.First(&p, id)
	if p.FiscalStatus != "linked" {
		t.Fatalf("fiscal_status=%q, want linked", p.FiscalStatus)
	}

	// Segunda emisión: rechazada y sin gastar otro correlativo.
	var antes models.FiscalDocumentSeries
	database.DB.First(&antes, ser.ID)
	if _, err := issue.IssueComprobanteFromPayment(id, in); !errors.Is(err, ErrPaymentAlreadyHasReceipt) {
		t.Fatalf("segunda emisión: err=%v, want ErrPaymentAlreadyHasReceipt", err)
	}
	var despues models.FiscalDocumentSeries
	database.DB.First(&despues, ser.ID)
	if despues.CurrentNumber != antes.CurrentNumber {
		t.Fatalf("la emisión rechazada no debe consumir correlativo: %d -> %d", antes.CurrentNumber, despues.CurrentNumber)
	}
	var n int64
	database.DB.Model(&models.TukifacFiscalReceipt{}).Where("linked_payment_id = ?", id).Count(&n)
	if n != 1 {
		t.Fatalf("comprobantes vinculados al pago = %d, want 1", n)
	}
}
