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
