package services

import (
	"testing"

	"miappfiber/models"
)

func newPreliminarCompany(igvRate string) *models.Company {
	return &models.Company{IgvRate: igvRate, TaxRegime: models.CompanyTaxRegimeMype}
}

func TestPreliminarVentasComprasPorDefecto95(t *testing.T) {
	s := &SupervisorService{}
	// IGV de ventas 785 (base 4,361.11 al 18% ≈ 785) sin crédito: a compensar 95% = 745.75.
	in := PreliminarVentasRecordInput{
		IgvAplicable18:  true,
		FacturasBase18:  4361.11,
		ReduccionIgvPct: 95,
	}
	sum := s.computePreliminarVentasSummary(newPreliminarCompany("18"), in, 0, 0)

	if sum.IgvAPagar != 785 {
		t.Fatalf("IgvAPagar = %v, quería 785", sum.IgvAPagar)
	}
	// 745.75 / 0.18 = 4143.06 → se redondea hacia arriba a 4144.
	if sum.ComprasBase != 4144 {
		t.Fatalf("ComprasBase = %v, quería 4144", sum.ComprasBase)
	}
	if sum.ComprasIgv != 745.92 {
		t.Fatalf("ComprasIgv = %v, quería 745.92", sum.ComprasIgv)
	}
	if sum.ComprasTotal != 4889.92 {
		t.Fatalf("ComprasTotal = %v, quería 4889.92", sum.ComprasTotal)
	}
	// Quedaría por pagar: 785 − 745.92 = 39.08 → 39.
	if sum.MontoAproximadoIgv == nil || *sum.MontoAproximadoIgv != 39 {
		t.Fatalf("MontoAproximadoIgv = %v, quería 39", sum.MontoAproximadoIgv)
	}
}

func TestPreliminarVentasComprasTope100YTasa105(t *testing.T) {
	s := &SupervisorService{}
	in := PreliminarVentasRecordInput{
		IgvAplicable105: true,
		FacturasBase105: 10000, // IGV 1,050
		ReduccionIgvPct: 250,   // se acota a 100
	}
	sum := s.computePreliminarVentasSummary(newPreliminarCompany("10.5"), in, 0, 0)

	if sum.IgvAPagar != 1050 {
		t.Fatalf("IgvAPagar = %v, quería 1050", sum.IgvAPagar)
	}
	// 100% de 1,050 a 10.5% = base 10,000.
	if sum.ComprasBase != 10000 {
		t.Fatalf("ComprasBase = %v, quería 10000", sum.ComprasBase)
	}
	if sum.MontoAproximadoIgv == nil || *sum.MontoAproximadoIgv != 0 {
		t.Fatalf("MontoAproximadoIgv = %v, quería 0", sum.MontoAproximadoIgv)
	}
}

func TestPreliminarVentasSinComprasConSaldoAFavor(t *testing.T) {
	s := &SupervisorService{}
	in := PreliminarVentasRecordInput{
		IgvAplicable18:  true,
		FacturasBase18:  4361.11,
		ReduccionIgvPct: 95,
	}
	// Crédito del período anterior mayor al IGV: saldo a favor (−1,261) → nada que compensar.
	sum := s.computePreliminarVentasSummary(newPreliminarCompany("18"), in, 2046, 2046)

	if sum.IgvAPagar != -1261 {
		t.Fatalf("IgvAPagar = %v, quería -1261", sum.IgvAPagar)
	}
	if sum.ComprasBase != 0 || sum.ComprasIgv != 0 || sum.ComprasTotal != 0 {
		t.Fatalf("compras debían ser 0, fue %v/%v/%v", sum.ComprasBase, sum.ComprasIgv, sum.ComprasTotal)
	}
	if sum.MontoAproximadoIgv != nil {
		t.Fatalf("MontoAproximadoIgv debía ser nil con saldo a favor")
	}
}
