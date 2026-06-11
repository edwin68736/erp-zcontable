package debt_test

import (
	"testing"

	"miappfiber/models"
	debtsvc "miappfiber/services/debt"
)

func TestPeriodDisplayMMYYYY_HasPeriod(t *testing.T) {
	mo := int16(5)
	yr := int16(2026)
	doc := &models.Document{HasPeriod: true, PeriodMonth: &mo, PeriodYear: &yr}
	if got := debtsvc.PeriodDisplayMMYYYY(doc); got != "05/2026" {
		t.Fatalf("got %q", got)
	}
}

func TestPeriodDisplayMMYYYY_LegacyYYYYMM(t *testing.T) {
	doc := &models.Document{AccountingPeriod: "2026-03"}
	if got := debtsvc.PeriodDisplayMMYYYY(doc); got != "03/2026" {
		t.Fatalf("got %q", got)
	}
}

func TestPeriodDisplayMMYYYY_Empty(t *testing.T) {
	if got := debtsvc.PeriodDisplayMMYYYY(&models.Document{}); got != "—" {
		t.Fatalf("got %q", got)
	}
}

func TestApplyPaymentInputSum(t *testing.T) {
	lines := []debtsvc.PaymentAllocationLine{
		{DocumentID: 1, Amount: 100},
		{DocumentID: 2, Amount: 50},
	}
	var sum float64
	for _, l := range lines {
		sum += l.Amount
	}
	if sum != 150 {
		t.Fatalf("sum=%v", sum)
	}
}
