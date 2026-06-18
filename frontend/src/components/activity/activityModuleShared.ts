/** Utilidades compartidas entre módulos de actividad (F3+). Sin lógica de negocio. */

export type ActivityStatusOption = { value: string; label: string };

export function formatStoredAt(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function activityStatusLabel(status: string, options: readonly ActivityStatusOption[]): string {
  if (status === 'sin_registro') return 'Sin registro';
  const found = options.find((s) => s.value === status);
  return found?.label ?? status;
}

export function buildStatusFilter(options: readonly ActivityStatusOption[]) {
  return [{ value: '', label: 'Todos' }, { value: 'sin_registro', label: 'Sin registro' }, ...options];
}

export function activityStatusBadgeClass(status: string, badgeByStatus: Record<string, string>): string {
  return badgeByStatus[status] ?? 'bg-slate-100 text-slate-700';
}
