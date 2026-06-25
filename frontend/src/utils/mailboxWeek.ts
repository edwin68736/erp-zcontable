/** Utilidades de semana laborable (lun–sáb) para capturas de buzón SUNAT/SUNAFIL. */

export type WeekOption = {
  week_start: string;
  week_index: number;
  label: string;
  date_range?: string;
};

export function mondayOfWeekContaining(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const wd = d.getDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Sábado de la semana laborable (lun–sáb). */
export function businessWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  d.setDate(d.getDate() + 5);
  return d;
}

export function formatWeekStart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function currentPeriodYM(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Lunes de la semana laborable que contiene la fecha (domingo → semana en curso lun–sáb). */
export function businessWeekStartForDate(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d.getDay() === 0) {
    d.setDate(d.getDate() - 1);
  }
  return mondayOfWeekContaining(d);
}

function weekHasBusinessDaysInMonth(weekStart: Date, monthFirst: Date, monthLast: Date): boolean {
  const bizEnd = businessWeekEnd(weekStart);
  if (bizEnd < monthFirst || weekStart > monthLast) return false;
  const interStart = weekStart < monthFirst ? monthFirst : weekStart;
  const interEnd = bizEnd > monthLast ? monthLast : bizEnd;
  return interStart <= interEnd;
}

function formatBusinessWeekRange(weekStart: Date, monthFirst: Date, monthLast: Date): string {
  let start = weekStart;
  if (start < monthFirst) start = monthFirst;
  let end = businessWeekEnd(weekStart);
  if (end > monthLast) end = monthLast;
  if (start > end) return '';
  const fmt = (dt: Date) =>
    `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Semanas laborables del mes del period_ym (lun–sáb; domingo no laborable). */
export function weeksInPeriodYM(periodYm: string): WeekOption[] {
  const parts = periodYm.split('-');
  if (parts.length !== 2) {
    const ws = formatWeekStart(businessWeekStartForDate(new Date()));
    return [{ week_start: ws, week_index: 1, label: 'Semana 1', date_range: '' }];
  }
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    const ws = formatWeekStart(businessWeekStartForDate(new Date()));
    return [{ week_start: ws, week_index: 1, label: 'Semana 1', date_range: '' }];
  }

  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const seen = new Set<string>();
  const out: WeekOption[] = [];
  let cur = mondayOfWeekContaining(first);
  let weekIndex = 0;

  while (cur <= new Date(last.getFullYear(), last.getMonth(), last.getDate() + 6)) {
    if (!weekHasBusinessDaysInMonth(cur, first, last)) {
      cur = new Date(cur);
      cur.setDate(cur.getDate() + 7);
      continue;
    }
    const ws = formatWeekStart(cur);
    if (!seen.has(ws)) {
      seen.add(ws);
      weekIndex += 1;
      out.push({
        week_start: ws,
        week_index: weekIndex,
        label: `Semana ${weekIndex}`,
        date_range: formatBusinessWeekRange(cur, first, last),
      });
    }
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
    if (cur.getFullYear() > y || (cur.getFullYear() === y && cur.getMonth() > m + 1)) break;
  }

  if (out.length === 0) {
    const wsMonday = mondayOfWeekContaining(first);
    out.push({
      week_start: formatWeekStart(wsMonday),
      week_index: 1,
      label: 'Semana 1',
      date_range: formatBusinessWeekRange(wsMonday, first, last),
    });
  }
  return out;
}

export function defaultWeekStartForPeriod(periodYm: string): string {
  const weeks = weeksInPeriodYM(periodYm);
  if (weeks.length === 0) return formatWeekStart(businessWeekStartForDate(new Date()));

  if (periodYm === currentPeriodYM()) {
    const bizMonday = formatWeekStart(businessWeekStartForDate(new Date()));
    const match = weeks.find((w) => w.week_start === bizMonday);
    if (match) return match.week_start;
  }
  return weeks[0].week_start;
}

/** Texto del selector: Semana N (02/06 – 07/06). */
export function formatWeekOptionLabel(w: WeekOption): string {
  const range = (w.date_range || '').trim();
  if (range) return `${w.label} (${range})`;
  return w.label;
}

/** Título contextual para la tabla de capturas. */
export function formatMailboxWeekContext(
  week: WeekOption | undefined,
  capturesPerWeek: number,
  periodYm: string,
): string {
  const weekPart = week ? formatWeekOptionLabel(week) : 'Semana';
  const n = capturesPerWeek;
  const loads = n === 1 ? '1 carga' : `${n} cargas`;
  return `${weekPart} · ${loads} por semana · ${periodYm} (lun–sáb, sin domingo)`;
}
