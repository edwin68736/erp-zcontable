import {
  activityStatusBadgeClass,
  activityStatusLabel,
  buildStatusFilter,
  formatStoredAt,
} from './activityModuleShared';

// Enum reducido de 4 estados (docs/diseno-estados-pdt601-pdt621-2026-09-16.md) — reemplaza al viejo
// de 7 valores. "Por revisar" es un único estado tanto para la primera entrega del asistente como
// para una reentrega tras una observación. "Entregado" es terminal (salvo Reabrir); su variante
// "fuera de fecha" NO es un valor de estado — es un label calculado en lectura, ver
// pdt601DisplayStatus más abajo.
export const PDT601_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'por_revisar', label: 'Por revisar' },
  { value: 'observado', label: 'Observado' },
  { value: 'entregado', label: 'Entregado' },
] as const;

/** Régimen laboral de la empresa para el período — obligatorio, sin valor por defecto (fuerza a
 * elegir). Fuente única de labels/valores, compartida entre el detalle, el listado y el export
 * Excel de PDT 601 (ver Pdt601DetailPage.tsx, Pdt601ListPage.tsx, pdt601ExcelExport.ts). */
export const PDT601_REGIMEN_LABORAL_OPTIONS = [
  { value: '', label: 'Seleccione' },
  { value: 'general', label: 'General' },
  { value: 'remype', label: 'Remype' },
] as const;

export const REGIMEN_LABORAL_LABELS: Record<string, string> = {
  general: 'General',
  remype: 'Remype',
};

export function pdt601RegimenLaboralLabel(value?: string | null): string {
  return (value && REGIMEN_LABORAL_LABELS[value]) || '—';
}

export const PDT601_STATUS_FILTER = [
  ...buildStatusFilter(PDT601_STATUSES),
  { value: 'entregado_a_tiempo', label: 'Entregado a tiempo' },
  { value: 'entregado_fuera_de_fecha', label: 'Entregado fuera de fecha' },
  { value: 'sin_planilla', label: 'Sin planilla' },
  { value: 'suspendida', label: 'Suspendida' },
];

/** Único estado terminal — a partir de acá el formulario queda bloqueado para los dos roles (ver
 * declarationLocked en Pdt601DetailPage). Fuente única: no duplicar este set. */
export const PDT601_TERMINAL_STATUSES = new Set(['entregado']);

const PDT601_BADGE: Record<string, string> = {
  pendiente: 'bg-slate-100 text-slate-700',
  por_revisar: 'bg-indigo-100 text-indigo-800',
  observado: 'bg-amber-100 text-amber-900',
  entregado: 'bg-emerald-100 text-emerald-800',
  // Mismo estado guardado que "entregado" — se distingue únicamente por el label/badge calculado
  // (pdt601DisplayStatus), nunca es un valor de Status real.
  entregado_fuera_de_fecha: 'bg-orange-100 text-orange-900',
  sin_registro: 'bg-slate-100 text-slate-500',
  // "sin_planilla"/"suspendida" no son estados de la declaración (son planilla.sin_planilla /
  // planilla.suspendida) — se muestran acá como si lo fueran para que el badge/select del detalle
  // los reflejen de forma consistente.
  sin_planilla: 'bg-amber-100 text-amber-900',
  // Suspendida es más restrictivo que sin_planilla (bloquea TODO registro) — color propio (morado)
  // para que no se confunda con ningún otro estado de la tabla.
  suspendida: 'bg-purple-100 text-purple-900',
};

export function pdt601StatusLabel(status: string): string {
  if (status === 'sin_planilla') return 'Sin planilla';
  if (status === 'suspendida') return 'Suspendida';
  if (status === 'entregado_fuera_de_fecha') return 'Entregado fuera de fecha';
  return activityStatusLabel(status, PDT601_STATUSES);
}

export function pdt601StatusBadgeClass(status: string): string {
  return activityStatusBadgeClass(status, PDT601_BADGE);
}

/**
 * Fuente única para decidir qué mostrar como "Estado" en cualquier pantalla de PDT601 — prioridad
 * Suspendida > Sin planilla > Entregado±puntualidad > estado real (docs/diseno-estados-pdt601-pdt621-
 * 2026-09-16.md §6/§12.1). Reemplaza el patrón repetido
 * `suspendida ? 'suspendida' : sinPlanilla ? 'sin_planilla' : status` que antes vivía duplicado en el
 * detalle, el listado, el Excel y el dashboard.
 */
export function pdt601DisplayStatus(opts: {
  status: string;
  sinPlanilla?: boolean;
  suspendida?: boolean;
  timeliness?: string;
}): { value: string; label: string; className: string } {
  const { status, sinPlanilla, suspendida, timeliness } = opts;
  let value = status;
  if (suspendida) value = 'suspendida';
  else if (sinPlanilla) value = 'sin_planilla';
  else if (status === 'entregado' && timeliness === 'late') value = 'entregado_fuera_de_fecha';
  return { value, label: pdt601StatusLabel(value), className: pdt601StatusBadgeClass(value) };
}

export function resolvePdt601DueDate(declDue?: string, controlDue?: string): string | undefined {
  const raw = declDue?.slice(0, 10) || controlDue?.slice(0, 10);
  return raw || undefined;
}

export function computePdt601DueMeta(
  status: string,
  dueDate?: string,
  sinPlanilla?: boolean,
  suspendida?: boolean,
): { isOverdue: boolean; daysRemaining: number | null } {
  if (!dueDate || sinPlanilla || suspendida || PDT601_TERMINAL_STATUSES.has(status) || status === 'observado') {
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

export function formatPdt601DueDateCell(
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

export function formatPdt601DueDetail(
  dueDate?: string,
  isOverdue?: boolean,
  daysRemaining?: number | null,
): string {
  if (!dueDate) return 'Sin fecha de vencimiento';
  const base = formatPdt601DueDateCell(dueDate, false, null);
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

/**
 * Fondo de fila del listado según cumplimiento del plazo (regla del calendario financiero,
 * ver /settings/activity-configuration): morado si la empresa está suspendida, gris si no tiene
 * planilla, verde si se entregó dentro de plazo, rojo si sigue pendiente (no entregada) o se
 * entregó tarde y ya venció.
 */
export function pdt601RowBgClass(
  sinPlanilla: boolean | undefined,
  timeliness: string | undefined,
  suspendida?: boolean,
): string {
  if (suspendida) return 'bg-purple-50 hover:bg-purple-100/70';
  if (sinPlanilla) return 'bg-slate-100 hover:bg-slate-200/70';
  if (timeliness === 'on_time') return 'bg-emerald-50 hover:bg-emerald-100/70';
  if (timeliness === 'missing' || timeliness === 'late') return 'bg-red-50 hover:bg-red-100/70';
  return 'hover:bg-slate-50/80';
}

export { formatStoredAt };
