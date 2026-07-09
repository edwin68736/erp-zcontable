package debt_test

import (
	"testing"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"
)

func TestParseYYYYMM(t *testing.T) {
	mo, yr, ok := debtsvc.ParseYYYYMM("2026-03")
	if !ok || mo != 3 || yr != 2026 {
		t.Fatalf("parse failed: ok=%v mo=%d yr=%d", ok, mo, yr)
	}
	_, _, bad := debtsvc.ParseYYYYMM("03-2026")
	if bad {
		t.Fatal("expected invalid format")
	}
}

func TestComputeStatusFromAmounts(t *testing.T) {
	if s := debtsvc.ComputeStatusFromAmounts(100, 100, ""); s != debtsvc.StatusPending {
		t.Fatalf("pending got %s", s)
	}
	if s := debtsvc.ComputeStatusFromAmounts(100, 50, ""); s != debtsvc.StatusPartial {
		t.Fatalf("partial got %s", s)
	}
	if s := debtsvc.ComputeStatusFromAmounts(100, 0, ""); s != debtsvc.StatusPaid {
		t.Fatalf("paid got %s", s)
	}
	if s := debtsvc.ComputeStatusFromAmounts(100, 0, debtsvc.StatusCancelled); s != debtsvc.StatusCancelled {
		t.Fatalf("cancelled got %s", s)
	}
}

func TestBalanceFromTotalPaid(t *testing.T) {
	if b := debtsvc.BalanceFromTotalPaid(100, 30); b != 70 {
		t.Fatalf("balance=%v", b)
	}
	if b := debtsvc.BalanceFromTotalPaid(100, 100); b != 0 {
		t.Fatalf("balance=%v", b)
	}
	if b := debtsvc.BalanceFromTotalPaid(100, 110); b != 0 {
		t.Fatalf("overpay balance=%v", b)
	}
}

func TestParseDEULIQNumber(t *testing.T) {
	sid, ok := debtsvc.ParseDEULIQNumber("DEU-LIQ-42-7")
	if !ok || sid != 42 {
		t.Fatalf("sid=%d ok=%v", sid, ok)
	}
	_, ok = debtsvc.ParseDEULIQNumber("DEU-001")
	if ok {
		t.Fatal("expected false")
	}
}

func TestApplyPeriodFromString(t *testing.T) {
	var d models.Document
	if !debtsvc.ApplyPeriodFromString(&d, "2025-11") {
		t.Fatal("expected parse")
	}
	if !d.HasPeriod || d.PeriodMonth == nil || *d.PeriodMonth != 11 {
		t.Fatalf("period=%+v", d)
	}
}

func TestInitBalanceOnCreate(t *testing.T) {
	svc := debtsvc.NewService()
	doc := &models.Document{TotalAmount: 150.5}
	svc.InitBalanceOnCreate(doc)
	if doc.BalanceAmount != 150.5 {
		t.Fatalf("balance=%v", doc.BalanceAmount)
	}
	if doc.Status != debtsvc.StatusPending {
		t.Fatalf("status=%s", doc.Status)
	}
}

func TestIsLegacySettlementClone(t *testing.T) {
	d := &models.Document{Source: "liquidacion", Number: "DEU-LIQ-1-2"}
	if !debtsvc.IsLegacySettlementClone(d) {
		t.Fatal("expected legacy clone")
	}
	d.Number = "000123"
	if debtsvc.IsLegacySettlementClone(d) {
		t.Fatal("expected not legacy")
	}
}

func TestSanitizeDocumentDescription(t *testing.T) {
	got := debtsvc.SanitizeDocumentDescription("Honorarios enero [legacy_promoted→canónico]")
	if got != "Honorarios enero" {
		t.Fatalf("sanitize=%q", got)
	}
	got = debtsvc.SanitizeDocumentDescription(
		"ASESORÍA CONTABLE [legacy_merged→DEU-LIQ-32-57 id=57], ASESORÍA CONTABLE [legacy_merged→DEU-LIQ-32-57 id=57], ASESORÍA CONTABLE [legacy_promoted→canónico]",
	)
	if got != "ASESORÍA CONTABLE" {
		t.Fatalf("dedupe sanitize=%q", got)
	}
}
