import { activityStatusBadgeClass, activityStatusLabel } from './activityModuleShared';

export type MailboxType = 'sunat' | 'sunafil';

/** Etiquetas por buzón individual (celda). */
export const MAILBOX_CAPTURE_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'cargado', label: 'Cargado' },
  { value: 'verificado', label: 'Verificado' },
] as const;

/** Resumen semanal por empresa (fila). */
export const MAILBOX_SUMMARY_STATUSES = [
  { value: 'pendiente', label: 'Sin subidas' },
  { value: 'parcial', label: 'Avance parcial' },
  { value: 'cargado', label: 'Por verificar' },
  { value: 'verificado', label: 'Semana completa' },
] as const;

/** Filtros del listado (evalúan cada buzón, no solo el resumen). */
export const MAILBOX_LIST_STATUS_FILTER = [
  { value: '', label: 'Todos' },
  { value: 'pendiente', label: 'Con subidas pendientes' },
  { value: 'parcial', label: 'Avance parcial' },
  { value: 'cargado', label: 'Por verificar (supervisor)' },
  { value: 'verificado', label: 'Semana verificada' },
] as const;

const MAILBOX_BADGE: Record<string, string> = {
  pendiente: 'bg-slate-100 text-slate-700',
  parcial: 'bg-amber-100 text-amber-900',
  cargado: 'bg-blue-100 text-blue-800',
  verificado: 'bg-emerald-100 text-emerald-800',
};

const SUMMARY_LABEL: Record<string, string> = {
  pendiente: 'Sin subidas',
  parcial: 'Avance parcial',
  cargado: 'Por verificar',
  verificado: 'Semana completa',
};

export function mailboxStatusLabel(status: string): string {
  if (SUMMARY_LABEL[status]) return SUMMARY_LABEL[status];
  return activityStatusLabel(status, MAILBOX_CAPTURE_STATUSES);
}

export function mailboxSideStatusLabel(status: string): string {
  return activityStatusLabel(status, MAILBOX_CAPTURE_STATUSES);
}

export function mailboxStatusBadgeClass(status: string): string {
  return activityStatusBadgeClass(status, MAILBOX_BADGE);
}

export function mailboxTypeLabel(type: MailboxType): string {
  return type === 'sunat' ? 'SUNAT' : 'SUNAFIL';
}
