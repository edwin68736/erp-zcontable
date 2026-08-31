import { describe, expect, it } from 'vitest';
import {
  computeTaxSettlementSections,
  defaultTaxSections,
  getPdt621IgvNetAfterDetraction,
  getPdt621IgvPendienteSigned,
  getPdt621RentaPayableBeforeDetraction,
  getPdt621SyncTotals,
  type TaxSectionPdt621,
  type TaxSettlementSectionsPayload,
} from './taxSettlementSections';

/** Liquidación con la sección PDT 621 habilitada y overrides aplicados, ya recalculada. */
function buildPdt621(overrides: Partial<TaxSectionPdt621>): TaxSettlementSectionsPayload {
  const base = defaultTaxSections();
  return computeTaxSettlementSections({
    ...base,
    pdt621: { ...base.pdt621!, enabled: true, ...overrides },
  });
}

describe('getPdt621SyncTotals — sincronización hacia el Control de Vencimientos PDT 621', () => {
  it('total_ventas suma base + no gravadas de ventas menos notas, en la tasa única de la empresa (18%)', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 1000, no_gravadas: 100, impuesto: 180, total: 1280 },
      compras_18: { base: 400, no_gravadas: 0, impuesto: 72, total: 472 },
    });
    const totals = getPdt621SyncTotals(p.pdt621!);
    expect(totals.total_ventas).toBe(1100); // 1000 + 100
  });

  it('total_ventas suma ambas tasas cuando la liquidación tiene 18% y 10.5% activos', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18, 10.5],
      ventas_netas_18: { base: 1000, no_gravadas: 0, impuesto: 180, total: 1180 },
      ventas_netas_105: { base: 500, no_gravadas: 0, impuesto: 52.5, total: 552.5 },
    });
    const totals = getPdt621SyncTotals(p.pdt621!);
    expect(totals.total_ventas).toBe(1500);
  });

  it('total_ventas netea notas de crédito contra ventas, sin bajar de cero', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 1000, no_gravadas: 0, impuesto: 180, total: 1180 },
      notas_credito_18: { base: 1500, no_gravadas: 0, impuesto: 270, total: 1770 },
    });
    const totals = getPdt621SyncTotals(p.pdt621!);
    expect(totals.total_ventas).toBe(0); // 1000 - 1500 clamp a 0, nunca negativo
  });

  it('total_compras suma las 4 bases: base imponible (18% + 10.5%) más no gravadas (18% + 10.5%)', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18, 10.5],
      compras_18: { base: 400, no_gravadas: 50, impuesto: 72, total: 522 },
      compras_105: { base: 200, no_gravadas: 30, impuesto: 21, total: 251 },
    });
    const totals = getPdt621SyncTotals(p.pdt621!);
    expect(totals.total_compras).toBe(680); // 400 + 200 + 50 + 30
  });

  it('total_compras solo cuenta la base gravada cuando no hay monto no gravado', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      compras_18: { base: 400, no_gravadas: 0, impuesto: 72, total: 472 },
    });
    const totals = getPdt621SyncTotals(p.pdt621!);
    expect(totals.total_compras).toBe(400);
  });
});

describe('getPdt621RentaPayableBeforeDetraction — Renta sincronizada (declarada, nunca negativa)', () => {
  it('devuelve la renta declarada del periodo, sin restar la detracción aplicada', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 10000, no_gravadas: 0, impuesto: 1800, total: 11800 },
      renta_regimen: 'mype',
      detraction_payment_renta: { enabled: true, mode: 'total', amount: 0, applied_amount: 0, original_amount: 0 },
    });
    // Régimen MYPE: 1% de la base de ventas netas (10000) = 100.
    const rentaDeclarada = getPdt621RentaPayableBeforeDetraction(p.pdt621!);
    expect(rentaDeclarada).toBe(100);
    expect(p.pdt621!.renta_impuesto_a_pagar).toBe(100);
  });
});

describe('getPdt621IgvPendienteSigned — IGV sincronizado (pendiente, CON signo)', () => {
  it('cuando hay impuesto a pagar y no hay detracción, es igual al IGV pendiente normal (positivo)', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 10000, no_gravadas: 0, impuesto: 1800, total: 11800 },
      compras_18: { base: 0, no_gravadas: 0, impuesto: 0, total: 0 },
    });
    expect(getPdt621IgvPendienteSigned(p.pdt621!)).toBe(1800);
    expect(getPdt621IgvPendienteSigned(p.pdt621!)).toBe(getPdt621IgvNetAfterDetraction(p.pdt621!));
  });

  it('resta la detracción aplicada, igual que el IGV pendiente normal, cuando el saldo es positivo', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 10000, no_gravadas: 0, impuesto: 1800, total: 11800 },
      compras_18: { base: 0, no_gravadas: 0, impuesto: 0, total: 0 },
      detraction_payment_igv: { enabled: true, mode: 'total', amount: 0, applied_amount: 0, original_amount: 0 },
    });
    // Detracción "total" cubre el 100% del pago en efectivo → pendiente = 0.
    expect(getPdt621IgvPendienteSigned(p.pdt621!)).toBe(0);
    expect(getPdt621IgvPendienteSigned(p.pdt621!)).toBe(getPdt621IgvNetAfterDetraction(p.pdt621!));
  });

  it('devuelve el saldo a favor EN NEGATIVO cuando el periodo cierra sin impuesto a pagar (a diferencia del IGV pendiente normal, que lo recorta a 0)', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 1000, no_gravadas: 0, impuesto: 180, total: 1180 },
      compras_18: { base: 5000, no_gravadas: 0, impuesto: 900, total: 5900 },
    });
    expect(p.pdt621!.saldo_favor_final).toBe(-720); // 180 - 900
    expect(getPdt621IgvPendienteSigned(p.pdt621!)).toBe(-720);
    expect(getPdt621IgvNetAfterDetraction(p.pdt621!)).toBe(0); // el helper existente sigue recortando a 0
  });
});
