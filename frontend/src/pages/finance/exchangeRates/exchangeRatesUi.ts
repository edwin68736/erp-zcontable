import type { ExchangeMonth, ExchangeRateDay } from '../../../services/exchangeRates';

export const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** El calendario de SUNAT empieza en domingo. */
export const WEEKDAYS_SUN = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export interface RateCell {
  /** AAAA-MM-DD */
  date: string;
  dayNum: number;
  inMonth: boolean;
  rate?: ExchangeRateDay;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** «2026-10» para un año y mes (1-12). */
export const monthKey = (year: number, month: number): string => `${year}-${pad(month)}`;

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

/** Mes anterior o posterior en «AAAA-MM». */
export function shiftMonth(key: string, delta: number): string {
  const p = parseMonthKey(key);
  if (!p) return key;
  const d = new Date(p.year, p.month - 1 + delta, 1);
  return monthKey(d.getFullYear(), d.getMonth() + 1);
}

export const currentMonthKey = (now = new Date()): string => monthKey(now.getFullYear(), now.getMonth() + 1);

/** Semanas del mes (domingo a sábado) con el tipo de cambio de cada día; los días de relleno son de los meses vecinos. */
export function buildRateWeeks(year: number, month: number, days: ExchangeRateDay[]): RateCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const cells: RateCell[] = [];
  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(year, month - 1, 1 - (first.getDay() - i));
    cells.push({ date: dateKey(d), dayNum: d.getDate(), inMonth: false });
  }
  for (let day = 1; day <= last.getDate(); day++) {
    const key = dateKey(new Date(year, month - 1, day));
    cells.push({ date: key, dayNum: day, inMonth: true, rate: byDate.get(key) });
  }
  let next = 1;
  while (cells.length % 7 !== 0) {
    const d = new Date(year, month, next++);
    cells.push({ date: dateKey(d), dayNum: d.getDate(), inMonth: false });
  }
  const weeks: RateCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Tipo de cambio con 3 decimales, como lo muestra SUNAT. */
export const fmtRate = (n: number): string => n.toFixed(3);

/** Resumen del mes: último día con valor y rango de compra/venta. */
export function monthSummary(m: ExchangeMonth): { count: number; minCompra: number; maxCompra: number; minVenta: number; maxVenta: number } | null {
  if (m.days.length === 0) return null;
  const compras = m.days.map((d) => d.compra);
  const ventas = m.days.map((d) => d.venta);
  return { count: m.days.length, minCompra: Math.min(...compras), maxCompra: Math.max(...compras), minVenta: Math.min(...ventas), maxVenta: Math.max(...ventas) };
}

/** Notas que acompañan al calendario (en pantalla y en el PDF). */
export const EXCHANGE_NOTES = [
  'El tipo de cambio publicado de una fecha es la cotización de cierre de la SBS del día hábil anterior.',
  'Los días sin tipo de cambio publicado se rigen por el del día inmediato anterior.',
  'Para efectos del Impuesto a la Renta se toma el tipo de cambio de cierre al 31 de diciembre del ejercicio correspondiente.',
];

export const EXCHANGE_SOURCE_NOTE = 'Fuente: SUNAT (obtenido a través de ApiPeru.dev y guardado en el sistema).';
