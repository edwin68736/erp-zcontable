import type { CompanyIgvRate } from './companyIgv';
import { formatCompanyIgvRateLabel } from './companyIgv';
import {
  getRentaMensualRatePct,
  type LiquidationRentaRegime,
} from './companyTaxRegime';

export type TaxIGVRow = {
  base: number;
  no_gravadas?: number;
  impuesto: number;
  total: number;
};

export type TaxSectionPdt621 = {
  enabled: boolean;
  /** Tasas IGV activas para ventas y notas de crédito en esta liquidación. */
  igv_aplicable_ventas?: CompanyIgvRate[];
  /** Filas por tasa (ventas / NC). `ventas_netas` y `notas_credito` se conservan por compatibilidad. */
  ventas_netas_18?: TaxIGVRow;
  ventas_netas_105?: TaxIGVRow;
  notas_credito_18?: TaxIGVRow;
  notas_credito_105?: TaxIGVRow;
  ventas_netas: TaxIGVRow;
  notas_credito: TaxIGVRow;
  compras_105: TaxIGVRow;
  compras_18: TaxIGVRow;
  credito_periodo_anterior: number;
  percepciones_periodo: number;
  percepciones_anteriores: number;
  retenciones_periodo: number;
  retenciones_anteriores: number;
  /** Régimen para cálculo de renta mensual en esta liquidación. */
  renta_regimen?: LiquidationRentaRegime;
  /** Porcentaje manual cuando renta_regimen = coeficiente. */
  renta_coeficiente_pct?: number;
  renta_ventas_base: number;
  renta_ventas_impuesto: number;
  renta_saldo_favor_itan: number;
  impuesto_periodo: number;
  saldo_favor: number;
  saldo_favor_final: number;
  detraction_payment_igv?: Pdt621DetractionPayment;
  detraction_payment_renta?: Pdt621DetractionPayment;
  renta_impuesto_a_pagar: number;
  impuesto_a_pagar: number;
};

export type Pdt621DetractionMode = 'total' | 'parcial';

export type Pdt621DetractionPayment = {
  enabled: boolean;
  mode: Pdt621DetractionMode;
  amount: number;
  applied_amount: number;
  original_amount: number;
};

export type TaxSectionPdt601 = {
  enabled: boolean;
  essalud: number;
  sis: number;
  onp: number;
  afp: number;
  rta_4ta: number;
  rta_5ta: number;
  detraction_payment?: Pdt621DetractionPayment;
  impuesto_a_pagar: number;
};

export type TaxSectionItan = {
  enabled: boolean;
  year: number;
  cuota_nro: number;
  impuesto: number;
  detraction_payment?: Pdt621DetractionPayment;
  impuesto_a_pagar: number;
};

export type TaxSettlementSectionsPayload = {
  version: number;
  pdt621?: TaxSectionPdt621;
  pdt601?: TaxSectionPdt601;
  itan?: TaxSectionItan;
  grand_total_impuesto_a_pagar: number;
};

export const TAX_SECTIONS_VERSION = 1;
const DEFAULT_PDT621_DETRACTION_MODE: Pdt621DetractionMode = 'parcial';

export const TAX_AMOUNT_MAX_DECIMALS = 6;
export const TAX_AMOUNT_DISPLAY_DECIMALS = 2;

export function roundTaxAmount(v: number, decimals = TAX_AMOUNT_MAX_DECIMALS): number {
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

function roundMoney(v: number): number {
  return roundTaxAmount(v, 2);
}

/** Redondeo al entero más cercano para totales finales (100.55 → 101, 100.40 → 100). */
export function roundTaxTotalAmount(n: number): number {
  const normalized = roundMoney(Number(n ?? 0));
  if (!Number.isFinite(normalized)) return 0;
  return roundMoney(Math.round(normalized));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Impuesto del periodo: entero superior en magnitud si hay centavos (106.50→107, -106.50→-107). */
export function roundImpuestoPeriodo(v: number): number {
  const normalized = roundMoney(v);
  const cents = Math.round(normalized * 100);
  const whole = Math.trunc(cents / 100);
  const rem = cents - whole * 100;
  if (rem === 0) return whole;
  if (cents > 0) return whole + 1;
  return whole - 1;
}

function computeIGVRowTotal(base: number, noGravadas: number, impuesto: number, withNoGravadas: boolean): number {
  if (withNoGravadas) return roundTaxAmount(base + noGravadas + impuesto);
  return roundTaxAmount(base + impuesto);
}

function emptyIGVRow(): TaxIGVRow {
  return { base: 0, no_gravadas: 0, impuesto: 0, total: 0 };
}

function ventasNetasKey(rate: CompanyIgvRate): 'ventas_netas_18' | 'ventas_netas_105' {
  return rate === 10.5 ? 'ventas_netas_105' : 'ventas_netas_18';
}

function notasCreditoKey(rate: CompanyIgvRate): 'notas_credito_18' | 'notas_credito_105' {
  return rate === 10.5 ? 'notas_credito_105' : 'notas_credito_18';
}

export function getPdt621VentasRow(s: TaxSectionPdt621, rate: CompanyIgvRate): TaxIGVRow {
  const key = ventasNetasKey(rate);
  if (s[key] !== undefined) return s[key]!;
  const hasLegacy = (s.ventas_netas?.base ?? 0) > 0 || (s.ventas_netas?.impuesto ?? 0) > 0;
  if (hasLegacy && (!s.igv_aplicable_ventas?.length || s.igv_aplicable_ventas.length === 1)) {
    return s.ventas_netas;
  }
  return emptyIGVRow();
}

export function getPdt621NotasCreditoRow(s: TaxSectionPdt621, rate: CompanyIgvRate): TaxIGVRow {
  const key = notasCreditoKey(rate);
  if (s[key] !== undefined) return s[key]!;
  const hasLegacy = (s.notas_credito?.base ?? 0) > 0 || (s.notas_credito?.impuesto ?? 0) > 0;
  if (hasLegacy && (!s.igv_aplicable_ventas?.length || s.igv_aplicable_ventas.length === 1)) {
    return s.notas_credito;
  }
  return emptyIGVRow();
}

function resolveIgvAplicableVentas(s: TaxSectionPdt621, companyIgvRate?: CompanyIgvRate): CompanyIgvRate[] {
  if (s.igv_aplicable_ventas && s.igv_aplicable_ventas.length > 0) {
    return [...s.igv_aplicable_ventas];
  }
  const hasLegacyVentas =
    (s.ventas_netas?.base ?? 0) > 0 ||
    (s.ventas_netas?.impuesto ?? 0) > 0 ||
    (s.notas_credito?.base ?? 0) > 0 ||
    (s.notas_credito?.impuesto ?? 0) > 0;
  if (hasLegacyVentas && companyIgvRate) return [companyIgvRate];
  if (companyIgvRate) return [companyIgvRate];
  return [18];
}

function sumVentasImpuesto(s: TaxSectionPdt621, rates: CompanyIgvRate[]): number {
  return rates.reduce((acc, rate) => acc + getPdt621VentasRow(s, rate).impuesto, 0);
}

function sumNotasCreditoImpuesto(s: TaxSectionPdt621, rates: CompanyIgvRate[]): number {
  return rates.reduce((acc, rate) => acc + getPdt621NotasCreditoRow(s, rate).impuesto, 0);
}

/** Normaliza filas por tasa y migra datos legacy al editar. */
export function normalizePdt621IgvVentas(
  s: TaxSectionPdt621,
  companyIgvRate: CompanyIgvRate,
): TaxSectionPdt621 {
  const rates = resolveIgvAplicableVentas(s, companyIgvRate);
  const next: TaxSectionPdt621 = {
    ...s,
    igv_aplicable_ventas: rates,
    ventas_netas_18: s.ventas_netas_18 ?? emptyIGVRow(),
    ventas_netas_105: s.ventas_netas_105 ?? emptyIGVRow(),
    notas_credito_18: s.notas_credito_18 ?? emptyIGVRow(),
    notas_credito_105: s.notas_credito_105 ?? emptyIGVRow(),
  };

  const legacyVentas = s.ventas_netas;
  const legacyNotas = s.notas_credito;
  const hasLegacyVentas = (legacyVentas?.base ?? 0) > 0 || (legacyVentas?.impuesto ?? 0) > 0;
  const hasLegacyNotas = (legacyNotas?.base ?? 0) > 0 || (legacyNotas?.impuesto ?? 0) > 0;
  const hasRateSpecific =
    (next.ventas_netas_18?.base ?? 0) > 0 ||
    (next.ventas_netas_18?.impuesto ?? 0) > 0 ||
    (next.ventas_netas_105?.base ?? 0) > 0 ||
    (next.ventas_netas_105?.impuesto ?? 0) > 0;

  if (hasLegacyVentas && !hasRateSpecific) {
    const key = ventasNetasKey(companyIgvRate);
    next[key] = { ...legacyVentas };
  }
  if (hasLegacyNotas && !(next.notas_credito_18?.impuesto || next.notas_credito_105?.impuesto)) {
    const key = notasCreditoKey(companyIgvRate);
    next[key] = { ...legacyNotas };
  }

  return next;
}

export function patchPdt621VentasRow(
  s: TaxSectionPdt621,
  rate: CompanyIgvRate,
  rowPatch: Partial<TaxIGVRow>,
): TaxSectionPdt621 {
  const key = ventasNetasKey(rate);
  return { ...s, [key]: { ...getPdt621VentasRow(s, rate), ...rowPatch } };
}

export function patchPdt621NotasCreditoRow(
  s: TaxSectionPdt621,
  rate: CompanyIgvRate,
  rowPatch: Partial<TaxIGVRow>,
): TaxSectionPdt621 {
  const key = notasCreditoKey(rate);
  return { ...s, [key]: { ...getPdt621NotasCreditoRow(s, rate), ...rowPatch } };
}

export function clearPdt621IgvRateRows(s: TaxSectionPdt621, rate: CompanyIgvRate): TaxSectionPdt621 {
  const empty = emptyIGVRow();
  return {
    ...s,
    [ventasNetasKey(rate)]: empty,
    [notasCreditoKey(rate)]: empty,
  };
}

export function defaultPdt621Section(): TaxSectionPdt621 {
  return {
    enabled: false,
    ventas_netas: emptyIGVRow(),
    notas_credito: emptyIGVRow(),
    compras_105: emptyIGVRow(),
    compras_18: emptyIGVRow(),
    credito_periodo_anterior: 0,
    percepciones_periodo: 0,
    percepciones_anteriores: 0,
    retenciones_periodo: 0,
    retenciones_anteriores: 0,
    renta_ventas_base: 0,
    renta_ventas_impuesto: 0,
    renta_saldo_favor_itan: 0,
    impuesto_periodo: 0,
    saldo_favor: 0,
    saldo_favor_final: 0,
    detraction_payment_igv: {
      enabled: false,
      mode: DEFAULT_PDT621_DETRACTION_MODE,
      amount: 0,
      applied_amount: 0,
      original_amount: 0,
    },
    detraction_payment_renta: {
      enabled: false,
      mode: DEFAULT_PDT621_DETRACTION_MODE,
      amount: 0,
      applied_amount: 0,
      original_amount: 0,
    },
    renta_impuesto_a_pagar: 0,
    impuesto_a_pagar: 0,
  };
}

export function defaultPdt601Section(): TaxSectionPdt601 {
  return {
    enabled: false,
    essalud: 0,
    sis: 0,
    onp: 0,
    afp: 0,
    rta_4ta: 0,
    rta_5ta: 0,
    detraction_payment: {
      enabled: false,
      mode: DEFAULT_PDT621_DETRACTION_MODE,
      amount: 0,
      applied_amount: 0,
      original_amount: 0,
    },
    impuesto_a_pagar: 0,
  };
}

export function defaultItanSection(currentYear: number): TaxSectionItan {
  return {
    enabled: false,
    year: currentYear,
    cuota_nro: 1,
    impuesto: 0,
    detraction_payment: {
      enabled: false,
      mode: DEFAULT_PDT621_DETRACTION_MODE,
      amount: 0,
      applied_amount: 0,
      original_amount: 0,
    },
    impuesto_a_pagar: 0,
  };
}

export function defaultTaxSections(currentYear = new Date().getFullYear()): TaxSettlementSectionsPayload {
  return {
    version: TAX_SECTIONS_VERSION,
    pdt621: defaultPdt621Section(),
    pdt601: defaultPdt601Section(),
    itan: defaultItanSection(currentYear),
    grand_total_impuesto_a_pagar: 0,
  };
}

function computeRateIGVRow(row: TaxIGVRow, withNoGravadas: boolean): TaxIGVRow {
  return {
    ...row,
    total: computeIGVRowTotal(row.base, row.no_gravadas ?? 0, row.impuesto, withNoGravadas),
  };
}

export function computePdt621RentaVentasBase(s: TaxSectionPdt621): number {
  const rates: CompanyIgvRate[] = s.igv_aplicable_ventas?.length ? s.igv_aplicable_ventas : [18];
  let ventas = 0;
  let notas = 0;
  for (const rate of rates) {
    const v = getPdt621VentasRow(s, rate);
    const n = getPdt621NotasCreditoRow(s, rate);
    ventas += (v.base ?? 0) + (v.no_gravadas ?? 0);
    notas += (n.base ?? 0) + (n.no_gravadas ?? 0);
  }
  const net = ventas - notas;
  return roundTaxAmount(net > 0 ? net : 0);
}

function computePdt621RentaFields(s: TaxSectionPdt621): Pick<TaxSectionPdt621, 'renta_ventas_base' | 'renta_ventas_impuesto' | 'renta_impuesto_a_pagar'> {
  const renta_ventas_base = computePdt621RentaVentasBase(s);
  const ratePct = getRentaMensualRatePct(s.renta_regimen, s.renta_coeficiente_pct);
  const renta_ventas_impuesto_raw =
    ratePct > 0 && renta_ventas_base > 0 ? roundTaxAmount((renta_ventas_base * ratePct) / 100) : 0;
  const renta_ventas_impuesto = roundTaxTotalAmount(renta_ventas_impuesto_raw);
  let renta_impuesto_a_pagar = roundMoney(renta_ventas_impuesto - s.renta_saldo_favor_itan);
  if (renta_impuesto_a_pagar < 0) {
    renta_impuesto_a_pagar = 0;
  } else {
    renta_impuesto_a_pagar = roundTaxTotalAmount(renta_impuesto_a_pagar);
  }
  return { renta_ventas_base, renta_ventas_impuesto, renta_impuesto_a_pagar };
}

function sumPdt621PercepcionesRetenciones(s: TaxSectionPdt621): number {
  return roundMoney(
    s.percepciones_periodo +
      s.percepciones_anteriores +
      s.retenciones_periodo +
      s.retenciones_anteriores,
  );
}

/** Percepciones/retenciones siempre restan del saldo (a favor o impuesto a pagar). */
function computePdt621SaldoFavorFinal(saldoFavor: number, percepRetTotal: number): number {
  return roundMoney(saldoFavor - percepRetTotal);
}

function finalizePdt621SaldoFavorFinal(raw: number): number {
  if (raw > 0) return roundTaxTotalAmount(raw);
  return roundMoney(raw);
}

export function getPdt621PercepcionesRetencionesOpSign(_saldoFavor: number): '+' | '−' {
  return '−';
}

export function getPdt621PercepcionesRetencionesFieldLabel(baseLabel: string, saldoFavor: number): string {
  return `${baseLabel} (${getPdt621PercepcionesRetencionesOpSign(saldoFavor)})`;
}

export function formatPdt621IgvBalanceAmount(display: { label: string; amount: number }): string {
  if (display.amount > 0 && display.label.toLowerCase().includes('impuesto a pagar')) {
    return formatTaxTotalMoney(display.amount);
  }
  return formatTaxMoney(display.amount);
}

function computePdt621Section(s: TaxSectionPdt621): TaxSectionPdt621 {
  const rates: CompanyIgvRate[] = s.igv_aplicable_ventas?.length ? s.igv_aplicable_ventas : [18];

  const ventas_netas_18 = computeRateIGVRow(s.ventas_netas_18 ?? getPdt621VentasRow(s, 18), true);
  const ventas_netas_105 = computeRateIGVRow(s.ventas_netas_105 ?? getPdt621VentasRow(s, 10.5), true);
  const notas_credito_18 = computeRateIGVRow(s.notas_credito_18 ?? getPdt621NotasCreditoRow(s, 18), true);
  const notas_credito_105 = computeRateIGVRow(s.notas_credito_105 ?? getPdt621NotasCreditoRow(s, 10.5), true);

  const ventasImpuesto = sumVentasImpuesto(
    { ...s, ventas_netas_18, ventas_netas_105 },
    rates,
  );
  const notasImpuesto = sumNotasCreditoImpuesto(
    { ...s, notas_credito_18, notas_credito_105 },
    rates,
  );

  const ventas_netas = computeRateIGVRow(s.ventas_netas, true);
  const notas_credito = computeRateIGVRow(s.notas_credito, true);
  const compras_105 = computeRateIGVRow(s.compras_105, true);
  const compras_18 = computeRateIGVRow(s.compras_18, true);

  const impuesto_periodo = roundImpuestoPeriodo(
    ventasImpuesto - notasImpuesto - compras_105.impuesto - compras_18.impuesto,
  );
  const saldo_favor = roundMoney(impuesto_periodo - s.credito_periodo_anterior);
  const percepRetTotal = sumPdt621PercepcionesRetenciones(s);
  const saldo_favor_final = finalizePdt621SaldoFavorFinal(
    computePdt621SaldoFavorFinal(saldo_favor, percepRetTotal),
  );

  const rentaFields = computePdt621RentaFields({
    ...s,
    ventas_netas_18,
    ventas_netas_105,
    notas_credito_18,
    notas_credito_105,
  });

  const igvPagar = saldo_favor_final > 0 ? saldo_favor_final : 0;
  const rentaPagar = rentaFields.renta_impuesto_a_pagar;
  const detractionPaymentIgv = normalizePdt621DetractionPayment(s.detraction_payment_igv, igvPagar, true);
  const detractionPaymentRenta = normalizePdt621DetractionPayment(s.detraction_payment_renta, rentaPagar, true);
  const igvDespuesDetraccion = roundMoney(Math.max(igvPagar - detractionPaymentIgv.applied_amount, 0));
  const rentaDespuesDetraccion = roundMoney(Math.max(rentaPagar - detractionPaymentRenta.applied_amount, 0));
  const impuesto_a_pagar = roundTaxTotalAmount(rentaDespuesDetraccion + igvDespuesDetraccion);

  return {
    ...s,
    ventas_netas_18,
    ventas_netas_105,
    notas_credito_18,
    notas_credito_105,
    ventas_netas,
    notas_credito,
    compras_105,
    compras_18,
    impuesto_periodo,
    saldo_favor,
    saldo_favor_final,
    detraction_payment_igv: detractionPaymentIgv,
    detraction_payment_renta: detractionPaymentRenta,
    ...rentaFields,
    impuesto_a_pagar,
  };
}

function normalizePdt621DetractionPayment(
  payment: Pdt621DetractionPayment | undefined,
  originalAmount: number,
  includeDetraction: boolean,
): Pdt621DetractionPayment {
  const normalizedOriginalAmount = roundMoney(Math.max(originalAmount, 0));
  const enabled = Boolean(payment?.enabled) && includeDetraction && normalizedOriginalAmount > 0;
  const mode: Pdt621DetractionMode = payment?.mode === 'total' ? 'total' : DEFAULT_PDT621_DETRACTION_MODE;
  const requestedAmount = roundMoney(Math.max(payment?.amount ?? 0, 0));
  const appliedAmount = enabled
    ? mode === 'total'
      ? normalizedOriginalAmount
      : roundMoney(clamp(requestedAmount, 0, normalizedOriginalAmount))
    : 0;

  return {
    enabled,
    mode,
    amount: mode === 'total' ? normalizedOriginalAmount : requestedAmount,
    applied_amount: appliedAmount,
    original_amount: normalizedOriginalAmount,
  };
}

function computePdt601Section(s: TaxSectionPdt601, includeDetraction = true): TaxSectionPdt601 {
  const section: TaxSectionPdt601 = { ...s, sis: roundMoney(s.sis ?? 0) };
  const afp = roundMoney(section.afp);
  const detractable = getPdt601DetractableBeforeDetraction(section);
  const gross = roundMoney(afp + detractable);
  const detractionPayment = normalizePdt621DetractionPayment(section.detraction_payment, detractable, includeDetraction);
  const impuesto_a_pagar = includeDetraction
    ? roundTaxTotalAmount(afp + Math.max(detractable - detractionPayment.applied_amount, 0))
    : roundTaxTotalAmount(gross);
  return { ...section, detraction_payment: detractionPayment, impuesto_a_pagar };
}

function computePdt601SectionWithDetractionOption(s: TaxSectionPdt601, includeDetraction: boolean): TaxSectionPdt601 {
  const section: TaxSectionPdt601 = { ...s, sis: roundMoney(s.sis ?? 0) };
  if (includeDetraction) return computePdt601Section(section, true);
  const gross = roundMoney(section.essalud + section.sis + section.onp + section.afp + section.rta_4ta + section.rta_5ta);
  const noDetraction = computePdt601Section({
    ...section,
    detraction_payment: normalizePdt621DetractionPayment(section.detraction_payment, 0, false),
  }, false);
  return {
    ...noDetraction,
    detraction_payment: normalizePdt621DetractionPayment(
      section.detraction_payment,
      getPdt601DetractableBeforeDetraction(section),
      false,
    ),
    impuesto_a_pagar: roundTaxTotalAmount(gross),
  };
}

function computeItanSection(s: TaxSectionItan, includeDetraction = true): TaxSectionItan {
  const original = roundMoney(s.impuesto);
  const detractionPayment = normalizePdt621DetractionPayment(s.detraction_payment, original, includeDetraction);
  const impuesto_a_pagar = includeDetraction
    ? roundTaxTotalAmount(Math.max(original - detractionPayment.applied_amount, 0))
    : roundTaxTotalAmount(original);
  return { ...s, detraction_payment: detractionPayment, impuesto_a_pagar };
}

function computeItanSectionWithDetractionOption(s: TaxSectionItan, includeDetraction: boolean): TaxSectionItan {
  if (includeDetraction) return computeItanSection(s, true);
  const gross = roundMoney(s.impuesto);
  const noDetraction = computeItanSection({
    ...s,
    detraction_payment: normalizePdt621DetractionPayment(s.detraction_payment, 0, false),
  }, false);
  return {
    ...noDetraction,
    detraction_payment: normalizePdt621DetractionPayment(s.detraction_payment, gross, false),
    impuesto_a_pagar: roundTaxTotalAmount(gross),
  };
}

export type ComputeTaxSettlementSectionsOptions = {
  includeDetraction?: boolean;
};

export function computeTaxSettlementSections(
  p: TaxSettlementSectionsPayload,
  options: ComputeTaxSettlementSectionsOptions = {},
): TaxSettlementSectionsPayload {
  const includeDetraction = options.includeDetraction ?? true;
  const out: TaxSettlementSectionsPayload = {
    ...p,
    version: p.version || TAX_SECTIONS_VERSION,
    pdt621: p.pdt621 ? computePdt621SectionWithDetractionOption(p.pdt621, includeDetraction) : undefined,
    pdt601: p.pdt601 ? computePdt601SectionWithDetractionOption(p.pdt601, includeDetraction) : undefined,
    itan: p.itan ? computeItanSectionWithDetractionOption(p.itan, includeDetraction) : undefined,
    grand_total_impuesto_a_pagar: 0,
  };
  let grand = 0;
  if (out.pdt621?.enabled) grand += out.pdt621.impuesto_a_pagar;
  if (out.pdt601?.enabled) grand += out.pdt601.impuesto_a_pagar;
  if (out.itan?.enabled) grand += out.itan.impuesto_a_pagar;
  out.grand_total_impuesto_a_pagar = roundTaxTotalAmount(grand);
  return out;
}

function computePdt621SectionWithDetractionOption(
  s: TaxSectionPdt621,
  includeDetraction: boolean,
): TaxSectionPdt621 {
  if (includeDetraction) return computePdt621Section(s);
  const noDetraction = computePdt621Section({
    ...s,
    detraction_payment_igv: normalizePdt621DetractionPayment(s.detraction_payment_igv, 0, false),
    detraction_payment_renta: normalizePdt621DetractionPayment(s.detraction_payment_renta, 0, false),
  });
  return {
    ...noDetraction,
    detraction_payment_igv: normalizePdt621DetractionPayment(
      s.detraction_payment_igv,
      noDetraction.saldo_favor_final > 0 ? noDetraction.saldo_favor_final : 0,
      false,
    ),
    detraction_payment_renta: normalizePdt621DetractionPayment(
      s.detraction_payment_renta,
      noDetraction.renta_impuesto_a_pagar,
      false,
    ),
  };
}

export function listPdt621IgvDisplayRows(
  s: TaxSectionPdt621,
): Array<{ label: string; row: TaxIGVRow; withNoGravadas: boolean }> {
  const rates = s.igv_aplicable_ventas?.length ? s.igv_aplicable_ventas : [18 as CompanyIgvRate];
  const rows: Array<{ label: string; row: TaxIGVRow; withNoGravadas: boolean }> = [];
  for (const rate of rates) {
    rows.push({
      label: `Ventas netas (${formatCompanyIgvRateLabel(rate)})`,
      row: getPdt621VentasRow(s, rate),
      withNoGravadas: true,
    });
    rows.push({
      label: `(−) Notas de crédito (${formatCompanyIgvRateLabel(rate)})`,
      row: getPdt621NotasCreditoRow(s, rate),
      withNoGravadas: true,
    });
  }
  rows.push({ label: '(−) Compras 10.5 %', row: s.compras_105, withNoGravadas: true });
  rows.push({ label: '(−) Compras 18 %', row: s.compras_18, withNoGravadas: true });
  return rows;
}

export type Pdt601DisplayRow = {
  label: string;
  value: number;
};

export function listPdt601DisplayRows(s: TaxSectionPdt601): Pdt601DisplayRow[] {
  return [
    { label: 'ESSALUD', value: s.essalud },
    { label: 'SIS', value: s.sis },
    { label: 'ONP', value: s.onp },
    { label: 'AFP', value: s.afp },
    { label: 'Rta 4ta categoría', value: s.rta_4ta },
    { label: 'Rta 5ta categoría', value: s.rta_5ta },
  ];
}

/** Monto distinto de cero (2 decimales) para ocultar conceptos vacíos en PDF. */
export function isNonZeroTaxAmount(v: number): boolean {
  return Math.round(Number(v ?? 0) * 100) !== 0;
}

export function isTaxIgvRowVisibleInPdf(row: TaxIGVRow): boolean {
  return (
    isNonZeroTaxAmount(row.base) ||
    isNonZeroTaxAmount(row.no_gravadas ?? 0) ||
    isNonZeroTaxAmount(row.impuesto) ||
    isNonZeroTaxAmount(row.total)
  );
}

export function parseTaxSectionsJson(
  raw: string | undefined | null,
  options: ComputeTaxSettlementSectionsOptions = {},
): TaxSettlementSectionsPayload | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const p = JSON.parse(t) as TaxSettlementSectionsPayload;
    if (!p.version && !p.pdt621 && !p.pdt601 && !p.itan) return null;
    return computeTaxSettlementSections(p, options);
  } catch {
    return null;
  }
}

export function getPdt601DetractableBeforeDetraction(p601: TaxSectionPdt601): number {
  return roundMoney(p601.essalud + p601.sis + p601.onp + p601.rta_4ta + p601.rta_5ta);
}

export function getPdt601AppliedDetractionAmount(p601: TaxSectionPdt601): number {
  const detractable = getPdt601DetractableBeforeDetraction(p601);
  return normalizePdt621DetractionPayment(p601.detraction_payment, detractable, true).applied_amount;
}

export function getItanPayableBeforeDetraction(itan: TaxSectionItan): number {
  return roundMoney(Math.max(itan.impuesto, 0));
}

export function getItanAppliedDetractionAmount(itan: TaxSectionItan): number {
  const original = getItanPayableBeforeDetraction(itan);
  return normalizePdt621DetractionPayment(itan.detraction_payment, original, true).applied_amount;
}

export function getPdt621IgvPayableBeforeDetraction(p621: TaxSectionPdt621): number {
  return roundMoney(p621.saldo_favor_final > 0 ? p621.saldo_favor_final : 0);
}

export function getPdt621AppliedDetractionAmount(p621: TaxSectionPdt621): number {
  const igv = getPdt621IgvPayableBeforeDetraction(p621);
  return normalizePdt621DetractionPayment(p621.detraction_payment_igv, igv, true).applied_amount;
}

export function getPdt621RentaPayableBeforeDetraction(p621: TaxSectionPdt621): number {
  return roundMoney(Math.max(p621.renta_impuesto_a_pagar, 0));
}

export function getPdt621AppliedDetractionAmountRenta(p621: TaxSectionPdt621): number {
  const renta = getPdt621RentaPayableBeforeDetraction(p621);
  return normalizePdt621DetractionPayment(p621.detraction_payment_renta, renta, true).applied_amount;
}

export function getPdt621IgvBalanceDisplay(
  rawValue: number,
  options?: { final?: boolean },
): { label: string; amount: number } {
  const raw = roundMoney(rawValue);
  const suffix = options?.final ? ' (final)' : '';
  if (raw < 0) {
    return { label: `Saldo a favor${suffix}`, amount: raw };
  }
  if (raw > 0) {
    return {
      label: options?.final ? 'Impuesto a pagar (IGV)' : 'Impuesto a pagar',
      amount: raw,
    };
  }
  return { label: `Saldo a favor${suffix}`, amount: 0 };
}

export function getPdt621IgvBalanceLabel(p621: TaxSectionPdt621): { label: string; amount: number } {
  return getPdt621IgvBalanceDisplay(p621.saldo_favor_final, { final: true });
}

export function getPdt621IgvSaldoFavorLabel(p621: TaxSectionPdt621): { label: string; amount: number } {
  return getPdt621IgvBalanceDisplay(p621.saldo_favor, { final: false });
}

export function getPdt621IgvNetAfterDetraction(p621: TaxSectionPdt621): number {
  const before = getPdt621IgvPayableBeforeDetraction(p621);
  const applied = getPdt621AppliedDetractionAmount(p621);
  return roundMoney(Math.max(before - applied, 0));
}

export function getPdt621RentaNetAfterDetraction(p621: TaxSectionPdt621): number {
  const before = getPdt621RentaPayableBeforeDetraction(p621);
  const applied = getPdt621AppliedDetractionAmountRenta(p621);
  return roundMoney(Math.max(before - applied, 0));
}

export function formatPdt621DetractionPaymentNote(payment: Pdt621DetractionPayment | undefined): string | null {
  if (!payment?.enabled || payment.applied_amount <= 0) return null;
  if (payment.mode === 'total') {
    return `Pago con detracción (total): ${formatTaxMoney(payment.applied_amount)}`;
  }
  return `Pago con detracción (parcial): ${formatTaxMoney(payment.applied_amount)}`;
}

export function formatPdt621DetractionNotesCombined(p621: TaxSectionPdt621): string | null {
  const igv = formatPdt621DetractionPaymentNote(p621.detraction_payment_igv);
  const renta = formatPdt621DetractionPaymentNote(p621.detraction_payment_renta);
  const parts: string[] = [];
  if (igv) parts.push(`IGV: ${igv}`);
  if (renta) parts.push(`Renta: ${renta}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatTaxNumber(
  n: number,
  options?: {
    minDecimals?: number;
    maxDecimals?: number;
    useGrouping?: boolean;
  },
): string {
  const value = Number(n ?? 0);
  const safe = Number.isFinite(value) ? value : 0;
  const minDecimals = options?.minDecimals ?? 2;
  const maxDecimals = options?.maxDecimals ?? 2;
  const useGrouping = options?.useGrouping ?? true;
  return safe.toLocaleString('en-US', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
    useGrouping,
  });
}

export function formatTaxMoney(n: number): string {
  return `S/ ${formatTaxNumber(n, { minDecimals: 2, maxDecimals: 2 })}`;
}

/** Formato de totales finales: redondeo al entero más cercano y 2 decimales. */
export function formatTaxTotalMoney(n: number): string {
  return formatTaxMoney(roundTaxTotalAmount(n));
}

/** Formato entero para impuesto del periodo (sin decimales). */
export function formatImpuestoPeriodo(n: number): string {
  return `S/ ${formatTaxNumber(Math.trunc(Number(n ?? 0)), { minDecimals: 0, maxDecimals: 0 })}`;
}

/** Sanitiza entrada numérica de montos (hasta 6 decimales). */
export function sanitizeTaxAmountInput(raw: string, maxDecimals = TAX_AMOUNT_MAX_DECIMALS): string {
  let out = '';
  let hasSep = false;
  let decCount = 0;
  for (const ch of raw.replace(/,/g, '')) {
    if (ch >= '0' && ch <= '9') {
      if (hasSep) {
        if (decCount >= maxDecimals) continue;
        decCount++;
      }
      out += ch;
      continue;
    }
    if ((ch === '.' || ch === ',') && !hasSep) {
      out += '.';
      hasSep = true;
    }
  }
  return out;
}

export function parseTaxAmount(raw: string): number {
  const normalized = raw.trim().replace(/,/g, '');
  if (!normalized || normalized === '.') return 0;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundTaxAmount(n);
}

/** Texto editable para inputs de monto sin separador de miles (edición). */
export function formatTaxAmountInputEdit(n: number, maxDecimals = TAX_AMOUNT_MAX_DECIMALS): string {
  if (!Number.isFinite(n) || n === 0) return '';
  const rounded = roundTaxAmount(n);
  return rounded.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

/** Texto visible para inputs de monto (miles con coma, 2 decimales en pantalla). */
export function formatTaxAmountInput(
  n: number,
  options?: { maxDecimals?: number; minDecimals?: number; useGrouping?: boolean },
): string {
  const maxDecimals = options?.maxDecimals ?? TAX_AMOUNT_DISPLAY_DECIMALS;
  const minDecimals = options?.minDecimals ?? TAX_AMOUNT_DISPLAY_DECIMALS;
  const useGrouping = options?.useGrouping ?? true;
  if (!Number.isFinite(n) || n === 0) return '';
  return formatTaxNumber(roundTaxAmount(n), { minDecimals, maxDecimals, useGrouping });
}

export function formatTaxRowMoney(n: number): string {
  return formatTaxMoney(n);
}

/** PDF: muestra guion cuando el monto es cero. */
export function formatTaxPdfMoney(n: number): string {
  if (!isNonZeroTaxAmount(n)) return '—';
  return formatTaxMoney(n);
}

/** PDF: totales finales siempre muestran monto (incluido cero). */
export function formatTaxPdfTotalMoney(n: number): string {
  return formatTaxTotalMoney(n);
}

export function formatTaxPdfRowMoney(n: number): string {
  return formatTaxPdfMoney(n);
}

export function formatImpuestoPeriodoPdf(n: number): string {
  return formatTaxPdfMoney(n);
}

export function getPdt621DetractionPdfRowLabel(payment: Pdt621DetractionPayment | undefined): string | null {
  if (!payment?.enabled || (payment.applied_amount ?? 0) <= 0) return null;
  return payment.mode === 'total' ? 'Pago con detracción (total)' : 'Pago con detracción (parcial)';
}
