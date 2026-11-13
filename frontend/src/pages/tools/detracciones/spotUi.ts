import type { SpotDownloadItem, SpotFilter, SpotTipoCuenta, SpotTipoPago } from '../../../services/spot';

/** SUNAT no deja consultar más de 30 días por fecha de pago. */
export const SPOT_MAX_DAYS = 30;

export const TIPOS_CUENTA: { value: SpotTipoCuenta; label: string }[] = [
  { value: '1', label: 'Cuenta de Detracciones Convencional' },
  { value: '2', label: 'Cuenta de Detracciones Especial IVAP' },
  { value: '3', label: 'Cuenta-Ley N° 30737' },
];

export const TIPOS_PAGO: { value: SpotTipoPago; label: string }[] = [
  { value: 'individuales', label: 'Pagos individuales' },
  { value: 'masivos', label: 'Pagos masivos' },
  { value: 'pasajeros', label: 'Pagos transporte de pasajeros' },
];

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Los tipos de pago que ofrece SUNAT para cada tipo de cuenta. */
export function pagosParaCuenta(cuenta: SpotTipoCuenta): SpotTipoPago[] {
  if (cuenta === '2') return ['individuales'];
  if (cuenta === '3') return ['individuales', 'masivos'];
  return ['individuales', 'masivos', 'pasajeros'];
}

export function cuentaNombre(c: string): string {
  return TIPOS_CUENTA.find((t) => t.value === c)?.label ?? c;
}

export function pagoNombre(p: string): string {
  return TIPOS_PAGO.find((t) => t.value === p)?.label ?? p;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** AAAAMM de un año y un mes (1-12). */
export function periodoDe(year: number, month: number): string {
  return `${year}${pad(month)}`;
}

/** Los meses (1-12) que se pueden elegir de un año: ninguno posterior al mes actual. */
export function mesesDelAnio(year: number, hoy: Date): number[] {
  const last = year < hoy.getFullYear() ? 12 : year === hoy.getFullYear() ? hoy.getMonth() + 1 : 0;
  return Array.from({ length: last }, (_, i) => i + 1);
}

/** Los años que se pueden elegir (desde el actual hacia atrás). */
export function aniosDisponibles(hoy: Date, cuantos = 6): number[] {
  return Array.from({ length: cuantos }, (_, i) => hoy.getFullYear() - i);
}

const dayMs = 86400000;

/** Qué le falta o le sobra a los filtros ('' si están bien); las mismas reglas que valida el servidor. */
export function filterError(f: SpotFilter, hoy: string): string {
  if (!pagosParaCuenta(f.tipo_cuenta).includes(f.tipo_pago)) return 'Ese tipo de pago no existe para el tipo de cuenta elegido.';
  if (f.modo === 'periodo') {
    if (f.tipo_pago !== 'individuales') return 'Por periodo solo se consultan los pagos individuales: use la fecha de pago.';
    if (!/^\d{6}$/.test(f.periodo)) return 'Elija el año y el mes del periodo.';
    return '';
  }
  if (!f.desde || !f.hasta) return 'Indique las dos fechas.';
  const span = Math.round((Date.parse(`${f.hasta}T00:00:00`) - Date.parse(`${f.desde}T00:00:00`)) / dayMs);
  if (span < 0) return 'La fecha de inicio no puede ser mayor que la fecha fin.';
  if (span + 1 > SPOT_MAX_DAYS) return `SUNAT no deja consultar más de ${SPOT_MAX_DAYS} días por fecha de pago.`;
  if (f.hasta > hoy) return 'La fecha fin no puede ser posterior a hoy.';
  return '';
}

const dmy = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v);

/** «Periodo: 202608» o «04/11/2026 – 13/11/2026». */
export function rangoTexto(it: Pick<SpotDownloadItem, 'modo' | 'periodo' | 'desde' | 'hasta'>): string {
  if (it.modo === 'periodo') return `Periodo: ${it.periodo}`;
  return it.desde === it.hasta ? dmy(it.desde) : `${dmy(it.desde)} – ${dmy(it.hasta)}`;
}

/** «Descarga Finalizada: 3 detracciones». */
export function resumenTexto(it: Pick<SpotDownloadItem, 'status' | 'total'>): string {
  if (it.status === 'sin_datos') return 'No se encontraron registros de detracciones.';
  return `Descarga Finalizada: ${it.total} ${it.total === 1 ? 'detracción' : 'detracciones'}`;
}
