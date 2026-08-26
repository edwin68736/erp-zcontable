import { describe, expect, it } from 'vitest';
import {
  computeTaxSettlementSections,
  defaultTaxSections,
  getPdt621IgvNetAfterDetraction,
  getPdt621IgvPayableBeforeDetraction,
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
  it('suma base + no gravadas de ventas y compras en la tasa única de la empresa (18%)', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 1000, no_gravadas: 100, impuesto: 180, total: 1280 },
      compras_18: { base: 400, no_gravadas: 0, impuesto: 72, total: 472 },
    });
    const totals = getPdt621SyncTotals(p.pdt621!);
    expect(totals.total_ventas).toBe(1100); // 1000 + 100
    expect(totals.total_compras).toBe(400);
  });

  it('suma ambas tasas cuando la liquidación tiene 18% y 10.5% activos', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18, 10.5],
      ventas_netas_18: { base: 1000, no_gravadas: 0, impuesto: 180, total: 1180 },
      ventas_netas_105: { base: 500, no_gravadas: 0, impuesto: 52.5, total: 552.5 },
      compras_18: { base: 300, no_gravadas: 0, impuesto: 54, total: 354 },
      compras_105: { base: 200, no_gravadas: 0, impuesto: 21, total: 221 },
    });
    const totals = getPdt621SyncTotals(p.pdt621!);
    expect(totals.total_ventas).toBe(1500);
    expect(totals.total_compras).toBe(500);
  });

  it('neteo notas de crédito contra ventas, sin bajar de cero', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 1000, no_gravadas: 0, impuesto: 180, total: 1180 },
      notas_credito_18: { base: 1500, no_gravadas: 0, impuesto: 270, total: 1770 },
    });
    const totals = getPdt621SyncTotals(p.pdt621!);
    expect(totals.total_ventas).toBe(0); // 1000 - 1500 clamp a 0, nunca negativo
  });
});

describe('getPdt621IgvPayableBeforeDetraction / getPdt621RentaPayableBeforeDetraction — Opción A (declarado)', () => {
  it('devuelve el IGV declarado del periodo, sin restar la detracción aplicada', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 10000, no_gravadas: 0, impuesto: 1800, total: 11800 },
      compras_18: { base: 0, no_gravadas: 0, impuesto: 0, total: 0 },
      detraction_payment_igv: { enabled: true, mode: 'total', amount: 0, applied_amount: 0, original_amount: 0 },
    });
    const igvDeclarado = getPdt621IgvPayableBeforeDetraction(p.pdt621!);
    // El IGV "declarado" (antes de detracción) debe coincidir con impuesto_periodo (1800),
    // independientemente de que la detracción cubra el 100% del pago en efectivo.
    expect(igvDeclarado).toBe(1800);
    expect(getPdt621IgvNetAfterDetraction(p.pdt621!)).toBe(0); // detracción "total" cubre todo el pago en efectivo
    expect(igvDeclarado).not.toBe(getPdt621IgvNetAfterDetraction(p.pdt621!));
  });

  it('devuelve 0 cuando el periodo cierra con saldo a favor (no hay IGV que declarar como pagable)', () => {
    const p = buildPdt621({
      igv_aplicable_ventas: [18],
      ventas_netas_18: { base: 1000, no_gravadas: 0, impuesto: 180, total: 1180 },
      compras_18: { base: 5000, no_gravadas: 0, impuesto: 900, total: 5900 },
    });
    expect(getPdt621IgvPayableBeforeDetraction(p.pdt621!)).toBe(0);
  });

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
