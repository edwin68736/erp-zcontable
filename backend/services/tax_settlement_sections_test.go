package services

import "testing"

func TestComputeImpuestoPeriodoNegativeCeil(t *testing.T) {
	// 180 - 90 - 52.50 - 144 = -106.50 → -107
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled:      true,
			VentasNetas:  TaxIGVRow{Impuesto: 180},
			NotasCredito: TaxIGVRow{Impuesto: 90},
			Compras105:   TaxIGVRow{Impuesto: 52.50},
			Compras18:    TaxIGVRow{Impuesto: 144},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt621.ImpuestoPeriodo != -107 {
		t.Fatalf("impuesto_periodo=%v want -107", out.Pdt621.ImpuestoPeriodo)
	}
}

func TestComputeImpuestoPeriodoCeilFloat(t *testing.T) {
	if got := roundImpuestoPeriodo(106.499999999999); got != 107 {
		t.Fatalf("impuesto_periodo float=%v want 107", got)
	}
	if got := roundImpuestoPeriodo(-106.50); got != -107 {
		t.Fatalf("impuesto_periodo negative=%v want -107", got)
	}
}

func TestComputeImpuestoPeriodoCeil(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled:    true,
			VentasNetas: TaxIGVRow{Impuesto: 106.50},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt621.ImpuestoPeriodo != 107 {
		t.Fatalf("impuesto_periodo=%v want 107 (ceil)", out.Pdt621.ImpuestoPeriodo)
	}
}

func TestComputePdt621FromExample(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Version: 1,
		Pdt621: &TaxSectionPdt621{
			Enabled: true,
			VentasNetas: TaxIGVRow{Base: 1000, NoGravadas: 100, Impuesto: 180},
			NotasCredito: TaxIGVRow{Base: 500, NoGravadas: 100, Impuesto: 90},
			Compras105: TaxIGVRow{Base: 500, Impuesto: 75},
			Compras18: TaxIGVRow{Base: 800, Impuesto: 144},
			CreditoPeriodoAnt: 50,
			RentaVentasBase: 500,
			RentaVentasImpuesto: 5,
			RentaSaldoFavorItan: 1,
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt621.ImpuestoPeriodo != -129 {
		t.Fatalf("impuesto_periodo=%v want -129", out.Pdt621.ImpuestoPeriodo)
	}
	if out.Pdt621.SaldoFavor != -179 {
		t.Fatalf("saldo_favor=%v want -179", out.Pdt621.SaldoFavor)
	}
	if out.Pdt621.RentaImpuestoPagar != 4 {
		t.Fatalf("renta_impuesto=%v want 4", out.Pdt621.RentaImpuestoPagar)
	}
	if out.Pdt621.ImpuestoAPagar != 4 {
		t.Fatalf("pdt621 impuesto_a_pagar=%v want 4", out.Pdt621.ImpuestoAPagar)
	}
}

func TestComputeGrandTotalAllSections(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{Enabled: true, RentaVentasImpuesto: 4},
		Pdt601: &TaxSectionPdt601{Enabled: true, Essalud: 102, Onp: 130, Afp: 80, Rta4ta: 50, Rta5ta: 30},
		Itan:   &TaxSectionItan{Enabled: true, Year: 2026, CuotaNro: 1, Impuesto: 105},
	}
	out := ComputeTaxSettlementSections(p)
	want := 4.0 + 392.0 + 105.0
	if out.GrandTotalImpuesto != want {
		t.Fatalf("grand=%v want %v", out.GrandTotalImpuesto, want)
	}
}
