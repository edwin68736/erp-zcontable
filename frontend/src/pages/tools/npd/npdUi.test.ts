import { describe, expect, it } from 'vitest';
import type { NpdItem } from '../../../services/npd';
import { daysAgo, daysSpan, fmtDay, fmtMoney, isoDay, totalsByEstado } from './npdUi';

const item = (npd: string, cod: string, estado: string, importe: number): NpdItem => ({
  npd,
  ruc: '20111111111',
  razon_social: 'EMPRESA',
  fec_registro: '30/10/2026 11:12:01',
  fec_creacion: '30/10/2026',
  fec_limite_pago: '03/11/2026',
  estado,
  estado_cod: cod,
  importe,
});

describe('npdUi', () => {
  it('formatea fechas', () => {
    expect(isoDay(new Date(2026, 10, 7))).toBe('2026-11-07');
    expect(fmtDay('2026-10-30')).toBe('30/10/2026');
    expect(fmtDay('algo')).toBe('algo');
  });

  it('retrocede días desde una fecha dada', () => {
    const now = new Date(2026, 10, 7);
    expect(daysAgo(0, now)).toBe('2026-11-07');
    expect(daysAgo(7, now)).toBe('2026-10-31');
    expect(daysAgo(364, now)).toBe('2025-11-08');
  });

  it('cuenta los días del rango con ambas fechas incluidas', () => {
    expect(daysSpan('2026-11-07', '2026-11-07')).toBe(1);
    expect(daysSpan('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysSpan('2025-11-08', '2026-11-07')).toBe(365);
    expect(daysSpan('2026-11-08', '2026-11-07')).toBe(0);
    expect(daysSpan('', '2026-11-07')).toBe(0);
  });

  it('formatea importes en soles', () => {
    expect(fmtMoney(124)).toMatch(/^S\/\s124[.,]00$/);
    expect(fmtMoney(1282.5)).toMatch(/1[\s.,]?282[.,]50$/);
  });

  it('totaliza por estado, solo los que tienen NPD, y no pierde los estados desconocidos', () => {
    const r = totalsByEstado([item('1', '10', 'Pagado confirmado', 124), item('2', '00', 'Vigente', 583.5), item('3', '10', 'Pagado confirmado', 575), item('4', '99', 'Anulado', 10)]);
    expect(r.map((x) => [x.cod, x.count, x.importe])).toEqual([
      ['00', 1, 583.5],
      ['10', 2, 699],
      ['99', 1, 10],
    ]);
    expect(r[2].label).toBe('Anulado');
    expect(totalsByEstado([])).toEqual([]);
  });
});
