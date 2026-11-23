import { describe, expect, it } from 'vitest';
import type { AssistantDigitProgress, AssistantModuleRow, AssistantStudioOption } from '../../services/supervisors';
import { NO_FILTER, assistantsForSupervisor, countRows, deliveredText, digitRows, digitTotals, filterLabel, filterRows, fmtPct, isFiltered, moduleSummary, pctTone, toggleFilter } from './moduleDigits';

const dp = (digit: number, over: Partial<AssistantDigitProgress> = {}): AssistantDigitProgress => ({
  digit, total: 0, completed: 0, on_time: 0, late: 0, in_review: 0, pending: 0, overdue: 0, observed: 0, not_applicable: 0, pct: 0, ...over,
});

describe('consolidado por dígito con porcentajes', () => {
  it('arma las columnas: todo lo no entregado es pendiente (haya vencido o no su plazo); el % cuenta contra lo que ya tenía plazo cumplido', () => {
    const [r] = digitRows([dp(3, { total: 20, on_time: 8, late: 2, overdue: 3, pending: 4, in_review: 1, observed: 2, observed_overdue: 1 })]);
    expect(r).toMatchObject({ digit: 3, total: 20, dentro: 8, fuera: 2, pendientes: 10, conPlazoPasado: 4, due: 14 });
    expect(r.dentro + r.fuera + r.pendientes).toBe(r.total); // cada tarea está en una sola columna
    expect(r.pct).toBe(57.1); // 8 de los 14 que ya se pueden medir
  });

  it('un dígito sin nada vencido ni entregado no tiene porcentaje (no figura con 0 %)', () => {
    const [r] = digitRows([dp(7, { total: 10, pending: 10 })]);
    expect(r.pct).toBeNull();
    expect(r.pendientes).toBe(10);
    expect(pctTone(null).fg).toBe('#94A3B8');
  });

  it('todo entregado a tiempo es 100 %', () => {
    expect(digitRows([dp(4, { total: 9, on_time: 9 })])[0].pct).toBe(100);
  });

  it('el total suma los dígitos y calcula su propio porcentaje', () => {
    const rows = digitRows([dp(0, { total: 10, on_time: 9, late: 1 }), dp(1, { total: 10, on_time: 5, overdue: 5 }), dp(2, { total: 4, pending: 4 })]);
    const t = digitTotals(rows);
    expect(t).toMatchObject({ total: 24, dentro: 14, fuera: 1, pendientes: 9, conPlazoPasado: 5, due: 20 });
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
  const rows = [row(1, 3, 'pendiente'), row(2, 3, 'fuera'), row(3, 1, 'pendiente'), row(4, 3, 'pendiente'), row(5, 1, 'dentro')];

  it('por dígito y categoría, solo por categoría (columna Total) o solo por dígito', () => {
    expect(filterRows(rows, { digit: 3, bucket: 'fuera' }).map((r) => r.company_id)).toEqual([2]);
    expect(filterRows(rows, { digit: null, bucket: 'pendiente' }).map((r) => r.company_id)).toEqual([1, 3, 4]);
    expect(filterRows(rows, { digit: 3, bucket: null }).map((r) => r.company_id)).toEqual([1, 2, 4]);
    expect(filterRows(rows, NO_FILTER)).toHaveLength(5);
    expect(countRows(rows, { digit: 1, bucket: 'dentro' })).toBe(1);
  });

  it('pulsar la misma celda otra vez quita el filtro', () => {
    const f = toggleFilter(NO_FILTER, { digit: 3, bucket: 'fuera' });
    expect(isFiltered(f)).toBe(true);
    expect(toggleFilter(f, { digit: 3, bucket: 'fuera' })).toEqual(NO_FILTER);
    expect(toggleFilter(f, { digit: 3, bucket: 'pendiente' })).toEqual({ digit: 3, bucket: 'pendiente' });
  });

  it('el chip dice qué se está viendo', () => {
    expect(filterLabel({ digit: 3, bucket: 'fuera' })).toBe('RUC termina en 3 · Fuera de plazo');
    expect(filterLabel({ digit: null, bucket: 'pendiente' })).toBe('Pendientes');
    expect(filterLabel(NO_FILTER)).toBe('');
  });

  it('fecha de entrega', () => {
    expect(deliveredText({ delivered_at: '2026-07-20', bucket: 'fuera' }, 'Declaró')).toBe('Declaró el 20/07/2026');
    expect(deliveredText({ bucket: 'pendiente' }, 'Declaró')).toBe('');
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

describe('resumen del módulo en empresas', () => {
  it('empresas completas de empresas, y las que faltan', () => {
    expect(moduleSummary({ companies: 255, companies_done: 0, total: 255, completed: 0 })).toEqual({ text: '0 de 255 empresas completadas', left: 255 });
    expect(moduleSummary({ companies: 72, companies_done: 19, total: 72, completed: 19 })).toEqual({ text: '19 de 72 empresas completadas', left: 53 });
    expect(moduleSummary({ companies: 1, companies_done: 1, total: 1, completed: 1 })).toEqual({ text: '1 de 1 empresa completada', left: 0 });
  });

  it('con varias tareas por empresa cuentan las empresas, no las tareas', () => {
    // Preliminar de ventas: 2 entregas por empresa. 10 empresas = 20 tareas; 6 entregas hechas, pero solo 2 empresas las tienen las dos.
    expect(moduleSummary({ companies: 10, companies_done: 2, total: 20, completed: 6 })).toEqual({ text: '2 de 10 empresas completadas', left: 8 });
  });

  it('sin el dato de empresas se cae a las tareas', () => {
    expect(moduleSummary({ total: 30, completed: 12 })).toEqual({ text: '12 de 30 tareas completadas', left: 18 });
  });
});

describe('Buzón SOL: varias capturas por empresa', () => {
  const buzon = (id: number, digit: number, counts: { dentro: number; fuera: number; pendiente: number }): AssistantModuleRow => ({
    company_id: id, company: `Empresa ${id}`, ruc: `2010000000${digit}`, digit, state: 'pendiente', bucket: counts.pendiente > 0 ? 'pendiente' : counts.fuera > 0 ? 'fuera' : 'dentro', counts,
  });

  it('una empresa entra en cada categoría en la que tenga alguna captura', () => {
    const rows = [buzon(1, 3, { dentro: 6, fuera: 1, pendiente: 1 }), buzon(2, 3, { dentro: 8, fuera: 0, pendiente: 0 }), buzon(3, 5, { dentro: 0, fuera: 2, pendiente: 0 })];
    expect(filterRows(rows, { digit: null, bucket: 'pendiente' }).map((r) => r.company_id)).toEqual([1]);
    expect(filterRows(rows, { digit: null, bucket: 'fuera' }).map((r) => r.company_id)).toEqual([1, 3]);
    expect(filterRows(rows, { digit: null, bucket: 'dentro' }).map((r) => r.company_id)).toEqual([1, 2]);
    expect(filterRows(rows, { digit: 3, bucket: 'dentro' }).map((r) => r.company_id)).toEqual([1, 2]);
    expect(filterRows(rows, { digit: 5, bucket: 'pendiente' })).toEqual([]);
  });
});
