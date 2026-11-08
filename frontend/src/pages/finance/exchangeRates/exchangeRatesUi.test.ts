import { describe, expect, it } from 'vitest';
import type { ExchangeMonth, ExchangeRateDay } from '../../../services/exchangeRates';
import { buildRateWeeks, currentMonthKey, dateKey, fmtRate, monthKey, monthSummary, parseMonthKey, shiftMonth } from './exchangeRatesUi';

const day = (date: string, compra: number, venta: number): ExchangeRateDay => ({ currency: 'USD', date, compra, venta });

describe('exchangeRatesUi', () => {
  it('arma y lee la clave de mes', () => {
    expect(monthKey(2026, 5)).toBe('2026-05');
    expect(parseMonthKey('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('2026-1')).toBeNull();
    expect(currentMonthKey(new Date(2026, 10, 7))).toBe('2026-11');
    expect(dateKey(new Date(2026, 9, 3))).toBe('2026-10-03');
  });

  it('cambia de mes cruzando de año', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
    expect(shiftMonth('malo', 1)).toBe('malo');
  });

  it('muestra el tipo de cambio con 3 decimales', () => {
    expect(fmtRate(3.437)).toBe('3.437');
    expect(fmtRate(3.4)).toBe('3.400');
  });

  it('octubre de 2026 empieza en jueves, como el calendario de SUNAT (domingo a sábado)', () => {
    const weeks = buildRateWeeks(2026, 10, [day('2026-10-01', 3.429, 3.437), day('2026-10-03', 3.437, 3.442)]);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 27, 28, 29, 30 de setiembre de relleno y el 1 de octubre en jueves.
    expect(weeks[0].map((c) => [c.dayNum, c.inMonth])).toEqual([
      [27, false],
      [28, false],
      [29, false],
      [30, false],
      [1, true],
      [2, true],
      [3, true],
    ]);
    expect(weeks[0][4].rate?.compra).toBe(3.429);
    expect(weeks[0][5].rate).toBeUndefined();
    expect(weeks[0][6].rate?.venta).toBe(3.442);
    // Último día: sábado 31 y sin relleno.
    expect(weeks[4][6]).toMatchObject({ dayNum: 31, inMonth: true });
  });

  it('noviembre de 2026 termina con días de relleno de diciembre y no marca valores en ellos', () => {
    const weeks = buildRateWeeks(2026, 11, [day('2026-11-01', 3.458, 3.467), day('2026-12-01', 9, 9)]);
    expect(weeks[0][0]).toMatchObject({ dayNum: 1, inMonth: true });
    const last = weeks[weeks.length - 1];
    expect(last.map((c) => [c.dayNum, c.inMonth])).toEqual([
      [29, true],
      [30, true],
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
    ]);
    // Un valor de otro mes no se pinta en los días de relleno.
    expect(last[2].rate).toBeUndefined();
  });

  it('resume el rango del mes y no inventa nada si no hay datos', () => {
    const m: ExchangeMonth = { year: 2026, month: 10, currency: 'USD', days: [day('2026-10-01', 3.429, 3.437), day('2026-10-31', 3.458, 3.467), day('2026-10-02', 3.447, 3.454)], missing: [], fetched: 0 };
    expect(monthSummary(m)).toEqual({ count: 3, minCompra: 3.429, maxCompra: 3.458, minVenta: 3.437, maxVenta: 3.467 });
    expect(monthSummary({ ...m, days: [] })).toBeNull();
  });
});
