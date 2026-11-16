import { describe, expect, it } from 'vitest';
import type { AssistantDigitProgress, AssistantModuleRow, AssistantStudioOption } from '../../services/supervisors';
import { NO_FILTER, assistantsForSupervisor, countRows, deliveredText, digitRows, digitTotals, filterLabel, filterRows, fmtPct, isFiltered, pctTone, toggleFilter } from './moduleDigits';

const dp = (digit: number, over: Partial<AssistantDigitProgress> = {}): AssistantDigitProgress => ({
  digit, total: 0, completed: 0, on_time: 0, late: 0, in_review: 0, pending: 0, overdue: 0, observed: 0, not_applicable: 0, pct: 0, ...over,
});

describe('consolidado por dígito con porcentajes', () => {
  it('arma las columnas: vencidas incluyen las observadas vencidas y por vencer lo que sigue en plazo', () => {
    const [r] = digitRows([dp(3, { total: 20, on_time: 8, late: 2, overdue: 3, pending: 4, in_review: 1, observed: 2, observed_overdue: 1 })]);
    expect(r).toMatchObject({ digit: 3, total: 20, dentro: 8, fuera: 2, vencidas: 4, porVencer: 6, due: 14 });
    expect(r.pct).toBe(57.1); // 8 de los 14 que ya se pueden medir
  });

  it('un dígito sin nada vencido ni entregado no tiene porcentaje (no figura con 0 %)', () => {
    const [r] = digitRows([dp(7, { total: 10, pending: 10 })]);
    expect(r.pct).toBeNull();
    expect(r.porVencer).toBe(10);
    expect(pctTone(null).fg).toBe('#94A3B8');
  });

  it('todo entregado a tiempo es 100 %', () => {
    expect(digitRows([dp(4, { total: 9, on_time: 9 })])[0].pct).toBe(100);
  });

  it('el total suma los dígitos y calcula su propio porcentaje', () => {
    const rows = digitRows([dp(0, { total: 10, on_time: 9, late: 1 }), dp(1, { total: 10, on_time: 5, overdue: 5 }), dp(2, { total: 4, pending: 4 })]);
    const t = digitTotals(rows);
    expect(t).toMatchObject({ total: 24, dentro: 14, fuera: 1, vencidas: 5, porVencer: 4, due: 20 });
    expect(t.pct).toBe(70);
  });

  it('colores: verde en meta, ámbar hasta 10 puntos por debajo, rojo más abajo', () => {
    expect(pctTone(96).fg).toBe('#0A7A3B');
    expect(pctTone(95).fg).toBe('#0A7A3B');
    expect(pctTone(90).fg).toBe('#B45309');
    expect(pctTone(85).fg).toBe('#B45309');
    expect(pctTone(60).fg).toBe('#B91C1C');
    expect(fmtPct(100)).toBe('100%');
    expect(fmtPct(96.3)).toBe('96.3%');
  });
});

const row = (id: number, digit: number, bucket: AssistantModuleRow['bucket']): AssistantModuleRow => ({ company_id: id, company: `Empresa ${id}`, ruc: `2010000000${digit}`, digit, state: 'pendiente', bucket });

describe('filtrar las empresas al pulsar un número', () => {
  const rows = [row(1, 3, 'vencida'), row(2, 3, 'fuera'), row(3, 1, 'vencida'), row(4, 3, 'por_vencer'), row(5, 1, 'dentro')];

  it('por dígito y categoría, solo por categoría (columna Total) o solo por dígito', () => {
    expect(filterRows(rows, { digit: 3, bucket: 'vencida' }).map((r) => r.company_id)).toEqual([1]);
    expect(filterRows(rows, { digit: null, bucket: 'vencida' }).map((r) => r.company_id)).toEqual([1, 3]);
    expect(filterRows(rows, { digit: 3, bucket: null }).map((r) => r.company_id)).toEqual([1, 2, 4]);
    expect(filterRows(rows, NO_FILTER)).toHaveLength(5);
    expect(countRows(rows, { digit: 1, bucket: 'dentro' })).toBe(1);
  });

  it('pulsar la misma celda otra vez quita el filtro', () => {
    const f = toggleFilter(NO_FILTER, { digit: 3, bucket: 'fuera' });
    expect(isFiltered(f)).toBe(true);
    expect(toggleFilter(f, { digit: 3, bucket: 'fuera' })).toEqual(NO_FILTER);
    expect(toggleFilter(f, { digit: 3, bucket: 'vencida' })).toEqual({ digit: 3, bucket: 'vencida' });
  });

  it('el chip dice qué se está viendo', () => {
    expect(filterLabel({ digit: 3, bucket: 'fuera' })).toBe('RUC termina en 3 · Fuera de plazo');
    expect(filterLabel({ digit: null, bucket: 'vencida' })).toBe('Vencidas');
    expect(filterLabel(NO_FILTER)).toBe('');
  });

  it('fecha de entrega', () => {
    expect(deliveredText({ delivered_at: '2026-07-20', bucket: 'fuera' }, 'Declaró')).toBe('Declaró el 20/07/2026');
    expect(deliveredText({ bucket: 'vencida' }, 'Declaró')).toBe('');
  });
});

describe('asistentes del supervisor elegido', () => {
  const asst: AssistantStudioOption[] = [
    { user_id: 1, name: 'Ana', companies: 3, supervisors: [{ user_id: 10, companies: 2 }, { user_id: 11, companies: 1 }] },
    { user_id: 2, name: 'Luis', companies: 1, supervisors: [{ user_id: 10, companies: 1 }] },
    { user_id: 3, name: 'Eva', companies: 1, supervisors: [{ user_id: 11, companies: 1 }] },
    { user_id: 4, name: 'Sin datos', companies: 2 },
  ];

  it('sin supervisor se ofrecen todos', () => {
    expect(assistantsForSupervisor(asst, null)).toHaveLength(4);
  });

  it('con supervisor solo los suyos, con el número de empresas de ese supervisor', () => {
    const r = assistantsForSupervisor(asst, 10);
    expect(r.map((a) => [a.name, a.companies])).toEqual([['Ana', 2], ['Luis', 1]]);
    expect(assistantsForSupervisor(asst, 11).map((a) => a.name)).toEqual(['Ana', 'Eva']);
    expect(assistantsForSupervisor(asst, 99)).toEqual([]);
  });
});
