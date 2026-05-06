import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** Zona horaria para fechas de negocio (Perú). */
export const PERU_TIMEZONE = 'America/Lima';

/** Fecha local de Perú en formato `yyyy-MM-dd` para `<input type="date">`. */
export function todayDateInputInPeru(now: Date = new Date()): string {
  return formatInTimeZone(now, PERU_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Interpreta un valor de date input como medianoche en Perú y lo serializa en ISO (UTC)
 * para el API.
 */
export function dateInputToRFC3339MidnightPeru(dateInput: string): string | undefined {
  if (!dateInput) return undefined;
  const d = fromZonedTime(`${dateInput}T00:00:00`, PERU_TIMEZONE);
  return d.toISOString();
}

/** Convierte una fecha ISO del API a `yyyy-MM-dd` según calendario en Perú (para `<input type="date">`). */
export function peruDateInputFromApiDate(iso?: string): string {
  if (!iso?.trim()) return '';
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) {
    return iso.length >= 10 ? iso.slice(0, 10) : '';
  }
  return formatInTimeZone(d, PERU_TIMEZONE, 'yyyy-MM-dd');
}
