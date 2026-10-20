import {
  activityStatusBadgeClass,
  activityStatusLabel,
  buildStatusFilter,
} from './activityModuleShared';

/**
 * Estados de una entrega de Preliminar de Ventas (una por "slot" — el estudio lo envía 2 veces al
 * mes). "Suspendida" no es un valor de acá — es el overlay global de
 * SupervisorMonthlyControl.Suspendida, igual que en PDT 601/621/Buzón SOL.
 */
export const PRELIMINAR_VENTAS_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'registrado', label: 'Registrado' },
  { value: 'enviado', label: 'Enviado' },
] as const;

export const PRELIMINAR_VENTAS_STATUS_FILTER = buildStatusFilter(PRELIMINAR_VENTAS_STATUSES);

const PRELIMINAR_VENTAS_BADGE: Record<string, string> = {
  sin_registro: 'bg-slate-100 text-slate-700',
  pendiente: 'bg-amber-100 text-amber-900',
  registrado: 'bg-blue-100 text-blue-800',
  enviado: 'bg-primary-100 text-primary-800',
};

export function preliminarVentasStatusLabel(status: string): string {
  return activityStatusLabel(status, PRELIMINAR_VENTAS_STATUSES);
}

export function preliminarVentasStatusBadgeClass(status: string): string {
  return activityStatusBadgeClass(status, PRELIMINAR_VENTAS_BADGE);
}

/**
 * Insignia de una entrega: el estado más la puntualidad frente a la fecha del calendario. Una entrega
 * enviada después de su fecha dice "Enviado fuera de plazo"; la que sigue sin enviarse pasada su fecha
 * dice "(vencido)" — igual que los criterios del libro de control (ENVIADO / ENVIADO, FUERA DE PLAZO /
 * PENDIENTE).
 */
export function preliminarVentasSlotBadge(status: string, timeliness?: string): { label: string; className: string } {
  const base = preliminarVentasStatusLabel(status);
  if (status === 'enviado' && timeliness === 'late') {
    return { label: 'Enviado fuera de plazo', className: 'bg-orange-100 text-orange-900' };
  }
  if (status !== 'enviado' && timeliness === 'missing') {
    return { label: `${base} · vencido`, className: 'bg-red-100 text-red-800' };
  }
  return { label: base, className: preliminarVentasStatusBadgeClass(status) };
}
