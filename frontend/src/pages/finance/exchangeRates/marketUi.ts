import type { MarketPoint } from '../../../services/exchangeRates';

export type MarketRangeKey = '5D' | '1M' | '6M' | '1A';

/** Rangos del gráfico (como el de Google): 5D son los últimos 5 días con dato; los demás, días corridos hasta el último dato. */
export const MARKET_RANGES: { key: MarketRangeKey; label: string; days: number | null; count?: number }[] = [
  { key: '5D', label: '5D', days: null, count: 5 },
  { key: '1M', label: '1 M', days: 30 },
  { key: '6M', label: '6 M', days: 182 },
  { key: '1A', label: '1 A', days: 365 },
];

const dayNum = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/** Los puntos del historial que entran en el rango elegido. */
export function sliceRange(points: MarketPoint[], key: MarketRangeKey): MarketPoint[] {
  if (points.length === 0) return [];
  const r = MARKET_RANGES.find((x) => x.key === key) ?? MARKET_RANGES[1];
  if (r.days == null) return points.slice(-(r.count ?? 5));
  const from = dayNum(points[points.length - 1].date) - r.days;
  return points.filter((p) => dayNum(p.date) >= from);
}

/** Conversión: dólares → soles (`usd`) o soles → dólares (`pen`). */
export function convert(amount: number, rate: number, from: 'usd' | 'pen'): number {
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return NaN;
  return from === 'usd' ? amount * rate : amount / rate;
}

/** Lo que escribe la persona («1,250.50», «1250,5», «1 250.5») → número; NaN si no es un importe válido. */
export function parseAmount(text: string): number {
  let s = text.trim().replace(/\s/g, '');
  if (s === '') return NaN;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (comma >= 0) s = /,\d{1,2}$/.test(s) && s.indexOf(',') === comma ? s.replace(',', '.') : s.replace(/,/g, '');
  return /^\d*\.?\d+$|^\d+\.$/.test(s) ? Number(s) : NaN;
}

/** Importe con miles y 2 decimales para el convertidor («1,250.50»). */
export function fmtConverted(n: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tipo de cambio con 3 decimales («3.415»). */
export const fmtMarketRate = (n: number): string => (Number.isFinite(n) ? n.toFixed(3) : '—');

export interface ChartGeometry {
  line: string;
  area: string;
  coords: { x: number; y: number; point: MarketPoint }[];
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  min: number;
  max: number;
}

const DD_MM = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Geometría del gráfico de línea (SVG) dentro de un recuadro `w × h` con márgenes. */
export function chartGeometry(points: MarketPoint[], w: number, h: number, pad = { l: 44, r: 12, t: 10, b: 24 }): ChartGeometry | null {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 0.01) {
    min -= 0.01;
    max += 0.01;
  }
  const margin = (max - min) * 0.08;
  min -= margin;
  max += margin;
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * iw;
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * ih;
  const coords = points.map((p, i) => ({ x: x(i), y: y(p.value), point: p }));
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(pad.t + ih).toFixed(1)} L${coords[0].x.toFixed(1)},${(pad.t + ih).toFixed(1)} Z`;
  const yTicks = [0, 1, 2, 3].map((k) => {
    const v = min + ((max - min) * k) / 3;
    return { y: y(v), label: v.toFixed(2) };
  });
  const nx = Math.min(4, points.length);
  const xTicks = Array.from({ length: nx }, (_, k) => {
    const i = Math.round((k / (nx - 1)) * (points.length - 1));
    return { x: x(i), label: DD_MM(points[i].date) };
  });
  return { line, area, coords, yTicks, xTicks, min, max };
}
