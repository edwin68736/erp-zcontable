package services

import (
	"testing"

	"miappfiber/models"
)

func TestBuildLinesFromDocumentAllocation_partialItemLabel(t *testing.T) {
	doc := &models.Document{
		TotalAmount:      200,
		AccountingPeriod: "2026-05",
		Items: []models.DocumentItem{
			{SortOrder: 0, Description: "Honorarios contables", Amount: 150},
			{SortOrder: 1, Description: "IGV manual", Amount: 50},
		},
	}

	lines := buildLinesFromDocumentAllocation(doc, 80, 0, nil, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	want := "Honorarios contables — 05/2026 (parcial)"
	if lines[0].Description != want {
		t.Fatalf("description = %q, want %q", lines[0].Description, want)
	}
	if lines[0].LineTotal != 80 {
		t.Fatalf("line total = %v, want 80", lines[0].LineTotal)
	}
}

func TestBuildLinesFromDocumentAllocation_fullItemNoPartialLabel(t *testing.T) {
	doc := &models.Document{
		TotalAmount:      150,
		AccountingPeriod: "2026-05",
		Items: []models.DocumentItem{
			{SortOrder: 0, Description: "Plan mensual", Amount: 150},
		},
	}

	lines := buildLinesFromDocumentAllocation(doc, 150, 0, nil, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	want := "Plan mensual — 05/2026"
	if lines[0].Description != want {
		t.Fatalf("description = %q, want %q", lines[0].Description, want)
	}
}

func TestBuildLinesFromDocumentAllocation_secondPartialAfterPriorPayment(t *testing.T) {
	doc := &models.Document{
		TotalAmount:      150,
		AccountingPeriod: "2026-05",
		Items: []models.DocumentItem{
			{SortOrder: 0, Description: "Servicio SUNAT", Amount: 150},
		},
	}

	lines := buildLinesFromDocumentAllocation(doc, 30, 100, nil, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	want := "Servicio SUNAT — 05/2026 (parcial)"
	if lines[0].Description != want {
		t.Fatalf("description = %q, want %q", lines[0].Description, want)
	}
}

func TestBuildLinesFromDocumentAllocation_completesRemainingItemNoPartial(t *testing.T) {
	doc := &models.Document{
		TotalAmount:      150,
		AccountingPeriod: "2026-05",
		Items: []models.DocumentItem{
			{SortOrder: 0, Description: "Servicio SUNAT", Amount: 150},
		},
	}

	lines := buildLinesFromDocumentAllocation(doc, 50, 100, nil, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	want := "Servicio SUNAT — 05/2026"
	if lines[0].Description != want {
		t.Fatalf("description = %q, want %q", lines[0].Description, want)
	}
}

func TestBuildLinesFromDocumentAllocation_ignoresPaymentHeaderUsesDocDescription(t *testing.T) {
	doc := &models.Document{
		TotalAmount:      350,
		AccountingPeriod: "2025-11",
		Description:      "Declaración mensual",
	}

	lines := buildLinesFromDocumentAllocation(doc, 350, 0, nil, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	want := "Declaración mensual — 11/2025"
	if lines[0].Description != want {
		t.Fatalf("description = %q, want %q", lines[0].Description, want)
	}
}

func TestBuildFiscalLinesFromSettlementAllocation_usesLineConcept(t *testing.T) {
	doc := &models.Document{TotalAmount: 350, Description: "Declaración mensual"}
	sl := &models.TaxSettlementLine{
		Concept:  "Declaración mensual",
		PeriodYM: "2025-11",
		Amount:   350,
	}

	lines := buildFiscalLinesFromSettlementAllocation(doc, 350, 0, sl, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	want := "Declaración mensual — 2025-11"
	if lines[0].Description != want {
		t.Fatalf("description = %q, want %q", lines[0].Description, want)
	}
}

func TestDebtPaymentContextJSONRoundtrip(t *testing.T) {
	src := &models.DebtPaymentContext{
		IsPartialPayment:  true,
		StatusLabel:       "PAGO PARCIAL",
		PaidConceptLabel:  "Servicio — 2026-04 (parcial)",
		PaidConcepts:      []string{"Servicio — 2026-04 (parcial)"},
		DebtTotal:         200,
		PaidThisOperation: 50,
		PaidAccumulated:   50,
		BalancePending:    150,
	}
	raw, err := debtPaymentContextToJSON(src)
	if err != nil {
		t.Fatal(err)
	}
	got, err := debtPaymentContextFromJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || !got.IsPartialPayment || got.BalancePending != 150 {
		t.Fatalf("unexpected %#v", got)
	}
}

func TestBuildDebtPaymentContextFromStoredLines_keepsPartialFromFrozenLines(t *testing.T) {
	rec := &models.TukifacFiscalReceipt{
		Total: 2000,
		Lines: []models.FiscalReceiptLine{
			{Description: "Plan — 2026-01", LineTotal: 350},
			{Description: "Servicio — 2026-04 (parcial)", LineTotal: 50},
		},
	}
	ctx := buildDebtPaymentContextFromStoredLines(rec)
	if ctx == nil || !ctx.IsPartialPayment {
		t.Fatalf("expected partial context, got %#v", ctx)
	}
	if len(ctx.PaidConcepts) != 1 || ctx.PaidConcepts[0] != "Servicio — 2026-04 (parcial)" {
		t.Fatalf("concepts = %#v", ctx.PaidConcepts)
	}
}

func TestPartialPaidConceptsFromFiscalLines(t *testing.T) {
	lines := []models.FiscalReceiptLine{
		{Description: "Plan mensual — 2026-01"},
		{Description: "Servicio SUNAT — 2026-04 (parcial)"},
		{Description: "IGV — 2025-12"},
	}
	got := partialPaidConceptsFromFiscalLines(lines)
	if len(got) != 1 || got[0] != "Servicio SUNAT — 2026-04 (parcial)" {
		t.Fatalf("partial concepts = %#v", got)
	}
}

func TestPartialPaidConceptsFromFiscalLines_noneWhenAllFull(t *testing.T) {
	lines := []models.FiscalReceiptLine{
		{Description: "Plan mensual — 2026-01"},
		{Description: "IGV — 2025-12"},
	}
	if got := partialPaidConceptsFromFiscalLines(lines); len(got) != 0 {
		t.Fatalf("expected no partial concepts, got %#v", got)
	}
}
func TestBuildLinesFromPaymentAllocations_settlementNotPaymentHeader(t *testing.T) {
	docID := uint(10)
	pay := &models.Payment{
		Description: "Liquidación LI-202604",
		TaxSettlement: &models.TaxSettlement{
			Lines: []models.TaxSettlementLine{
				{
					DocumentID: &docID,
					Concept:    "Honorarios profesionales",
					PeriodYM:   "2026-04",
					Amount:     50,
				},
			},
		},
		Allocations: []models.PaymentAllocation{
			{
				DocumentID: docID,
				Amount:     50,
				Document: &models.Document{
					ID:               docID,
					TotalAmount:      200,
					Description:      "Honorarios profesionales",
					AccountingPeriod: "2026-04",
				},
			},
		},
	}

	// DocumentPaidTotal hits DB — mock by testing build path via settlement allocation directly in prior test.
	// Here verify settlement line path is chosen (no items on doc).
	if len(sortedDocumentItems(pay.Allocations[0].Document)) != 0 {
		t.Fatal("doc should have no items")
	}
	sl := pay.TaxSettlement.Lines[0]
	lines := buildFiscalLinesFromSettlementAllocation(pay.Allocations[0].Document, 50, 150, &sl, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	want := "Honorarios profesionales — 2026-04"
	if lines[0].Description != want {
		t.Fatalf("description = %q, want %q", lines[0].Description, want)
	}
}

func TestBuildFiscalLinesFromSettlementAllocation_partial(t *testing.T) {
	doc := &models.Document{TotalAmount: 200, Description: "Honorarios profesionales"}
	sl := &models.TaxSettlementLine{Concept: "Honorarios profesionales", PeriodYM: "2026-04", Amount: 200}

	lines := buildFiscalLinesFromSettlementAllocation(doc, 50, 0, sl, 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	want := "Honorarios profesionales — 2026-04 (parcial)"
	if lines[0].Description != want {
		t.Fatalf("description = %q, want %q", lines[0].Description, want)
	}
}
