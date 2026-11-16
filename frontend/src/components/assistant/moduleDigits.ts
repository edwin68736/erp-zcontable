import type { AssistantBucket, AssistantDigitProgress, AssistantModuleRow, AssistantStudioOption } from '../../services/supervisors';

/** Meta de cumplimiento (la misma que los indicadores del dashboard del supervisor). */
export const PLAZO_META = 95;

/** Una fila del consolidado por último dígito del RUC, con las columnas que se ven y se pueden pulsar. */
export interface DigitRow {
  digit: number;
  total: number;
  dentro: number;
  fuera: number;
  /** Sin entregar y con el plazo vencido (incluye las observadas ya vencidas). */
  vencidas: number;
  /** Aún en plazo: pendientes, en revisión del supervisor y observadas en plazo. */
  porVencer: number;
  /** Lo que ya se puede medir: entregado a tiempo + fuera de plazo + vencido. */
  due: number;
  /** % de cumplimiento = a tiempo ÷ lo medible; null si todavía no hay nada que medir (no vence nada). */
  pct: number | null;
}

export const emptyDigitRow = (digit: number): DigitRow => ({ digit, total: 0, dentro: 0, fuera: 0, vencidas: 0, porVencer: 0, due: 0, pct: null });

const pctOf = (dentro: number, due: number): number | null => (due > 0 ? Math.round((dentro / due) * 1000) / 10 : null);

/** El consolidado por dígito del servidor, en las columnas de la tabla. */
export function digitRows(byDigit: AssistantDigitProgress[]): DigitRow[] {
  return byDigit.map((d) => {
    const vencidas = d.overdue + (d.observed_overdue ?? 0);
    const porVencer = d.pending + d.in_review + Math.max(0, d.observed - (d.observed_overdue ?? 0));
    const due = d.on_time + d.late + vencidas;
    return { digit: d.digit, total: d.total, dentro: d.on_time, fuera: d.late, vencidas, porVencer, due, pct: pctOf(d.on_time, due) };
  });
}

/** La fila de totales (suma de todos los dígitos). */
export function digitTotals(rows: DigitRow[]): DigitRow {
  const t = rows.reduce(
    (a, r) => ({ ...a, total: a.total + r.total, dentro: a.dentro + r.dentro, fuera: a.fuera + r.fuera, vencidas: a.vencidas + r.vencidas, porVencer: a.porVencer + r.porVencer, due: a.due + r.due }),
    emptyDigitRow(-1),
  );
  return { ...t, pct: pctOf(t.dentro, t.due) };
}

/** Verde en meta, ámbar hasta 10 puntos por debajo, rojo más abajo; gris si no hay nada medible. */
export function pctTone(pct: number | null, meta = PLAZO_META): { fg: string; bg: string } {
  if (pct == null) return { fg: '#94A3B8', bg: '#EEF3F0' };
  if (pct >= meta) return { fg: '#0A7A3B', bg: '#DCF5E6' };
  if (pct >= meta - 10) return { fg: '#B45309', bg: '#FEF3C7' };
  return { fg: '#B91C1C', bg: '#FEE2E2' };
}

export const fmtPct = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** El filtro que dejan los números pulsados del consolidado: un dígito y/o una categoría (null = todos). */
export interface DigitFilter {
  digit: number | null;
  bucket: AssistantBucket | null;
}

export const NO_FILTER: DigitFilter = { digit: null, bucket: null };

export const BUCKET_LABEL: Record<AssistantBucket, string> = {
  dentro: 'Dentro de plazo',
  fuera: 'Fuera de plazo',
  vencida: 'Vencidas',
  por_vencer: 'Por vencer',
};

export const isFiltered = (f: DigitFilter): boolean => f.digit != null || f.bucket != null;

/** Lo que dice el chip del filtro («Dígito 3 · Fuera de plazo»). */
export function filterLabel(f: DigitFilter): string {
  const parts: string[] = [];
  if (f.digit != null) parts.push(`RUC termina en ${f.digit}`);
  if (f.bucket != null) parts.push(BUCKET_LABEL[f.bucket]);
  return parts.join(' · ');
}

/** Pulsar la misma celda dos veces quita el filtro. */
export function toggleFilter(cur: DigitFilter, next: DigitFilter): DigitFilter {
  return cur.digit === next.digit && cur.bucket === next.bucket ? NO_FILTER : next;
}

export function filterRows(rows: AssistantModuleRow[], f: DigitFilter): AssistantModuleRow[] {
  return rows.filter((r) => (f.digit == null || r.digit === f.digit) && (f.bucket == null || r.bucket === f.bucket));
}

/** Cuántas filas hay en una celda (para mostrar el contador antes de pulsarla). */
export const countRows = (rows: AssistantModuleRow[], f: DigitFilter): number => filterRows(rows, f).length;

/**
 * Al filtrar por supervisor, los asistentes que se ofrecen son solo los que tienen empresas de ese supervisor, y el número
 * entre paréntesis pasa a ser cuántas empresas tiene con ese supervisor. Sin supervisor elegido se ofrecen todos.
 */
export function assistantsForSupervisor(assistants: AssistantStudioOption[], supervisorId: number | null): AssistantStudioOption[] {
  if (!supervisorId) return assistants;
  const out: AssistantStudioOption[] = [];
  for (const a of assistants) {
    const pair = a.supervisors?.find((s) => s.user_id === supervisorId);
    if (pair) out.push({ ...a, companies: pair.companies });
  }
  return out;
}

/** Textos de la fecha de entrega de una fila («Declaró el 20/07» / «Entregó el …»). */
export function deliveredText(r: Pick<AssistantModuleRow, 'delivered_at' | 'bucket'>, verb: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.delivered_at ?? '');
  return m ? `${verb} el ${m[3]}/${m[2]}/${m[1]}` : '';
}
