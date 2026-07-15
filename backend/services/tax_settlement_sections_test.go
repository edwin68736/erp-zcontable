package services

import "testing"

func TestComputeImpuestoPeriodoRoundsNearestDown(t *testing.T) {
	// 3784.11 → 3784 (mismo método que el resto de totales: al entero más cercano, no al techo).
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled:     true,
			VentasNetas: TaxIGVRow{Impuesto: 3784.11},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt621.ImpuestoPeriodo != 3784 {
		t.Fatalf("impuesto_periodo=%v want 3784", out.Pdt621.ImpuestoPeriodo)
	}
}

func TestComputeImpuestoPeriodoRoundsHalfUp(t *testing.T) {
	// 106.50 → 107 (half-up).
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled:     true,
			VentasNetas: TaxIGVRow{Impuesto: 106.50},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt621.ImpuestoPeriodo != 107 {
		t.Fatalf("impuesto_periodo=%v want 107", out.Pdt621.ImpuestoPeriodo)
	}
}

func TestComputeImpuestoPeriodoNegative(t *testing.T) {
	// 180 - 90 - 52.40 - 144 = -106.40 → -106 (al más cercano).
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled:      true,
			VentasNetas:  TaxIGVRow{Impuesto: 180},
			NotasCredito: TaxIGVRow{Impuesto: 90},
			Compras105:   TaxIGVRow{Impuesto: 52.40},
			Compras18:    TaxIGVRow{Impuesto: 144},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt621.ImpuestoPeriodo != -106 {
		t.Fatalf("impuesto_periodo=%v want -106", out.Pdt621.ImpuestoPeriodo)
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
	if out.Pdt621.RentaImpuestoPagar != 7 {
		t.Fatalf("renta_impuesto=%v want 7", out.Pdt621.RentaImpuestoPagar)
	}
	if out.Pdt621.ImpuestoAPagar != 7 {
		t.Fatalf("pdt621 impuesto_a_pagar=%v want 7", out.Pdt621.ImpuestoAPagar)
	}
}

func TestComputeGrandTotalAllSections(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{Enabled: true, VentasNetas: TaxIGVRow{Impuesto: 4}},
		Pdt601: &TaxSectionPdt601{Enabled: true, Essalud: 102, Onp: 130, Afp: 80, Rta4ta: 50, Rta5ta: 30},
		Itan:   &TaxSectionItan{Enabled: true, Year: 2026, CuotaNro: 1, Impuesto: 105},
	}
	out := ComputeTaxSettlementSections(p)
	want := 4.0 + 392.0 + 105.0
	if out.GrandTotalImpuesto != want {
		t.Fatalf("grand=%v want %v", out.GrandTotalImpuesto, want)
	}
}

func TestComputePdt621DetractionPartial(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled: true,
			VentasNetas: TaxIGVRow{
				Impuesto: 100,
			},
			DetractionPaymentIGV: &TaxDetractionPayment{
				Enabled: true,
				Mode:    "parcial",
				Amount:  50,
			},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt621.ImpuestoAPagar != 50 {
		t.Fatalf("pdt621 impuesto_a_pagar=%v want 50", out.Pdt621.ImpuestoAPagar)
	}
	if out.Pdt621.DetractionPaymentIGV == nil || out.Pdt621.DetractionPaymentIGV.AppliedAmount != 50 {
		t.Fatalf("applied detraccion=%v want 50", out.Pdt621.DetractionPaymentIGV)
	}
}

func TestComputePdt621DetractionIgnoredForPdfOptions(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled: true,
			VentasNetas: TaxIGVRow{
				Impuesto: 100,
			},
			DetractionPaymentIGV: &TaxDetractionPayment{
				Enabled: true,
				Mode:    "total",
			},
		},
	}
	out := ComputeTaxSettlementSectionsWithOptions(p, &ComputeTaxSettlementSectionsOptions{IncludeDetraction: false})
	if out.Pdt621.ImpuestoAPagar != 100 {
		t.Fatalf("pdt621 impuesto_a_pagar=%v want 100", out.Pdt621.ImpuestoAPagar)
	}
	if out.Pdt621.DetractionPaymentIGV == nil || out.Pdt621.DetractionPaymentIGV.AppliedAmount != 0 {
		t.Fatalf("applied detraccion with pdf opts=%v want 0", out.Pdt621.DetractionPaymentIGV)
	}
}

func TestComputePdt621DetractionRentaPartial(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled: true,
			VentasNetas: TaxIGVRow{
				Base:     1000,
				Impuesto: 100,
			},
			RentaRegimen:        "coeficiente",
			RentaCoeficientePct: 10,
			DetractionPaymentRenta: &TaxDetractionPayment{
				Enabled: true,
				Mode:    "parcial",
				Amount:  30,
			},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt621.ImpuestoAPagar != 170 {
		t.Fatalf("pdt621 impuesto_a_pagar=%v want 170", out.Pdt621.ImpuestoAPagar)
	}
	if out.Pdt621.DetractionPaymentRenta == nil || out.Pdt621.DetractionPaymentRenta.AppliedAmount != 30 {
		t.Fatalf("applied detraccion renta=%v want 30", out.Pdt621.DetractionPaymentRenta)
	}
}

func TestComputePdt601DetractionIncludesAfp(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt601: &TaxSectionPdt601{
			Enabled: true,
			Essalud: 100,
			Onp:     50,
			Afp:     200,
			Rta4ta:  30,
			Rta5ta:  20,
			DetractionPayment: &TaxDetractionPayment{
				Enabled: true,
				Mode:    "total",
				Amount:  400,
			},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt601.ImpuestoAPagar != 0 {
		t.Fatalf("pdt601 impuesto_a_pagar=%v want 0 (planilla cubierta)", out.Pdt601.ImpuestoAPagar)
	}
	if out.Pdt601.DetractionPayment == nil || out.Pdt601.DetractionPayment.AppliedAmount != 400 {
		t.Fatalf("applied detraccion p601=%v want 400 (incluye AFP)", out.Pdt601.DetractionPayment)
	}
}

func TestComputePdt601DetractionIgnoredForPdfOptions(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt601: &TaxSectionPdt601{
			Enabled: true,
			Essalud: 100,
			Onp:     0,
			Afp:     50,
			DetractionPayment: &TaxDetractionPayment{
				Enabled: true,
				Mode:    "total",
			},
		},
	}
	out := ComputeTaxSettlementSectionsWithOptions(p, &ComputeTaxSettlementSectionsOptions{IncludeDetraction: false})
	if out.Pdt601.ImpuestoAPagar != 150 {
		t.Fatalf("pdt601 impuesto_a_pagar=%v want 150", out.Pdt601.ImpuestoAPagar)
	}
}

func TestComputeTaxTotalRounding(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt601: &TaxSectionPdt601{
			Enabled: true,
			Essalud: 100.55,
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt601.ImpuestoAPagar != 101 {
		t.Fatalf("pdt601 impuesto_a_pagar=%v want 101", out.Pdt601.ImpuestoAPagar)
	}
	p2 := &TaxSettlementSectionsPayload{
		Pdt601: &TaxSectionPdt601{
			Enabled: true,
			Essalud: 100.40,
		},
	}
	out2 := ComputeTaxSettlementSections(p2)
	if out2.Pdt601.ImpuestoAPagar != 100 {
		t.Fatalf("pdt601 impuesto_a_pagar=%v want 100", out2.Pdt601.ImpuestoAPagar)
	}
}

func TestComputePdt621PercepcionesRetencionesSign(t *testing.T) {
	// Impuesto a pagar (saldo >= 0): resta percepciones/retenciones.
	pPay := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled:             true,
			VentasNetas:         TaxIGVRow{Impuesto: 200},
			PercepcionesPeriodo: 30,
			RetencionesPeriodo:  20,
		},
	}
	outPay := ComputeTaxSettlementSections(pPay)
	if outPay.Pdt621.SaldoFavor != 200 {
		t.Fatalf("saldo_favor=%v want 200", outPay.Pdt621.SaldoFavor)
	}
	if outPay.Pdt621.SaldoFavorFinal != 150 {
		t.Fatalf("saldo_favor_final=%v want 150 (200-30-20)", outPay.Pdt621.SaldoFavorFinal)
	}

	// Saldo a favor (negativo): también resta percepciones/retenciones (-150 - 50 = -200).
	pFavor := &TaxSettlementSectionsPayload{
		Pdt621: &TaxSectionPdt621{
			Enabled:             true,
			VentasNetas:         TaxIGVRow{Impuesto: 50},
			Compras18:           TaxIGVRow{Impuesto: 200},
			PercepcionesPeriodo: 30,
			RetencionesPeriodo:  20,
		},
	}
	outFavor := ComputeTaxSettlementSections(pFavor)
	if outFavor.Pdt621.SaldoFavor >= 0 {
		t.Fatalf("saldo_favor=%v want negative", outFavor.Pdt621.SaldoFavor)
	}
	wantFinal := outFavor.Pdt621.SaldoFavor - 50
	if outFavor.Pdt621.SaldoFavorFinal != wantFinal {
		t.Fatalf("saldo_favor_final=%v want %v", outFavor.Pdt621.SaldoFavorFinal, wantFinal)
	}
}

func TestComputePdt601DetractionIncludesSis(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt601: &TaxSectionPdt601{
			Enabled: true,
			Essalud: 100,
			Sis:     50,
			Onp:     0,
			Afp:     80,
			DetractionPayment: &TaxDetractionPayment{
				Enabled: true,
				Mode:    "total",
				Amount:  150,
			},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt601.DetractionPayment == nil || out.Pdt601.DetractionPayment.AppliedAmount != 230 {
		t.Fatalf("applied detraccion p601=%v want 230 (essalud+sis+afp)", out.Pdt601.DetractionPayment)
	}
	if out.Pdt601.ImpuestoAPagar != 0 {
		t.Fatalf("pdt601 impuesto_a_pagar=%v want 0", out.Pdt601.ImpuestoAPagar)
	}
}

func TestComputePdt617GrossAndDetraction(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt617: &TaxSectionPdt617{
			Enabled:                true,
			RetencionIgvBase:       28913,
			RetencionIgvImpuesto:   5204,
			RetencionRentaBase:     28913,
			RetencionRentaImpuesto: 434,
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt617.ImpuestoAPagar != 5638 {
		t.Fatalf("pdt617 impuesto_a_pagar=%v want 5638", out.Pdt617.ImpuestoAPagar)
	}
	// Con detracción total, la deuda queda en 0.
	p.Pdt617.DetractionPayment = &TaxDetractionPayment{Enabled: true, Mode: "total"}
	out = ComputeTaxSettlementSections(p)
	if out.Pdt617.ImpuestoAPagar != 0 {
		t.Fatalf("pdt617 impuesto_a_pagar con detracción total=%v want 0", out.Pdt617.ImpuestoAPagar)
	}
	if out.Pdt617.DetractionPayment == nil || out.Pdt617.DetractionPayment.AppliedAmount != 5638 {
		t.Fatalf("pdt617 applied=%v want 5638", out.Pdt617.DetractionPayment)
	}
}

func TestComputeBolsasPlasticasSaldoFavor(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		BolsasPlasticas: &TaxSectionBolsasPlasticas{
			Enabled:            true,
			Impuesto:           9,
			SaldoFavorAnterior: 4,
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.BolsasPlasticas.ImpuestoAPagar != 5 {
		t.Fatalf("bolsas impuesto_a_pagar=%v want 5 (9-4)", out.BolsasPlasticas.ImpuestoAPagar)
	}
}

func TestComputePdt710PayableAndGrandTotal(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Pdt710: &TaxSectionPdt710{
			Enabled:              true,
			Year:                 2026,
			RentaAnualResultante: 1000,
			SaldoFavorAnterior:   300,
		},
		BolsasPlasticas: &TaxSectionBolsasPlasticas{Enabled: true, Impuesto: 9},
		Pdt617:          &TaxSectionPdt617{Enabled: true, RetencionIgvImpuesto: 100, RetencionRentaImpuesto: 20},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Pdt710.ImpuestoAPagar != 700 {
		t.Fatalf("pdt710 impuesto_a_pagar=%v want 700 (1000-300)", out.Pdt710.ImpuestoAPagar)
	}
	want := 700.0 + 9.0 + 120.0
	if out.GrandTotalImpuesto != want {
		t.Fatalf("grand=%v want %v", out.GrandTotalImpuesto, want)
	}
}

func TestComputeItanDetractionPartial(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		Itan: &TaxSectionItan{
			Enabled:  true,
			Year:     2026,
			CuotaNro: 3,
			Impuesto: 500,
			DetractionPayment: &TaxDetractionPayment{
				Enabled: true,
				Mode:    "parcial",
				Amount:  120,
			},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.Itan.ImpuestoAPagar != 380 {
		t.Fatalf("itan impuesto_a_pagar=%v want 380", out.Itan.ImpuestoAPagar)
	}
	if out.Itan.DetractionPayment == nil || out.Itan.DetractionPayment.AppliedAmount != 120 {
		t.Fatalf("applied detraccion itan=%v want 120", out.Itan.DetractionPayment)
	}
}

func TestMarshalKeepsNumeroTrabajadoresWithoutSections(t *testing.T) {
	// El supervisor puede registrar el conteo antes de activar cualquier sección PDT.
	p := &TaxSettlementSectionsPayload{NumeroTrabajadores: 7}
	raw, err := MarshalTaxSettlementSectionsJSON(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if raw == "" {
		t.Fatal("json vacío: se perdió numero_trabajadores")
	}
	out, err := ParseTaxSettlementSectionsJSON(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if out == nil {
		t.Fatal("parse devolvió nil")
	}
	if out.NumeroTrabajadores != 7 {
		t.Fatalf("numero_trabajadores=%d want 7", out.NumeroTrabajadores)
	}
}

func TestMarshalEmptyPayloadStillReturnsBlank(t *testing.T) {
	raw, err := MarshalTaxSettlementSectionsJSON(&TaxSettlementSectionsPayload{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if raw != "" {
		t.Fatalf("json=%q want vacío", raw)
	}
}

func TestComputePreservesNumeroTrabajadoresAlongsideSections(t *testing.T) {
	p := &TaxSettlementSectionsPayload{
		NumeroTrabajadores: 12,
		Pdt621: &TaxSectionPdt621{
			Enabled:     true,
			VentasNetas: TaxIGVRow{Impuesto: 100},
		},
	}
	out := ComputeTaxSettlementSections(p)
	if out.NumeroTrabajadores != 12 {
		t.Fatalf("numero_trabajadores=%d want 12", out.NumeroTrabajadores)
	}
}

func TestValidateRejectsNegativeNumeroTrabajadores(t *testing.T) {
	if err := validateTaxSettlementSections(&TaxSettlementSectionsPayload{NumeroTrabajadores: -1}); err == nil {
		t.Fatal("se esperaba error para conteo negativo")
	}
	if err := validateTaxSettlementSections(&TaxSettlementSectionsPayload{NumeroTrabajadores: 10}); err != nil {
		t.Fatalf("conteo válido rechazado: %v", err)
	}
}
