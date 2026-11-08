import { describe, expect, it } from 'vitest';
import type { ItfTable } from '../../../services/itf';
import { addMonths, colIndex, monthToPeriod, monthsBetween, parseAmount, periodLabel, periodToMonth, summarizeByPeriod } from './itfUi';

const table: ItfTable = {
  titulo: 'Movimientos Acumulados',
  columnas: ['RUC', 'Declarante', 'Período', 'Tipo', 'Cod. Oper.', 'Base', 'Impuesto'],
  filas: [
    ['20100000001', 'BANCO UNO', '202606', 'Afecta', '13', '16,000.00', '0.80'],
    ['20100000001', 'BANCO UNO', '202605', 'Afecta', '13', '1,000.00', '0.05'],
    ['20100000001', 'BANCO UNO', '202606', 'Afecta', '15', '13,000.00', '0.65'],
  ],
  registros: 3,
};

describe('itfUi', () => {
  it('convierte períodos y meses', () => {
    expect(periodLabel('202605')).toBe('05/2026');
    expect(periodLabel('xx')).toBe('xx');
    expect(monthToPeriod('2026-05')).toBe('202605');
    expect(periodToMonth('202605')).toBe('2026-05');
    expect(periodToMonth('')).toBe('');
  });

  it('suma y resta meses cruzando de año', () => {
    expect(addMonths('2026-11', -5)).toBe('2026-06');
    expect(addMonths('2026-02', -5)).toBe('2025-09');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });

  it('cuenta los meses del rango (ambos incluidos)', () => {
    expect(monthsBetween('2026-01', '2026-01')).toBe(1);
    expect(monthsBetween('2025-11', '2026-02')).toBe(4);
    expect(monthsBetween('2026-03', '2026-01')).toBe(0);
    expect(monthsBetween('', '2026-01')).toBe(0);
  });

  it('lee importes con separador de miles', () => {
    expect(parseAmount('1,000.00')).toBe(1000);
    expect(parseAmount('0.05')).toBe(0.05);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
  });

  it('encuentra columnas sin importar tildes ni mayúsculas', () => {
    expect(colIndex(table, 'periodo')).toBe(2);
    expect(colIndex(table, 'Cod. Oper.')).toBe(4);
    expect(colIndex(table, 'no existe')).toBe(-1);
  });

  it('resume por período, ordenado, con base, impuesto y operaciones', () => {
    const r = summarizeByPeriod(table);
    expect(r.map((x) => x.periodo)).toEqual(['202605', '202606']);
    expect(r[1]).toMatchObject({ operaciones: 2, base: 29000 });
    expect(r[1].impuesto).toBeCloseTo(1.45, 5);
    expect(summarizeByPeriod({ ...table, columnas: ['A', 'B'] })).toEqual([]);
  });
});
