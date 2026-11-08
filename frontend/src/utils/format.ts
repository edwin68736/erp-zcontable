import { formatInTimeZone } from 'date-fns-tz';
import { PERU_TIMEZONE } from './peruDates';

/**
 * Formato único de importes y fechas para lo que se MUESTRA en pantalla (los campos de formulario siguen usando
 * números sin separadores). Antes cada pantalla armaba el suyo: `S/ 12500.50` con toFixed, `toLocaleString()` sin
 * idioma (según la PC salía 11/8/2026 u 8/11/2026) o una función local distinta por herramienta.
 */

const AMOUNT = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12500.5 → «12,500.50». Vacío, nulo o no numérico se muestra como «0.00». */
export function formatAmount(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n;
  return AMOUNT.format(typeof v === 'number' && Number.isFinite(v) ? v : 0);
}

/** 12500.5 → «S/ 12,500.50». */
export function formatMoneyPen(n: number | string | null | undefined): string {
  return `S/ ${formatAmount(n)}`;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inLima(value: string | number | Date | null | undefined, pattern: string): string {
  const d = toDate(value);
  return d ? formatInTimeZone(d, PERU_TIMEZONE, pattern) : '—';
}

/** «08/11/2026» en hora de Perú. Fecha vacía o inválida: «—». */
export const formatDate = (value: string | number | Date | null | undefined): string => inLima(value, 'dd/MM/yyyy');

/** «08/11/2026 15:30» (24 h) en hora de Perú. */
export const formatDateTime = (value: string | number | Date | null | undefined): string => inLima(value, 'dd/MM/yyyy HH:mm');

/** «08/11/2026 15:30:45»: para bitácoras, donde importa el segundo. */
export const formatDateTimeSeconds = (value: string | number | Date | null | undefined): string => inLima(value, 'dd/MM/yyyy HH:mm:ss');

/** «15:30» en hora de Perú. */
export const formatTime = (value: string | number | Date | null | undefined): string => inLima(value, 'HH:mm');
