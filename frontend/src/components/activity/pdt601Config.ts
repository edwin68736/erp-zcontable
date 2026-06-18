import {
  activityStatusBadgeClass,
  activityStatusLabel,
  buildStatusFilter,
  formatStoredAt,
} from './activityModuleShared';

export const PDT601_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_elaboracion', label: 'En elaboración' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'observado', label: 'Observado' },
  { value: 'aprobado', label: 'Aprobado' },
  { value: 'presentado', label: 'Presentado' },
  { value: 'cerrado', label: 'Cerrado' },
] as const;

export const PDT601_STATUS_FILTER = buildStatusFilter(PDT601_STATUSES);

const PDT601_COMPLETE = new Set(['aprobado', 'presentado', 'cerrado']);

const PDT601_BADGE: Record<string, string> = {
  pendiente: 'bg-slate-100 text-slate-700',
  en_elaboracion: 'bg-blue-100 text-blue-800',
  en_revision: 'bg-indigo-100 text-indigo-800',
  observado: 'bg-amber-100 text-amber-900',
  aprobado: 'bg-emerald-100 text-emerald-800',
  presentado: 'bg-teal-100 text-teal-800',
  cerrado: 'bg-slate-200 text-slate-800',
  sin_registro: 'bg-slate-100 text-slate-500',
};

export function pdt601StatusLabel(status: string): string {
  return activityStatusLabel(status, PDT601_STATUSES);
}

export function pdt601StatusBadgeClass(status: string): string {
  return activityStatusBadgeClass(status, PDT601_BADGE);
}

export function resolvePdt601DueDate(declDue?: string, controlDue?: string): string | undefined {
  const raw = declDue?.slice(0, 10) || controlDue?.slice(0, 10);
  return raw || undefined;
}

export function computePdt601DueMeta(
  status: string,
  dueDate?: string,
): { isOverdue: boolean; daysRemaining: number | null } {
  if (!dueDate || PDT601_COMPLETE.has(status) || status === 'observado') {
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

export { formatStoredAt };
