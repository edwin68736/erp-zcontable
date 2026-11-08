import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ExchangeMonth } from '../services/exchangeRates';
import {
  EXCHANGE_NOTES,
  EXCHANGE_SOURCE_NOTE,
  MONTH_NAMES,
  WEEKDAYS_SUN,
  buildRateWeeks,
  fmtRate,
} from '../pages/finance/exchangeRates/exchangeRatesUi';

const NAVY = rgb(0.05, 0.12, 0.38);
const WHITE = rgb(1, 1, 1);
const GREEN_BG = rgb(0.86, 0.94, 0.8);
const GREEN_TX = rgb(0.2, 0.4, 0.15);
const BLUE_BG = rgb(0.78, 0.89, 0.96);
const BLUE_TX = rgb(0.1, 0.3, 0.5);
const BORDER = rgb(0.8, 0.8, 0.8);
const MUTED = rgb(0.6, 0.6, 0.6);
const LIGHT = rgb(0.96, 0.96, 0.96);

/** Nombre del archivo: «tipo-de-cambio-2026-10.pdf». */
export const exchangeRatesPdfFileName = (year: number, month: number): string => `tipo-de-cambio-${year}-${String(month).padStart(2, '0')}.pdf`;

/**
 * PDF (A4 horizontal) del calendario mensual del tipo de cambio: la misma disposición que el calendario de SUNAT
 * (domingo a sábado) con la compra y la venta de cada día.
 */
export async function buildExchangeRatesPdf(m: ExchangeMonth, opts: { firmName?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 841.89;
  const H = 595.28;
  const page = doc.addPage([W, H]);
  const MG = 30;

  // Título
  const title = `Tipo de cambio mensual — ${MONTH_NAMES[m.month - 1]} ${m.year}`;
  page.drawText(title, { x: MG, y: H - MG - 14, size: 17, font: bold, color: NAVY });
  page.drawText(`Dólar de los Estados Unidos de América (USD) · compra y venta · SUNAT`, { x: MG, y: H - MG - 30, size: 9, font, color: MUTED });
  if (opts.firmName) {
    const w = font.widthOfTextAtSize(opts.firmName, 9);
    page.drawText(opts.firmName, { x: W - MG - w, y: H - MG - 14, size: 9, font, color: MUTED });
  }

  // Cuadrícula
  const weeks = buildRateWeeks(m.year, m.month, m.days);
  const gridTop = H - MG - 48;
  const headH = 18;
  const cw = (W - MG * 2) / 7;
  const footerH = 72;
  const rowH = Math.min(70, (gridTop - headH - MG - footerH) / weeks.length);

  WEEKDAYS_SUN.forEach((d, i) => {
    const x = MG + i * cw;
    page.drawRectangle({ x, y: gridTop - headH, width: cw, height: headH, color: NAVY, borderColor: WHITE, borderWidth: 0.5 });
    const tw = bold.widthOfTextAtSize(d, 9);
    page.drawText(d, { x: x + (cw - tw) / 2, y: gridTop - headH + 6, size: 9, font: bold, color: WHITE });
  });

  weeks.forEach((week, wi) => {
    const y0 = gridTop - headH - (wi + 1) * rowH;
    week.forEach((c, ci) => {
      const x = MG + ci * cw;
      page.drawRectangle({ x, y: y0, width: cw, height: rowH, color: c.inMonth ? WHITE : LIGHT, borderColor: BORDER, borderWidth: 0.5 });
      page.drawText(String(c.dayNum), { x: x + 5, y: y0 + rowH - 12, size: 9, font: c.inMonth ? bold : font, color: c.inMonth ? NAVY : MUTED });
      if (!c.rate || !c.inMonth) return;
      const bw = cw - 10;
      const bh = 15;
      const chip = (label: string, value: string, y: number, bg: ReturnType<typeof rgb>, tx: ReturnType<typeof rgb>) => {
        page.drawRectangle({ x: x + 5, y, width: bw, height: bh, color: bg, borderColor: BORDER, borderWidth: 0.4 });
        page.drawText(`${label} ${value}`, { x: x + 9, y: y + 4.5, size: 8.5, font: bold, color: tx });
      };
      chip('Compra', fmtRate(c.rate.compra), y0 + rowH - 12 - 4 - bh - 2, GREEN_BG, GREEN_TX);
      chip('Venta', fmtRate(c.rate.venta), y0 + rowH - 12 - 4 - bh * 2 - 4, BLUE_BG, BLUE_TX);
    });
  });

  // Notas
  let ny = MG + footerH - 14;
  page.drawText('Notas', { x: MG, y: ny, size: 9, font: bold, color: NAVY });
  EXCHANGE_NOTES.forEach((n, i) => {
    ny -= 11;
    page.drawText(`${i + 1}.- ${n}`, { x: MG, y: ny, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
  });
  ny -= 13;
  page.drawText(EXCHANGE_SOURCE_NOTE, { x: MG, y: ny, size: 7.5, font, color: MUTED });
  const stamp = `Generado el ${new Date().toLocaleDateString('es-PE')}`;
  page.drawText(stamp, { x: W - MG - font.widthOfTextAtSize(stamp, 7.5), y: ny, size: 7.5, font, color: MUTED });

  return doc.save();
}
