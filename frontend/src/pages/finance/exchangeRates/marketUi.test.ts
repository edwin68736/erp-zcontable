import { describe, expect, it } from 'vitest';
import type { MarketPoint } from '../../../services/exchangeRates';
import { chartGeometry, convert, fmtConverted, fmtMarketRate, parseAmount, sliceRange } from './marketUi';

const days = (n: number, end = '2026-11-10'): MarketPoint[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(`${end}T00:00:00Z`) - (n - 1 - i) * 86400000);
    return { date: d.toISOString().slice(0, 10), value: 3.4 + (i % 7) * 0.01 };
  });

describe('sliceRange', () => {
  const pts = days(400);
  it('5D son los últimos 5 puntos', () => {
    const r = sliceRange(pts, '5D');
    expect(r).toHaveLength(5);
    expect(r[4].date).toBe('2026-11-10');
  });
  it('1M, 6M y 1A cortan por días corridos hasta el último dato', () => {
    expect(sliceRange(pts, '1M')).toHaveLength(31);
    expect(sliceRange(pts, '6M')).toHaveLength(183);
    expect(sliceRange(pts, '1A')).toHaveLength(366);
  });
  it('con poca historia devuelve lo que hay', () => {
    expect(sliceRange(days(3), '1A')).toHaveLength(3);
    expect(sliceRange([], '1M')).toEqual([]);
  });
});

describe('convert y parseAmount', () => {
  it('convierte en los dos sentidos', () => {
    expect(convert(100, 3.4, 'usd')).toBeCloseTo(340);
    expect(convert(340, 3.4, 'pen')).toBeCloseTo(100);
    expect(Number.isNaN(convert(1, 0, 'usd'))).toBe(true);
    expect(Number.isNaN(convert(NaN, 3.4, 'pen'))).toBe(true);
  });
  it('lee importes con coma o punto', () => {
    expect(parseAmount('1')).toBe(1);
    expect(parseAmount('1,250.50')).toBe(1250.5);
    expect(parseAmount('1.250,50')).toBe(1250.5);
    expect(parseAmount('1250,5')).toBe(1250.5);
    expect(parseAmount('1,250')).toBe(1250);
    expect(parseAmount(' 2 500.5 ')).toBe(2500.5);
    expect(parseAmount('0.')).toBe(0);
    for (const bad of ['', 'abc', '1.2.3', '-5']) expect(Number.isNaN(parseAmount(bad))).toBe(true);
  });
  it('da formato', () => {
    expect(fmtConverted(1250.5)).toBe('1,250.50');
    expect(fmtConverted(NaN)).toBe('');
    expect(fmtMarketRate(3.4149)).toBe('3.415');
    expect(fmtMarketRate(NaN)).toBe('—');
  });
});

describe('chartGeometry', () => {
  it('necesita al menos 2 puntos', () => {
    expect(chartGeometry([], 560, 220)).toBeNull();
    expect(chartGeometry(days(1), 560, 220)).toBeNull();
  });
  it('dibuja dentro del recuadro y marca ejes', () => {
    const g = chartGeometry(days(30), 560, 220)!;
    expect(g.coords).toHaveLength(30);
    expect(g.coords[0].x).toBeCloseTo(44);
    expect(g.coords[29].x).toBeCloseTo(560 - 12);
    for (const c of g.coords) {
      expect(c.y).toBeGreaterThanOrEqual(10);
      expect(c.y).toBeLessThanOrEqual(220 - 24);
    }
    expect(g.line.startsWith('M')).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
    expect(g.yTicks).toHaveLength(4);
    expect(g.xTicks).toHaveLength(4);
    expect(g.xTicks[3].label).toBe('10/11');
  });
  it('una serie plana no divide por cero', () => {
    const flat = days(5).map((p) => ({ ...p, value: 3.4 }));
    const g = chartGeometry(flat, 560, 220)!;
    expect(g.coords.every((c) => Number.isFinite(c.y))).toBe(true);
  });
});
