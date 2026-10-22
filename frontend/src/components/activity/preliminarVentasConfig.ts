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

/** Fondo celeste de la celda de una entrega fuera de plazo (lista y Excel). */
export const PRELIMINAR_VENTAS_LATE_CELL_CLASS = 'bg-sky-50';
/** Mismo celeste para la celda del Excel (ARGB). */
export const PRELIMINAR_VENTAS_LATE_CELL_ARGB = 'FFE0F2FE';

/** La entrega ya se ENTREGÓ: se registraron sus datos (o además se envió). Mide el plazo. */
export function preliminarVentasEntregada(status: string): boolean {
  return status === 'registrado' || status === 'enviado';
}

/** Entregada después de su fecha del calendario (celda celeste). */
export function preliminarVentasEntregadaFueraDePlazo(status: string, timeliness?: string): boolean {
  return preliminarVentasEntregada(status) && timeliness === 'late';
}

/**
 * Insignia de una entrega: el estado más la puntualidad frente a la fecha del calendario. La entrega
 * cuenta desde que se REGISTRAN sus datos: registrada (o enviada) después de su fecha dice "Entregado
 * fuera de plazo" (celeste), aunque ya estuviera vencida al registrarla; la que sigue sin registrarse
 * pasada su fecha dice "Pendiente · vencido".
 */
export function preliminarVentasSlotBadge(status: string, timeliness?: string): { label: string; className: string } {
  const base = preliminarVentasStatusLabel(status);
  if (preliminarVentasEntregadaFueraDePlazo(status, timeliness)) {
    return { label: 'Entregado fuera de plazo', className: 'bg-sky-100 text-sky-900' };
  }
  if (!preliminarVentasEntregada(status) && timeliness === 'missing') {
    return { label: `${base} · vencido`, className: 'bg-red-100 text-red-800' };
  }
  return { label: base, className: preliminarVentasStatusBadgeClass(status) };
}
