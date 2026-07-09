/** Régimen tributario registrado en la empresa (SUNAT). */
export type CompanyTaxRegime = 'mype' | 'rer' | 'general';

/** Régimen para cálculo de renta en una liquidación (incluye coeficiente manual). */
export type LiquidationRentaRegime = CompanyTaxRegime | 'coeficiente';

export const COMPANY_TAX_REGIME_OPTIONS: ReadonlyArray<{ value: CompanyTaxRegime; label: string }> = [
  { value: 'mype', label: 'MYPE Tributario (RMT)' },
  { value: 'rer', label: 'RER — Régimen Especial de Renta' },
  { value: 'general', label: 'Régimen General' },
];

export const LIQUIDATION_RENTA_REGIME_OPTIONS: ReadonlyArray<{
  value: LiquidationRentaRegime;
  label: string;
  sunatRate?: number;
}> = [
  { value: 'mype', label: 'MYPE Tributario (RMT)', sunatRate: 1 },
  { value: 'rer', label: 'RER', sunatRate: 1.5 },
  { value: 'general', label: 'Régimen General', sunatRate: 1.5 },
  { value: 'coeficiente', label: 'Coeficiente' },
];

/** Tasas de pago a cuenta mensual según SUNAT (sin coeficiente). */
export const SUNAT_RENTA_RATE_BY_REGIME: Record<CompanyTaxRegime, number> = {
  /** Ingresos netos anuales ≤ 300 UIT (RMT). */
  mype: 1,
  /** Cuota fija RER sobre ingresos netos mensuales. */
  rer: 1.5,
  /** Pago a cuenta mínimo (el mayor entre coeficiente o 1.5 %). */
  general: 1.5,
};

export function normalizeCompanyTaxRegime(raw?: string | null): CompanyTaxRegime | '' {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'mype' || s === 'rmt') return 'mype';
  if (s === 'rer') return 'rer';
  if (s === 'general' || s === 'rg') return 'general';
  return '';
}

export function parseCompanyTaxRegime(raw?: string | null): CompanyTaxRegime | null {
  const n = normalizeCompanyTaxRegime(raw);
  return n || null;
}

export function parseLiquidationRentaRegime(raw?: string | null): LiquidationRentaRegime | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'coeficiente') return 'coeficiente';
  const company = normalizeCompanyTaxRegime(s);
  return company || null;
}

export function formatCompanyTaxRegimeLabel(regime: CompanyTaxRegime): string {
  return COMPANY_TAX_REGIME_OPTIONS.find((o) => o.value === regime)?.label ?? regime;
}

export function formatLiquidationRentaRegimeLabel(regime: LiquidationRentaRegime): string {
  return LIQUIDATION_RENTA_REGIME_OPTIONS.find((o) => o.value === regime)?.label ?? regime;
}

export function defaultLiquidationRentaRegime(companyRegime: CompanyTaxRegime): LiquidationRentaRegime {
  return companyRegime;
}

/** Porcentaje aplicable a ingresos netos para renta mensual. */
export function getRentaMensualRatePct(
  regimen: LiquidationRentaRegime | undefined,
  coeficientePct?: number,
  fallbackCompanyRegime?: CompanyTaxRegime | null,
): number {
  const r =
    parseLiquidationRentaRegime(regimen) ??
    (fallbackCompanyRegime ? defaultLiquidationRentaRegime(fallbackCompanyRegime) : 'rer');
  if (r === 'coeficiente') {
    const pct = Number(coeficientePct);
    return Number.isFinite(pct) && pct > 0 ? pct : 0;
  }
  return SUNAT_RENTA_RATE_BY_REGIME[r];
}

export function formatRentaRateLabel(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '—';
  const text = pct.toFixed(4).replace(/\.?0+$/, '');
  return `${text} %`;
}
