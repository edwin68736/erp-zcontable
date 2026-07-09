export type TimelinessCode =
  | 'on_time'
  | 'late'
  | 'pending'
  | 'missing'
  | 'exempt'
  | 'no_rule';

const TIMELINESS_BADGE: Record<TimelinessCode, string> = {
  on_time: 'bg-emerald-100 text-emerald-800',
  late: 'bg-orange-100 text-orange-900',
  pending: 'bg-amber-100 text-amber-900',
  missing: 'bg-red-100 text-red-800',
  exempt: 'bg-slate-100 text-slate-600',
  no_rule: 'bg-slate-100 text-slate-500',
};

const TIMELINESS_LABEL: Record<TimelinessCode, string> = {
  on_time: 'A tiempo',
  late: 'Fuera de plazo',
  pending: 'Pendiente',
  missing: 'Vencido',
  exempt: 'Exento',
  no_rule: 'Sin regla',
};

const TIMELINESS_ROW_BORDER: Record<TimelinessCode, string> = {
  on_time: 'border-l-emerald-500',
  late: 'border-l-orange-500',
  pending: 'border-l-amber-400',
  missing: 'border-l-red-500',
  exempt: 'border-l-slate-300',
  no_rule: 'border-l-slate-200',
};

export function normalizeTimeliness(value?: string): TimelinessCode {
  const v = (value || '').trim() as TimelinessCode;
  if (v in TIMELINESS_LABEL) return v;
  return 'no_rule';
}

export function timelinessLabel(value?: string): string {
  return TIMELINESS_LABEL[normalizeTimeliness(value)];
}

export function timelinessBadgeClass(value?: string): string {
  return TIMELINESS_BADGE[normalizeTimeliness(value)];
}

export function timelinessRowBorderClass(value?: string): string {
  return TIMELINESS_ROW_BORDER[normalizeTimeliness(value)];
}

export function formatTimelinessDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Fecha corta para celdas compactas del listado (sin año). */
export function formatTimelinessDateCompact(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
