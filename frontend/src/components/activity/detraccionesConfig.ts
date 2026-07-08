import {
  activityStatusLabel,
  buildStatusFilter,
  formatStoredAt,
} from './activityModuleShared';

/** Flujo operativo simplificado de Detracciones. */
export const DETRACCIONES_STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'cargado', label: 'Cargado' },
  { value: 'verificado', label: 'Verificado' },
  { value: 'sin_clave', label: 'Sin clave' },
  { value: 'no_corresponde', label: 'No corresponde' },
] as const;

/** Estados que el supervisor puede fijar manualmente (sin PDF). */
export const DETRACCIONES_SUPERVISOR_MANUAL_STATUSES = [
  { value: 'sin_clave', label: 'Sin clave' },
  { value: 'no_corresponde', label: 'No corresponde' },
] as const;

export const DETRACCIONES_STATUS_FILTER = buildStatusFilter(DETRACCIONES_STATUSES);

/**
 * Colores semáforo por estado (Detracciones).
 * 🟡 pendiente · 🔵 cargado · 🟢 verificado · 🔴 sin_clave / no_corresponde
 */
const DETRACCIONES_BADGE: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-900',
  sin_registro: 'bg-amber-100 text-amber-900',
  cargado: 'bg-blue-100 text-blue-800',
  verificado: 'bg-emerald-100 text-emerald-800',
  validado: 'bg-emerald-100 text-emerald-800',
  sin_clave: 'bg-red-100 text-red-800',
  no_corresponde: 'bg-red-100 text-red-800',
  // Legacy (hasta migración completa en BD)
  en_elaboracion: 'bg-amber-100 text-amber-900',
  deposito_pendiente: 'bg-amber-100 text-amber-900',
  deposito_registrado: 'bg-blue-100 text-blue-800',
  sin_operaciones: 'bg-red-100 text-red-800',
  en_revision: 'bg-blue-100 text-blue-800',
  observado: 'bg-amber-100 text-amber-900',
};

const LEGACY_LABELS: Record<string, string> = {
  validado: 'Verificado',
  en_elaboracion: 'En elaboración',
  deposito_pendiente: 'Depósito pendiente',
  deposito_registrado: 'Depósito registrado',
  sin_operaciones: 'Sin operaciones sujetas',
  en_revision: 'En revisión',
  observado: 'Observado',
};

export function detraccionesStatusLabel(status: string): string {
  const normalized = normalizeDetraccionesStatus(status);
  return activityStatusLabel(normalized, DETRACCIONES_STATUSES) || LEGACY_LABELS[status] || status;
}

export function detraccionesStatusBadgeClass(status: string): string {
  const normalized = normalizeDetraccionesStatus(status);
  return (
    DETRACCIONES_BADGE[normalized] ??
    DETRACCIONES_BADGE[status] ??
    'bg-amber-100 text-amber-900'
  );
}

export function normalizeDetraccionesStatus(status: string): string {
  const s = (status || '').trim();
  if (!s || s === 'sin_registro') return 'pendiente';
  if (s === 'validado') return 'verificado';
  if (s === 'sin_operaciones') return 'no_corresponde';
  return s;
}

export function detraccionesAllowsUpload(status: string): boolean {
  const s = normalizeDetraccionesStatus(status);
  return s === 'pendiente' || s === 'cargado';
}

export function detraccionesSupervisorCanSetManualStatus(status: string): boolean {
  const s = normalizeDetraccionesStatus(status);
  return s === 'pendiente' || s === 'cargado';
}

export { formatStoredAt };
