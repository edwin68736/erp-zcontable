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
  renta_impuesto_a_pagar: number;
  impuesto_a_pagar: number;
};

export type TaxSectionPdt601 = {
  enabled: boolean;
  essalud: number;
  onp: number;
  afp: number;
  rta_4ta: number;
  rta_5ta: number;
  impuesto_a_pagar: number;
};

export type TaxSectionItan = {
  enabled: boolean;
  year: number;
  cuota_nro: number;
  impuesto: number;
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

export const TAX_AMOUNT_MAX_DECIMALS = 6;

export function roundTaxAmount(v: number, decimals = TAX_AMOUNT_MAX_DECIMALS): number {
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

function roundMoney(v: number): number {
  return roundTaxAmount(v, 2);
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
    renta_impuesto_a_pagar: 0,
    impuesto_a_pagar: 0,
  };
}

export function defaultPdt601Section(): TaxSectionPdt601 {
  return {
    enabled: false,
    essalud: 0,
    onp: 0,
    afp: 0,
    rta_4ta: 0,
    rta_5ta: 0,
    impuesto_a_pagar: 0,
  };
}

export function defaultItanSection(currentYear: number): TaxSectionItan {
  return {
    enabled: false,
    year: currentYear,
    cuota_nro: 1,
    impuesto: 0,
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
  const renta_ventas_impuesto =
    ratePct > 0 && renta_ventas_base > 0 ? roundTaxAmount((renta_ventas_base * ratePct) / 100) : 0;
  let renta_impuesto_a_pagar = roundMoney(renta_ventas_impuesto - s.renta_saldo_favor_itan);
  if (renta_impuesto_a_pagar < 0) renta_impuesto_a_pagar = 0;
  return { renta_ventas_base, renta_ventas_impuesto, renta_impuesto_a_pagar };
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
  const saldo_favor_final = roundMoney(
    saldo_favor +
      s.percepciones_periodo +
      s.percepciones_anteriores +
      s.retenciones_periodo +
      s.retenciones_anteriores,
  );

  const rentaFields = computePdt621RentaFields({
    ...s,
    ventas_netas_18,
    ventas_netas_105,
    notas_credito_18,
    notas_credito_105,
  });

  const igvPagar = saldo_favor_final > 0 ? saldo_favor_final : 0;
  const impuesto_a_pagar = roundMoney(rentaFields.renta_impuesto_a_pagar + igvPagar);

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
    ...rentaFields,
    impuesto_a_pagar,
  };
}

function computePdt601Section(s: TaxSectionPdt601): TaxSectionPdt601 {
  const impuesto_a_pagar = roundMoney(s.essalud + s.onp + s.afp + s.rta_4ta + s.rta_5ta);
  return { ...s, impuesto_a_pagar };
}

function computeItanSection(s: TaxSectionItan): TaxSectionItan {
  return { ...s, impuesto_a_pagar: roundMoney(s.impuesto) };
}

export function computeTaxSettlementSections(p: TaxSettlementSectionsPayload): TaxSettlementSectionsPayload {
  const out: TaxSettlementSectionsPayload = {
    ...p,
    version: p.version || TAX_SECTIONS_VERSION,
    pdt621: p.pdt621 ? computePdt621Section(p.pdt621) : undefined,
    pdt601: p.pdt601 ? computePdt601Section(p.pdt601) : undefined,
    itan: p.itan ? computeItanSection(p.itan) : undefined,
    grand_total_impuesto_a_pagar: 0,
  };
  let grand = 0;
  if (out.pdt621?.enabled) grand += out.pdt621.impuesto_a_pagar;
  if (out.pdt601?.enabled) grand += out.pdt601.impuesto_a_pagar;
  if (out.itan?.enabled) grand += out.itan.impuesto_a_pagar;
  out.grand_total_impuesto_a_pagar = roundMoney(grand);
  return out;
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

export function parseTaxSectionsJson(raw: string | undefined | null): TaxSettlementSectionsPayload | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const p = JSON.parse(t) as TaxSettlementSectionsPayload;
    if (!p.version && !p.pdt621 && !p.pdt601 && !p.itan) return null;
    return computeTaxSettlementSections(p);
  } catch {
    return null;
  }
}

export function formatTaxMoney(n: number): string {
  return `S/ ${Number(n ?? 0).toFixed(2)}`;
}

/** Formato entero para impuesto del periodo (sin decimales). */
export function formatImpuestoPeriodo(n: number): string {
  return `S/ ${Math.trunc(Number(n ?? 0))}`;
}

/** Sanitiza entrada numérica de montos (hasta 6 decimales). */
export function sanitizeTaxAmountInput(raw: string, maxDecimals = TAX_AMOUNT_MAX_DECIMALS): string {
  let out = '';
  let hasSep = false;
  let decCount = 0;
  for (const ch of raw) {
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
  const normalized = raw.trim().replace(',', '.');
  if (!normalized || normalized === '.') return 0;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundTaxAmount(n);
}

/** Texto editable para inputs de monto (sin ceros finales innecesarios). */
export function formatTaxAmountInput(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '';
  const rounded = roundTaxAmount(n);
  return rounded.toFixed(TAX_AMOUNT_MAX_DECIMALS).replace(/\.?0+$/, '');
}

export function formatTaxRowMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return 'S/ 0.00';
  const text = formatTaxAmountInput(n);
  const withDecimals = text.includes('.') ? text : `${text}.00`;
  return `S/ ${withDecimals}`;
}
