import { digitRows, digitTotals, type DigitRow } from '../../assistant/moduleDigits';
import type { AssistantModuleProgress, AssistantTrendPoint, IndicatorMailboxCompany, IndicatorMailboxRow } from '../../../services/supervisors';

/** Los números de una tarjeta KPI, con las mismas reglas del consolidado por dígito del panel del asistente. */
export interface ModuleKpi {
  /** % de cumplimiento = a tiempo ÷ lo que ya tenía plazo cumplido; null si todavía no hay nada que medir. */
  pct: number | null;
  /** Lo ya medible (a tiempo + fuera de plazo + pendiente con el plazo pasado). */
  due: number;
  onTime: number;
  /** Todo lo no entregado (haya vencido o no su plazo). */
  pending: number;
  /** De lo pendiente, lo que aún está en plazo (no baja el %). */
  upcoming: number;
  total: number;
  /** Nadie lo entrega todavía (solo el KPI 5): se muestra «aún no se usa» en vez de 0 %. */
  unused: boolean;
}

/** Totales de un módulo (los de la fila «Total» de su consolidado por dígito). */
export function moduleKpi(m: AssistantModuleProgress | undefined): ModuleKpi {
  const rows: DigitRow[] = m?.by_digit && m.by_digit.length > 0 ? digitRows(m.by_digit) : [];
  const t = digitTotals(rows);
  return { pct: t.pct, due: t.due, onTime: t.dentro, pending: t.pendientes, upcoming: t.pendientes - t.conPlazoPasado, total: t.total, unused: false };
}

/**
 * KPI 5 (revisión de balances, meta 100 %): revisados ÷ los que aplican. No usa el plazo como los otros KPI: un balance revisado cuenta
 * aunque se haya entregado tarde, y uno sin revisar baja el porcentaje aunque aún no venza.
 */
export function reviewKpi(m: AssistantModuleProgress | undefined): ModuleKpi {
  const total = m?.total ?? 0;
  const done = m?.completed ?? 0;
  const empty = !m || m.completed + m.in_review + m.observed === 0;
  return { pct: total > 0 ? Math.round((done / total) * 1000) / 10 : null, due: total, onTime: done, pending: total - done, upcoming: 0, total, unused: empty };
}

export type TrendMode = 'mensual' | 'trimestral' | 'semestral';

export interface TrendBar {
  label: string;
  /** null = sin tareas medidas en ese tramo. */
  pct: number | null;
  completed: number;
  total: number;
}

const MONTH_ABBR = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
const monthAbbr = (ym: string) => MONTH_ABBR[Number(ym.slice(5, 7)) - 1] ?? ym;

/**
 * El avance de los últimos meses agrupado: por mes, por trimestre (de 3 en 3 hasta el mes que se ve) o todo el semestre. El % de un
 * tramo es lo completado ÷ lo que aplicaba en todo el tramo (no un promedio de porcentajes). Un tramo sin tareas medidas no es 0 %.
 */
export function groupTrend(points: AssistantTrendPoint[], mode: TrendMode): TrendBar[] {
  const size = mode === 'mensual' ? 1 : mode === 'trimestral' ? 3 : 6;
  const groups: AssistantTrendPoint[][] = [];
  // Se agrupa desde el último mes (el que se está viendo) hacia atrás; el primer tramo puede quedar incompleto.
  for (let end = points.length; end > 0; end -= size) groups.unshift(points.slice(Math.max(0, end - size), end));
  return groups.map((g) => {
    const total = g.reduce((a, p) => a + p.total, 0);
    const completed = g.reduce((a, p) => a + p.completed, 0);
    const first = monthAbbr(g[0].period_ym);
    const last = monthAbbr(g[g.length - 1].period_ym);
    return { label: g.length === 1 ? first : `${first}–${last}`, pct: total > 0 ? Math.round((completed / total) * 1000) / 10 : null, completed, total };
  });
}

export type MailboxKind = 'sunat' | 'sunafil';
export type MailboxState = 'ok' | 'late' | 'pending';

/** Los tres tramos de la barra de un buzón de un asistente. */
export function mailboxSegments(r: IndicatorMailboxRow, kind: MailboxKind): { state: MailboxState; value: number }[] {
  return kind === 'sunat'
    ? [
        { state: 'ok', value: r.sunat_ok },
        { state: 'late', value: r.sunat_late },
        { state: 'pending', value: r.sunat_pending },
      ]
    : [
        { state: 'ok', value: r.sunafil_ok },
        { state: 'late', value: r.sunafil_late },
        { state: 'pending', value: r.sunafil_pending },
      ];
}

/** Las empresas detrás de un tramo (pendiente o fuera de plazo) de un buzón, con cuántas capturas tiene cada una en ese estado. */
export function mailboxCompanies(r: IndicatorMailboxRow, kind: MailboxKind, state: 'late' | 'pending'): { company: IndicatorMailboxCompany; count: number }[] {
  const pick = (c: IndicatorMailboxCompany) => (kind === 'sunat' ? (state === 'late' ? c.sunat_late : c.sunat_pending) : state === 'late' ? c.sunafil_late : c.sunafil_pending);
  return (r.companies ?? []).map((company) => ({ company, count: pick(company) })).filter((x) => x.count > 0);
}
