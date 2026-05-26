import type { FinanceCalendarActivity, FinanceCalendarMark } from '../../../services/financeCalendar';

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const ACTIVITY_KINDS = [
  { value: 'nps', label: 'Generación NPS' },
  { value: 'pdt_601', label: 'PDT 601' },
  { value: 'pdt_621', label: 'PDT 621' },
  { value: 'sire', label: 'SIRE' },
  { value: 'payment', label: 'Pagos' },
  { value: 'liquidation', label: 'Liquidación' },
  { value: 'closing', label: 'Cierre contable' },
  { value: 'report', label: 'Reporte' },
  { value: 'other', label: 'Otra' },
];

export const ACTIVITY_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completada', label: 'Completada' },
];

export const PRIORITIES = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'critica', label: 'Crítica' },
];

export const MARK_KINDS = [
  { value: 'feriado', label: 'Feriado' },
  { value: 'festividad', label: 'Festividad' },
  { value: 'importante', label: 'Fecha importante' },
];

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function currentPeriodYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftPeriodYm(ym: string, delta: number): string {
  const [ys, ms] = ym.split('-').map(Number);
  const d = new Date(ys, ms - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatPeriodLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Solo nombre del mes (sin año), para navegación compacta. */
export function formatMonthName(ym: string): string {
  const m = Number(ym.split('-')[1]);
  return MONTH_NAMES[m - 1] ?? ym;
}

export function formatDayLabel(date: Date): string {
  const wd = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return `${wd[date.getDay()]}, ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`;
}

/** Clave YYYY-MM-DD en hora local (evita desfase UTC). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type CalendarCell = { date: Date; inMonth: boolean; dayNum: number };

export function buildMonthGrid(periodYm: string): CalendarCell[] {
  const [ys, ms] = periodYm.split('-').map(Number);
  const first = new Date(ys, ms - 1, 1);
  const last = new Date(ys, ms, 0);
  let startPad = first.getDay() - 1;
  if (startPad < 0) startPad = 6;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < startPad; i++) {
    const d = new Date(ys, ms - 1, 1 - (startPad - i));
    cells.push({ date: d, inMonth: false, dayNum: d.getDate() });
  }
  for (let day = 1; day <= last.getDate(); day++) {
    cells.push({ date: new Date(ys, ms - 1, day), inMonth: true, dayNum: day });
  }
  while (cells.length % 7 !== 0) {
    const d = new Date(cells[cells.length - 1].date);
    d.setDate(d.getDate() + 1);
    cells.push({ date: d, inMonth: false, dayNum: d.getDate() });
  }
  return cells;
}

export function chunkWeeks(cells: CalendarCell[]): CalendarCell[][] {
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function activitySpanDays(a: FinanceCalendarActivity): { start: number; end: number } {
  const start = a.start_day > 0 ? a.start_day : a.due_day;
  const end = a.end_day > 0 ? a.end_day : a.due_day;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function activityOnDay(a: FinanceCalendarActivity, dayNum: number): boolean {
  const { start, end } = activitySpanDays(a);
  return dayNum >= start && dayNum <= end;
}

export type WeekSegment = {
  activity: FinanceCalendarActivity;
  colStart: number;
  colSpan: number;
  isStart: boolean;
  isEnd: boolean;
  lane: number;
};

export function weekSegments(week: CalendarCell[], activities: FinanceCalendarActivity[]): WeekSegment[] {
  const inMonthDays = week.filter((c) => c.inMonth);
  if (inMonthDays.length === 0) return [];

  const minDay = Math.min(...inMonthDays.map((c) => c.dayNum));
  const maxDay = Math.max(...inMonthDays.map((c) => c.dayNum));

  const raw: Omit<WeekSegment, 'lane'>[] = [];
  for (const a of activities) {
    const { start, end } = activitySpanDays(a);
    if (end < minDay || start > maxDay) continue;

    const segStart = Math.max(start, minDay);
    const segEnd = Math.min(end, maxDay);
    const startCell = week.find((c) => c.inMonth && c.dayNum === segStart);
    const endCell = week.find((c) => c.inMonth && c.dayNum === segEnd);
    if (!startCell || !endCell) continue;

    const colStart = week.indexOf(startCell);
    const colEnd = week.indexOf(endCell);
    raw.push({
      activity: a,
      colStart,
      colSpan: colEnd - colStart + 1,
      isStart: segStart === start,
      isEnd: segEnd === end,
    });
  }

  raw.sort((x, y) => x.colStart - y.colStart || y.colSpan - x.colSpan);

  const lanes: WeekSegment[][] = [];
  const placed: WeekSegment[] = [];

  for (const seg of raw) {
    let lane = 0;
    for (;;) {
      const conflicts = placed.filter(
        (p) =>
          p.lane === lane &&
          !(seg.colStart + seg.colSpan - 1 < p.colStart || seg.colStart > p.colStart + p.colSpan - 1),
      );
      if (conflicts.length === 0) break;
      lane++;
    }
    const placedSeg: WeekSegment = { ...seg, lane };
    placed.push(placedSeg);
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(placedSeg);
  }

  return placed;
}

export function trafficStyles(tl: string): { bar: string; dot: string; badge: string } {
  switch (tl) {
    case 'rojo':
      return {
        bar: 'bg-red-50 text-red-800 border-red-200/80',
        dot: 'bg-red-400',
        badge: 'bg-red-100 text-red-700',
      };
    case 'amarillo':
      return {
        bar: 'bg-amber-50 text-amber-900 border-amber-200/80',
        dot: 'bg-amber-400',
        badge: 'bg-amber-100 text-amber-800',
      };
    case 'verde':
      return {
        bar: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
        dot: 'bg-emerald-400',
        badge: 'bg-emerald-100 text-emerald-700',
      };
    default:
      return {
        bar: 'bg-sky-50 text-sky-900 border-sky-200/80',
        dot: 'bg-sky-400',
        badge: 'bg-sky-100 text-sky-800',
      };
  }
}

export function markStyles(kind: string): string {
  if (kind === 'feriado') return 'bg-red-50/90 text-red-800 border-red-200/70';
  if (kind === 'festividad') return 'bg-purple-50/90 text-purple-800 border-purple-200/70';
  return 'bg-sky-50/90 text-sky-800 border-sky-200/70';
}

export function marksByDayKey(marks: FinanceCalendarMark[]): Map<string, FinanceCalendarMark[]> {
  const map = new Map<string, FinanceCalendarMark[]>();
  for (const m of marks) {
    const key = m.mark_date.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  return map;
}

export function activitiesForDay(activities: FinanceCalendarActivity[], dayNum: number): FinanceCalendarActivity[] {
  return activities.filter((a) => activityOnDay(a, dayNum));
}

export type ActivityDatePatch = {
  start_day: number;
  end_day: number;
  due_day: number;
};

function clampDay(d: number, lastDay: number): number {
  return Math.min(Math.max(1, d), lastDay);
}

/** Semáforo local (espejo del backend) para actualizaciones optimistas. */
export function computeTrafficLight(dueDay: number, periodYm: string, status: string): string {
  if (status === 'completada') return 'verde';
  const [y, m] = periodYm.split('-').map(Number);
  const due = new Date(y, m - 1, dueDay);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  if (due < today) return 'rojo';
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff <= 3) return 'amarillo';
  return 'azul';
}

function dateStrForDay(periodYm: string, day: number): string {
  const [y, m] = periodYm.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function applyActivityDatePatch(
  a: FinanceCalendarActivity,
  patch: ActivityDatePatch,
  periodYm: string,
): FinanceCalendarActivity {
  const start = patch.start_day;
  const end = patch.end_day;
  const due = patch.due_day;
  return {
    ...a,
    start_day: start,
    end_day: end,
    due_day: due,
    start_date: dateStrForDay(periodYm, start),
    end_date: dateStrForDay(periodYm, end),
    due_date: dateStrForDay(periodYm, due),
    traffic_light: computeTrafficLight(due, periodYm, a.status || 'pendiente'),
  };
}

export function patchFromActivity(a: FinanceCalendarActivity): ActivityDatePatch {
  const { start, end } = activitySpanDays(a);
  return { start_day: start, end_day: end, due_day: a.due_day };
}

/** Calcula días según modo de arrastre. */
export function computeDragDates(
  mode: 'move' | 'resize-start' | 'resize-end',
  origin: ActivityDatePatch,
  hoverDay: number,
  anchorDay: number,
  lastDay: number,
): ActivityDatePatch {
  const o = origin;
  let start = o.start_day;
  let end = o.end_day;
  let due = o.due_day;

  if (mode === 'move') {
    const delta = hoverDay - anchorDay;
    start = o.start_day + delta;
    end = o.end_day + delta;
    due = o.due_day + delta;
    const span = o.end_day - o.start_day;
    if (start < 1) {
      end = 1 + span;
      start = 1;
    }
    if (end > lastDay) {
      start = lastDay - span;
      end = lastDay;
    }
    if (start < 1) start = 1;
    due = o.due_day + (start - o.start_day);
  } else if (mode === 'resize-end') {
    end = clampDay(hoverDay, lastDay);
    if (end < start) end = start;
    if (due >= o.end_day) due = end;
  } else {
    start = clampDay(hoverDay, lastDay);
    if (start > end) start = end;
    if (due <= o.start_day) due = start;
  }

  return {
    start_day: clampDay(start, lastDay),
    end_day: clampDay(end, lastDay),
    due_day: clampDay(due, lastDay),
  };
}

export function daysInRange(start: number, end: number): number[] {
  const out: number[] = [];
  for (let d = Math.min(start, end); d <= Math.max(start, end); d++) out.push(d);
  return out;
}
