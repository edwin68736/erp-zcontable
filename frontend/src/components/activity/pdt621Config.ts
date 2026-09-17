import {
  activityStatusBadgeClass,
  activityStatusLabel,
  buildStatusFilter,
  formatStoredAt,
} from './activityModuleShared';

// Enum reducido de 4 estados, mismo criterio que PDT601 (docs/diseno-estados-pdt601-pdt621-2026-09-
// 16.md) — reemplaza al viejo de 7 valores. PDT621 no tiene equivalente de "Sin planilla": la única
// excepción es Suspendida.
export const PDT621_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'por_revisar', label: 'Por revisar' },
  { value: 'observado', label: 'Observado' },
  { value: 'entregado', label: 'Entregado' },
] as const;

export const PDT621_STATUS_FILTER = [
  ...buildStatusFilter(PDT621_STATUSES),
  { value: 'entregado_a_tiempo', label: 'Entregado a tiempo' },
  { value: 'entregado_fuera_de_fecha', label: 'Entregado fuera de fecha' },
  { value: 'suspendida', label: 'Suspendida' },
];

/** Único estado terminal — fuente única, no duplicar (antes existía también una copia local en
 * Pdt621DetailPage.tsx bajo el mismo nombre viejo, con otro conjunto de valores). */
export const PDT621_TERMINAL_STATUSES = new Set(['entregado']);

const PDT621_BADGE: Record<string, string> = {
  pendiente: 'bg-slate-100 text-slate-700',
  por_revisar: 'bg-indigo-100 text-indigo-800',
  observado: 'bg-amber-100 text-amber-900',
  entregado: 'bg-emerald-100 text-emerald-800',
  entregado_fuera_de_fecha: 'bg-orange-100 text-orange-900',
  sin_registro: 'bg-slate-100 text-slate-500',
  // "suspendida" no es un estado real de la declaración (es record.suspendida) — se muestra acá
  // como si lo fuera para que el badge/select del detalle lo reflejen de forma consistente (mismo
  // patrón que PDT 601).
  suspendida: 'bg-purple-100 text-purple-900',
};

export function pdt621StatusLabel(status: string): string {
  if (status === 'suspendida') return 'Suspendida';
  if (status === 'entregado_fuera_de_fecha') return 'Entregado fuera de fecha';
  return activityStatusLabel(status, PDT621_STATUSES);
}

export function pdt621StatusBadgeClass(status: string): string {
  return activityStatusBadgeClass(status, PDT621_BADGE);
}

/**
 * Fuente única para "Estado" en cualquier pantalla de PDT621 — prioridad Suspendida >
 * Entregado±puntualidad > estado real. La puntualidad usa SIEMPRE el calendario interno
 * (assistantTimeliness), nunca el cronograma SUNAT (declarationTimeliness es un dato aparte, ver
 * docs/diseno-estados-pdt601-pdt621-2026-09-16.md §5).
 */
export function pdt621DisplayStatus(opts: {
  status: string;
  suspendida?: boolean;
  assistantTimeliness?: string;
}): { value: string; label: string; className: string } {
  const { status, suspendida, assistantTimeliness } = opts;
  let value = status;
  if (suspendida) value = 'suspendida';
  else if (status === 'entregado' && assistantTimeliness === 'late') value = 'entregado_fuera_de_fecha';
  return { value, label: pdt621StatusLabel(value), className: pdt621StatusBadgeClass(value) };
}

export function resolvePdt621DueDate(declDue?: string, controlDue?: string): string | undefined {
  const raw = declDue?.slice(0, 10) || controlDue?.slice(0, 10);
  return raw || undefined;
}

export function computePdt621DueMeta(
  status: string,
  dueDate?: string,
  suspendida?: boolean,
): { isOverdue: boolean; daysRemaining: number | null } {
  if (!dueDate || suspendida || PDT621_TERMINAL_STATUSES.has(status) || status === 'observado') {
    return { isOverdue: false, daysRemaining: null };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) {
    return { isOverdue: false, daysRemaining: null };
  }
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  return { isOverdue: diff < 0, daysRemaining: diff };
}

export function formatPdt621DueDateCell(
  dueDate?: string,
  isOverdue?: boolean,
  daysRemaining?: number | null,
): string {
  if (!dueDate) return '—';
  const d = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  const label = d.toLocaleDateString('es-PE', { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (isOverdue) return `${label} · Vencido`;
  if (daysRemaining !== null && daysRemaining !== undefined) {
    if (daysRemaining === 0) return `${label} · Hoy`;
    if (daysRemaining === 1) return `${label} · 1 día`;
    return `${label} · ${daysRemaining} días`;
  }
  return label;
}

export function formatPdt621DueDetail(
  dueDate?: string,
  isOverdue?: boolean,
  daysRemaining?: number | null,
): string {
  if (!dueDate) return 'Sin fecha de vencimiento';
  const base = formatPdt621DueDateCell(dueDate, false, null);
  if (isOverdue) {
    const abs = daysRemaining !== null && daysRemaining !== undefined ? Math.abs(daysRemaining) : null;
    return abs !== null ? `${base} · Vencido hace ${abs} día(s)` : `${base} · Vencido`;
  }
  if (daysRemaining !== null && daysRemaining !== undefined) {
    if (daysRemaining === 0) return `${base} · Vence hoy`;
    if (daysRemaining === 1) return `${base} · 1 día restante`;
    return `${base} · ${daysRemaining} días restantes`;
  }
  return base;
}

/** Opciones del campo "¿Se envió SIRE?" — valor vacío = aún sin definir ("Seleccione"). */
export const SIRE_ENVIO_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Seleccione' },
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
];

/**
 * Fondo de fila del listado según cumplimiento de la fecha de declaración PDT 621 vs. el
 * cronograma SUNAT por dígito de RUC (ver /finance/sunat-due-dates): morado si la empresa está
 * suspendida, verde si se declaró dentro de plazo, rojo si sigue pendiente o se declaró tarde y ya
 * venció.
 */
export function pdt621RowBgClass(timeliness: string | undefined, suspendida?: boolean): string {
  if (suspendida) return 'bg-purple-50 hover:bg-purple-100/70';
  if (timeliness === 'on_time') return 'bg-emerald-50 hover:bg-emerald-100/70';
  if (timeliness === 'missing' || timeliness === 'late') return 'bg-red-50 hover:bg-red-100/70';
  return 'hover:bg-slate-50/80';
}

export { formatStoredAt };
