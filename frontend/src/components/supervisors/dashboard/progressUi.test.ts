import { describe, expect, it } from 'vitest';
import type { AssistantDigitProgress, AssistantModuleProgress, AssistantTrendPoint, IndicatorMailboxRow } from '../../../services/supervisors';
import { groupTrend, mailboxCompanies, mailboxSegments, moduleKpi } from './progressUi';

const dp = (digit: number, over: Partial<AssistantDigitProgress> = {}): AssistantDigitProgress => ({
  digit, total: 0, completed: 0, on_time: 0, late: 0, in_review: 0, pending: 0, overdue: 0, observed: 0, not_applicable: 0, pct: 0, ...over,
});
const mod = (byDigit: AssistantDigitProgress[], over: Partial<AssistantModuleProgress> = {}): AssistantModuleProgress => ({
  key: 'pdt_621_declaracion', label: 'x', owner: 'supervisor', total: 0, completed: 0, on_time: 0, late: 0, in_review: 0, pending: 0, overdue: 0, observed: 0, not_applicable: 0, pct: 0, by_digit: byDigit, ...over,
});

describe('tarjetas KPI desde el consolidado por dígito', () => {
  it('el % es a tiempo ÷ lo que ya tenía plazo; lo que sigue en plazo va aparte', () => {
    const k = moduleKpi(mod([dp(1, { total: 10, on_time: 6, late: 1, overdue: 1, pending: 2 }), dp(2, { total: 5, on_time: 4, pending: 1 })], { completed: 11, on_time: 10, late: 1 }));
    expect(k).toMatchObject({ onTime: 10, due: 12, pending: 4, upcoming: 3, total: 15, unused: false });
    expect(k.pct).toBe(83.3); // 10 de 12
  });

  it('sin nada medible no hay porcentaje, y un módulo que nadie usa se marca «aún no se usa»', () => {
    const k = moduleKpi(mod([dp(1, { total: 4, pending: 4 })], { pending: 4 }), { unusedWhenEmpty: true });
    expect(k.pct).toBeNull();
    expect(k.unused).toBe(true);
    expect(moduleKpi(undefined, { unusedWhenEmpty: true })).toMatchObject({ pct: null, unused: true, total: 0 });
    // Sin la opción, un módulo sin entregas no es «sin uso» (solo balances e informe de detracciones lo pueden ser).
    expect(moduleKpi(mod([dp(1, { total: 4, pending: 4 })])).unused).toBe(false);
  });
});

describe('avance de los últimos 6 meses', () => {
  const pts: AssistantTrendPoint[] = [
    { period_ym: '2026-06', pct: 0, total: 0, completed: 0 },
    { period_ym: '2026-07', pct: 50, total: 100, completed: 50 },
    { period_ym: '2026-08', pct: 80, total: 100, completed: 80 },
    { period_ym: '2026-09', pct: 60, total: 200, completed: 120 },
    { period_ym: '2026-10', pct: 90, total: 100, completed: 90 },
    { period_ym: '2026-11', pct: 70, total: 100, completed: 70 },
  ];

  it('mensual: un tramo por mes y el mes sin tareas queda sin dato', () => {
    const b = groupTrend(pts, 'mensual');
    expect(b.map((x) => x.label)).toEqual(['JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV']);
    expect(b[0].pct).toBeNull();
    expect(b[5].pct).toBe(70);
  });

  it('trimestral y semestral: completado ÷ aplicable de todo el tramo, no un promedio de porcentajes', () => {
    const q = groupTrend(pts, 'trimestral');
    expect(q.map((x) => x.label)).toEqual(['JUN–AGO', 'SET–NOV']);
    expect(q[0]).toMatchObject({ completed: 130, total: 200, pct: 65 });
    expect(q[1]).toMatchObject({ completed: 280, total: 400, pct: 70 });
    const s = groupTrend(pts, 'semestral');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ label: 'JUN–NOV', completed: 410, total: 600, pct: 68.3 });
  });

  it('con menos meses de los que cabe en el tramo, el primer tramo queda corto', () => {
    expect(groupTrend(pts.slice(2), 'trimestral').map((x) => x.label)).toEqual(['AGO', 'SET–NOV']);
    expect(groupTrend([], 'mensual')).toEqual([]);
  });
});

describe('buzones por asistente', () => {
  const row: IndicatorMailboxRow = {
    assistant: 'ANA', sunat_ok: 6, sunat_pending: 2, sunat_late: 1, sunafil_ok: 5, sunafil_pending: 0, sunafil_late: 3,
    companies: [
      { company_id: 1, company: 'Uno', ruc: '20100000013', sunat_pending: 2, sunat_late: 0, sunafil_pending: 0, sunafil_late: 1 },
      { company_id: 2, company: 'Dos', ruc: '20100000021', sunat_pending: 0, sunat_late: 1, sunafil_pending: 0, sunafil_late: 2 },
    ],
  };

  it('los tramos de cada buzón', () => {
    expect(mailboxSegments(row, 'sunat')).toEqual([{ state: 'ok', value: 6 }, { state: 'late', value: 1 }, { state: 'pending', value: 2 }]);
    expect(mailboxSegments(row, 'sunafil').map((s) => s.value)).toEqual([5, 3, 0]);
  });

  it('las empresas de un tramo con cuántas capturas tiene cada una', () => {
    expect(mailboxCompanies(row, 'sunat', 'pending').map((x) => [x.company.company, x.count])).toEqual([['Uno', 2]]);
    expect(mailboxCompanies(row, 'sunafil', 'late').map((x) => [x.company.company, x.count])).toEqual([['Uno', 1], ['Dos', 2]]);
    expect(mailboxCompanies(row, 'sunafil', 'pending')).toEqual([]);
    expect(mailboxCompanies({ ...row, companies: undefined }, 'sunat', 'late')).toEqual([]);
  });
});
