import {
  activityStatusBadgeClass,
  activityStatusLabel,
  buildStatusFilter,
} from './activityModuleShared';

/**
 * Estados de la declaración "preliminar_ventas" — por ahora solo "pendiente" es alcanzable desde la
 * UI (no hay control de fechas de entrega todavía, ver comentario en
 * models.SupervisorDeclPreliminarVentas). "por_revisar"/"observado"/"entregado" ya existen a nivel
 * de datos para cuando se agregue ese seguimiento más adelante.
 */
export const PRELIMINAR_VENTAS_STATUSES = [{ value: 'pendiente', label: 'Pendiente' }] as const;

export const PRELIMINAR_VENTAS_STATUS_FILTER = buildStatusFilter(PRELIMINAR_VENTAS_STATUSES);

const PRELIMINAR_VENTAS_BADGE: Record<string, string> = {
  sin_registro: 'bg-slate-100 text-slate-700',
  pendiente: 'bg-amber-100 text-amber-900',
  por_revisar: 'bg-blue-100 text-blue-800',
  observado: 'bg-amber-100 text-amber-900',
  entregado: 'bg-primary-100 text-primary-800',
};

export function preliminarVentasStatusLabel(status: string): string {
  return activityStatusLabel(status, PRELIMINAR_VENTAS_STATUSES);
}

export function preliminarVentasStatusBadgeClass(status: string): string {
  return activityStatusBadgeClass(status, PRELIMINAR_VENTAS_BADGE);
}
