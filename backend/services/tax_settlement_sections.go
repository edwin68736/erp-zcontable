package services

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
)

const taxSettlementSectionsVersion = 1

// TaxSettlementSectionsPayload bloque fiscal PDT 621 / 601 / ITAN (JSON en tax_settlements.pdt621_json).
type TaxSettlementSectionsPayload struct {
	Version              int                    `json:"version"`
	Pdt621               *TaxSectionPdt621      `json:"pdt621,omitempty"`
	Pdt601               *TaxSectionPdt601      `json:"pdt601,omitempty"`
	Itan                 *TaxSectionItan        `json:"itan,omitempty"`
	GrandTotalImpuesto   float64                `json:"grand_total_impuesto_a_pagar"`
}

type TaxIGVRow struct {
	Base        float64 `json:"base"`
	NoGravadas  float64 `json:"no_gravadas,omitempty"`
	Impuesto    float64 `json:"impuesto"`
	Total       float64 `json:"total"`
}

type TaxSectionPdt621 struct {
	Enabled                bool              `json:"enabled"`
	IgvAplicableVentas     []float64         `json:"igv_aplicable_ventas,omitempty"`
	VentasNetas18          *TaxIGVRow        `json:"ventas_netas_18,omitempty"`
	VentasNetas105         *TaxIGVRow        `json:"ventas_netas_105,omitempty"`
	NotasCredito18         *TaxIGVRow        `json:"notas_credito_18,omitempty"`
	NotasCredito105        *TaxIGVRow        `json:"notas_credito_105,omitempty"`
	VentasNetas            TaxIGVRow         `json:"ventas_netas"`
	NotasCredito           TaxIGVRow         `json:"notas_credito"`
	Compras105             TaxIGVRow         `json:"compras_105"`
	Compras18              TaxIGVRow         `json:"compras_18"`
	CreditoPeriodoAnt    float64   `json:"credito_periodo_anterior"`
	PercepcionesPeriodo  float64   `json:"percepciones_periodo"`
	PercepcionesAnteriores float64  `json:"percepciones_anteriores"`
	RetencionesPeriodo   float64   `json:"retenciones_periodo"`
	RetencionesAnteriores float64  `json:"retenciones_anteriores"`
	RentaRegimen         string    `json:"renta_regimen,omitempty"`
	RentaCoeficientePct  float64   `json:"renta_coeficiente_pct,omitempty"`
	RentaVentasBase      float64   `json:"renta_ventas_base"`
	RentaVentasImpuesto  float64   `json:"renta_ventas_impuesto"`
	RentaSaldoFavorItan  float64   `json:"renta_saldo_favor_itan"`
	ImpuestoPeriodo      float64   `json:"impuesto_periodo"`
	SaldoFavor           float64   `json:"saldo_favor"`
	SaldoFavorFinal      float64   `json:"saldo_favor_final"`
	DetractionPaymentIGV   *TaxDetractionPayment `json:"detraction_payment_igv,omitempty"`
	DetractionPaymentRenta *TaxDetractionPayment `json:"detraction_payment_renta,omitempty"`
	RentaImpuestoPagar   float64   `json:"renta_impuesto_a_pagar"`
	ImpuestoAPagar       float64   `json:"impuesto_a_pagar"`
}

type TaxDetractionPayment struct {
	Enabled           bool    `json:"enabled"`
	Mode              string  `json:"mode,omitempty"` // total | parcial
	Amount            float64 `json:"amount"`
	AppliedAmount     float64 `json:"applied_amount"`
	OriginalAmount    float64 `json:"original_amount"`
}

type TaxSectionPdt601 struct {
	Enabled            bool                  `json:"enabled"`
	Essalud            float64               `json:"essalud"`
	Sis                float64               `json:"sis"`
	Onp                float64               `json:"onp"`
	Afp                float64               `json:"afp"`
	Rta4ta             float64               `json:"rta_4ta"`
	Rta5ta             float64               `json:"rta_5ta"`
	DetractionPayment  *TaxDetractionPayment `json:"detraction_payment,omitempty"`
	ImpuestoAPagar     float64               `json:"impuesto_a_pagar"`
}

type TaxSectionItan struct {
	Enabled           bool                  `json:"enabled"`
	Year              int                   `json:"year"`
	CuotaNro          int                   `json:"cuota_nro"`
	Impuesto          float64               `json:"impuesto"`
	DetractionPayment *TaxDetractionPayment `json:"detraction_payment,omitempty"`
	ImpuestoAPagar    float64               `json:"impuesto_a_pagar"`
}

func roundTaxMoney(v float64) float64 {
	return math.Round(v*100) / 100
}

// roundTaxTotalAmount redondea al entero más cercano (solo totales finales).
func roundTaxTotalAmount(v float64) float64 {
	return roundTaxMoney(math.Round(v))
}

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func roundTaxAmount(v float64, decimals int) float64 {
	if decimals < 0 {
		decimals = 0
	}
	factor := math.Pow(10, float64(decimals))
	return math.Round(v*factor) / factor
}

const taxAmountMaxDecimals = 6

// roundImpuestoPeriodo redondea al entero superior en magnitud si hay centavos.
// Positivo: 106.50 → 107. Negativo: -106.50 → -107.
func roundImpuestoPeriodo(v float64) float64 {
	normalized := roundTaxMoney(v)
	cents := int64(math.Round(normalized * 100))
	whole := cents / 100
	rem := cents % 100
	if rem == 0 {
		return float64(whole)
	}
	if cents > 0 {
		return float64(whole + 1)
	}
	return float64(whole - 1)
}

func computeIGVRowTotal(base, noGravadas, impuesto float64, withNoGravadas bool) float64 {
	if withNoGravadas {
		return roundTaxAmount(base+noGravadas+impuesto, taxAmountMaxDecimals)
	}
	return roundTaxAmount(base+impuesto, taxAmountMaxDecimals)
}

func emptyTaxIGVRow() TaxIGVRow {
	return TaxIGVRow{}
}

func getVentasRow(s *TaxSectionPdt621, rate float64) TaxIGVRow {
	if rate == 10.5 && s.VentasNetas105 != nil {
		return *s.VentasNetas105
	}
	if rate == 18 && s.VentasNetas18 != nil {
		return *s.VentasNetas18
	}
	if s.VentasNetas.Base > 0 || s.VentasNetas.Impuesto > 0 {
		return s.VentasNetas
	}
	return emptyTaxIGVRow()
}

func getNotasCreditoRow(s *TaxSectionPdt621, rate float64) TaxIGVRow {
	if rate == 10.5 && s.NotasCredito105 != nil {
		return *s.NotasCredito105
	}
	if rate == 18 && s.NotasCredito18 != nil {
		return *s.NotasCredito18
	}
	if s.NotasCredito.Base > 0 || s.NotasCredito.Impuesto > 0 {
		return s.NotasCredito
	}
	return emptyTaxIGVRow()
}

func resolveIgvAplicableVentas(s *TaxSectionPdt621) []float64 {
	if len(s.IgvAplicableVentas) > 0 {
		return s.IgvAplicableVentas
	}
	if s.VentasNetas.Base > 0 || s.VentasNetas.Impuesto > 0 ||
		s.NotasCredito.Base > 0 || s.NotasCredito.Impuesto > 0 {
		return []float64{18}
	}
	return []float64{18}
}

func sumVentasImpuesto(s *TaxSectionPdt621, rates []float64) float64 {
	var sum float64
	for _, rate := range rates {
		sum += getVentasRow(s, rate).Impuesto
	}
	return sum
}

func sumNotasCreditoImpuesto(s *TaxSectionPdt621, rates []float64) float64 {
	var sum float64
	for _, rate := range rates {
		sum += getNotasCreditoRow(s, rate).Impuesto
	}
	return sum
}

func computeRateIGVRow(row TaxIGVRow, withNoGravadas bool) TaxIGVRow {
	noGrav := row.NoGravadas
	row.Total = computeIGVRowTotal(row.Base, noGrav, row.Impuesto, withNoGravadas)
	return row
}

func igvRowNetAmount(row TaxIGVRow) float64 {
	return row.Base + row.NoGravadas
}

func computePdt621RentaVentasBase(s *TaxSectionPdt621, rates []float64) float64 {
	var ventas, notas float64
	for _, rate := range rates {
		ventas += igvRowNetAmount(getVentasRow(s, rate))
		notas += igvRowNetAmount(getNotasCreditoRow(s, rate))
	}
	net := ventas - notas
	if net < 0 {
		net = 0
	}
	return roundTaxAmount(net, taxAmountMaxDecimals)
}

func rentaMensualRatePct(regimen string, coeficientePct float64) float64 {
	switch strings.TrimSpace(strings.ToLower(regimen)) {
	case "coeficiente":
		if coeficientePct > 0 {
			return coeficientePct
		}
		return 0
	case "mype", "rmt":
		return 1.0
	case "rer":
		return 1.5
	case "general", "rg":
		return 1.5
	default:
		return 1.5
	}
}

func normalizeDetractionPayment(payment *TaxDetractionPayment, originalAmount float64, includeDetraction bool) *TaxDetractionPayment {
	normalizedOriginalAmount := roundTaxMoney(math.Max(originalAmount, 0))
	mode := "parcial"
	if payment != nil && strings.TrimSpace(strings.ToLower(payment.Mode)) == "total" {
		mode = "total"
	}
	enabled := payment != nil && payment.Enabled && includeDetraction && normalizedOriginalAmount > 0
	requested := 0.0
	if payment != nil {
		requested = roundTaxMoney(math.Max(payment.Amount, 0))
	}
	applied := 0.0
	if enabled {
		if mode == "total" {
			applied = normalizedOriginalAmount
		} else {
			applied = roundTaxMoney(clamp(requested, 0, normalizedOriginalAmount))
		}
	}
	amount := requested
	if mode == "total" {
		amount = normalizedOriginalAmount
	}
	return &TaxDetractionPayment{
		Enabled:           enabled,
		Mode:              mode,
		Amount:            amount,
		AppliedAmount:     applied,
		OriginalAmount:    normalizedOriginalAmount,
	}
}

func sumPdt621PercepcionesRetenciones(s *TaxSectionPdt621) float64 {
	if s == nil {
		return 0
	}
	return roundTaxMoney(
		s.PercepcionesPeriodo + s.PercepcionesAnteriores + s.RetencionesPeriodo + s.RetencionesAnteriores,
	)
}

// computePdt621SaldoFavorFinal: percepciones/retenciones siempre restan del saldo.
func computePdt621SaldoFavorFinal(saldoFavor, percepRetTotal float64) float64 {
	return roundTaxMoney(saldoFavor - percepRetTotal)
}

func finalizePdt621SaldoFavorFinal(raw float64) float64 {
	if raw > 0 {
		return roundTaxTotalAmount(raw)
	}
	return roundTaxMoney(raw)
}

func computePdt621Section(s *TaxSectionPdt621, includeDetraction bool) {
	if s == nil {
		return
	}
	rates := resolveIgvAplicableVentas(s)

	ventas18 := computeRateIGVRow(getVentasRow(s, 18), true)
	ventas105 := computeRateIGVRow(getVentasRow(s, 10.5), true)
	notas18 := computeRateIGVRow(getNotasCreditoRow(s, 18), true)
	notas105 := computeRateIGVRow(getNotasCreditoRow(s, 10.5), true)
	s.VentasNetas18 = &ventas18
	s.VentasNetas105 = &ventas105
	s.NotasCredito18 = &notas18
	s.NotasCredito105 = &notas105

	ventasImpuesto := sumVentasImpuesto(s, rates)
	notasImpuesto := sumNotasCreditoImpuesto(s, rates)

	s.VentasNetas.Total = computeIGVRowTotal(s.VentasNetas.Base, s.VentasNetas.NoGravadas, s.VentasNetas.Impuesto, true)
	s.NotasCredito.Total = computeIGVRowTotal(s.NotasCredito.Base, s.NotasCredito.NoGravadas, s.NotasCredito.Impuesto, true)
	s.Compras105.Total = computeIGVRowTotal(s.Compras105.Base, s.Compras105.NoGravadas, s.Compras105.Impuesto, true)
	s.Compras18.Total = computeIGVRowTotal(s.Compras18.Base, s.Compras18.NoGravadas, s.Compras18.Impuesto, true)

	s.ImpuestoPeriodo = roundImpuestoPeriodo(
		ventasImpuesto-notasImpuesto-s.Compras105.Impuesto-s.Compras18.Impuesto,
	)
	s.SaldoFavor = roundTaxMoney(s.ImpuestoPeriodo - s.CreditoPeriodoAnt)
	percepRetTotal := sumPdt621PercepcionesRetenciones(s)
	s.SaldoFavorFinal = finalizePdt621SaldoFavorFinal(computePdt621SaldoFavorFinal(s.SaldoFavor, percepRetTotal))

	s.RentaVentasBase = computePdt621RentaVentasBase(s, rates)
	ratePct := rentaMensualRatePct(s.RentaRegimen, s.RentaCoeficientePct)
	if ratePct > 0 && s.RentaVentasBase > 0 {
		s.RentaVentasImpuesto = roundTaxTotalAmount(roundTaxAmount(s.RentaVentasBase*ratePct/100, taxAmountMaxDecimals))
	} else {
		s.RentaVentasImpuesto = 0
	}

	renta := roundTaxMoney(s.RentaVentasImpuesto - s.RentaSaldoFavorItan)
	if renta < 0 {
		renta = 0
	} else {
		renta = roundTaxTotalAmount(renta)
	}
	s.RentaImpuestoPagar = renta

	// Impuesto a pagar de la sección: renta positiva; IGV solo si hay deuda (saldo final > 0).
	igvPagar := 0.0
	if s.SaldoFavorFinal > 0 {
		igvPagar = s.SaldoFavorFinal
	}
	s.DetractionPaymentIGV = normalizeDetractionPayment(s.DetractionPaymentIGV, igvPagar, includeDetraction)
	s.DetractionPaymentRenta = normalizeDetractionPayment(s.DetractionPaymentRenta, renta, includeDetraction)
	igvDespuesDetraccion := math.Max(igvPagar-s.DetractionPaymentIGV.AppliedAmount, 0)
	rentaDespuesDetraccion := math.Max(renta-s.DetractionPaymentRenta.AppliedAmount, 0)
	s.ImpuestoAPagar = roundTaxTotalAmount(rentaDespuesDetraccion + igvDespuesDetraccion)
}

func pdt601DetractableBeforeDetraction(s *TaxSectionPdt601) float64 {
	if s == nil {
		return 0
	}
	return roundTaxMoney(s.Essalud + s.Sis + s.Onp + s.Afp + s.Rta4ta + s.Rta5ta)
}

func computePdt601Section(s *TaxSectionPdt601, includeDetraction bool) {
	if s == nil {
		return
	}
	gross := pdt601DetractableBeforeDetraction(s)
	s.DetractionPayment = normalizeDetractionPayment(s.DetractionPayment, gross, includeDetraction)
	if includeDetraction {
		s.ImpuestoAPagar = roundTaxTotalAmount(math.Max(gross-s.DetractionPayment.AppliedAmount, 0))
		return
	}
	s.ImpuestoAPagar = roundTaxTotalAmount(gross)
}

func computeItanSection(s *TaxSectionItan, includeDetraction bool) {
	if s == nil {
		return
	}
	original := roundTaxMoney(s.Impuesto)
	s.DetractionPayment = normalizeDetractionPayment(s.DetractionPayment, original, includeDetraction)
	if includeDetraction {
		s.ImpuestoAPagar = roundTaxTotalAmount(math.Max(original-s.DetractionPayment.AppliedAmount, 0))
		return
	}
	s.ImpuestoAPagar = roundTaxTotalAmount(original)
}

// ComputeTaxSettlementSections recalcula totales derivados y gran total.
type ComputeTaxSettlementSectionsOptions struct {
	IncludeDetraction bool
}

func ComputeTaxSettlementSectionsWithOptions(p *TaxSettlementSectionsPayload, opts *ComputeTaxSettlementSectionsOptions) *TaxSettlementSectionsPayload {
	if p == nil {
		return nil
	}
	includeDetraction := true
	if opts != nil {
		includeDetraction = opts.IncludeDetraction
	}
	if p.Version == 0 {
		p.Version = taxSettlementSectionsVersion
	}
	if p.Pdt621 != nil && p.Pdt621.Enabled {
		computePdt621Section(p.Pdt621, includeDetraction)
	}
	if p.Pdt601 != nil && p.Pdt601.Enabled {
		computePdt601Section(p.Pdt601, includeDetraction)
	}
	if p.Itan != nil && p.Itan.Enabled {
		computeItanSection(p.Itan, includeDetraction)
	}
	var grand float64
	if p.Pdt621 != nil && p.Pdt621.Enabled {
		grand += p.Pdt621.ImpuestoAPagar
	}
	if p.Pdt601 != nil && p.Pdt601.Enabled {
		grand += p.Pdt601.ImpuestoAPagar
	}
	if p.Itan != nil && p.Itan.Enabled {
		grand += p.Itan.ImpuestoAPagar
	}
	p.GrandTotalImpuesto = roundTaxTotalAmount(grand)
	return p
}

// ComputeTaxSettlementSections mantiene compatibilidad: aplica detracción por defecto.
func ComputeTaxSettlementSections(p *TaxSettlementSectionsPayload) *TaxSettlementSectionsPayload {
	return ComputeTaxSettlementSectionsWithOptions(p, &ComputeTaxSettlementSectionsOptions{IncludeDetraction: true})
}

// ParseTaxSettlementSectionsJSON interpreta pdt621_json (v1 estructurado o legado).
func ParseTaxSettlementSectionsJSON(raw string) (*TaxSettlementSectionsPayload, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var p TaxSettlementSectionsPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return nil, err
	}
	if p.Version == 0 && p.Pdt621 == nil && p.Pdt601 == nil && p.Itan == nil {
		return nil, nil
	}
	return ComputeTaxSettlementSections(&p), nil
}

// MarshalTaxSettlementSectionsJSON serializa el payload con totales calculados.
func MarshalTaxSettlementSectionsJSON(p *TaxSettlementSectionsPayload) (string, error) {
	if p == nil {
		return "", nil
	}
	p = ComputeTaxSettlementSections(p)
	hasSection := (p.Pdt621 != nil && p.Pdt621.Enabled) ||
		(p.Pdt601 != nil && p.Pdt601.Enabled) ||
		(p.Itan != nil && p.Itan.Enabled)
	if !hasSection {
		return "", nil
	}
	b, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func validateTaxSettlementSections(p *TaxSettlementSectionsPayload) error {
	if p == nil {
		return nil
	}
	if p.Itan != nil && p.Itan.Enabled {
		if p.Itan.Year < 2000 || p.Itan.Year > 2100 {
			return errors.New("año ITAN inválido")
		}
		if p.Itan.CuotaNro < 1 || p.Itan.CuotaNro > 12 {
			return errors.New("cuota ITAN inválida (1-12)")
		}
	}
	return nil
}
