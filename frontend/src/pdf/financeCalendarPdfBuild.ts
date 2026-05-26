import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import type { FinanceCalendarDetail } from '../services/financeCalendar';
import {
  WEEKDAYS,
  activitiesForDay,
  activitySpanDays,
  buildMonthGrid,
  chunkWeeks,
  formatPeriodLabel,
  localDateKey,
  marksByDayKey,
} from '../pages/finance/calendar/calendarUtils';

const GREEN = rgb(0.02, 0.59, 0.41); // primary-600
const GREEN_DARK = rgb(0.02, 0.47, 0.33);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.45, 0.45, 0.45);
const RED = rgb(0.75, 0.15, 0.15);
const BLUE = rgb(0.1, 0.35, 0.65);
const BORDER = rgb(0.82, 0.82, 0.82);
const LIGHT = rgb(0.96, 0.96, 0.96);

const M = 28;
const HEADER_H = 22;
const DAY_BAR_H = 14;
const FONT = 6;
const PAGE_W = 842;
const PAGE_H = 595;

function topY(page: PDFPage, fromTop: number) {
  return page.getHeight() - fromTop;
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

function markColor(kind: string) {
  if (kind === 'feriado') return RED;
  if (kind === 'festividad') return rgb(0.45, 0.2, 0.55);
  return BLUE;
}

export async function buildFinanceCalendarPdf(detail: FinanceCalendarDetail): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  const pageW = PAGE_W;
  const pageH = PAGE_H;
  const contentW = pageW - M * 2;

  const colW = contentW / 7;
  const periodLabel = formatPeriodLabel(detail.period_ym);
  let y = M;

  page.drawText('ZContable — Calendario de actividades', {
    x: M,
    y: topY(page, y + 12),
    size: 11,
    font: fontBold,
    color: BLACK,
  });
  page.drawText(periodLabel, {
    x: M,
    y: topY(page, y + 26),
    size: 10,
    font,
    color: GRAY,
  });
  if (detail.is_closed) {
    page.drawText('(Calendario cerrado)', {
      x: M + font.widthOfTextAtSize(periodLabel, 10) + 8,
      y: topY(page, y + 26),
      size: 9,
      font: fontBold,
      color: GREEN_DARK,
    });
  }
  y += 38;

  // Cabecera días
  WEEKDAYS.forEach((day, i) => {
    const x = M + i * colW;
    page.drawRectangle({
      x,
      y: topY(page, y + HEADER_H),
      width: colW - 1,
      height: HEADER_H,
      color: GREEN,
    });
    const tw = fontBold.widthOfTextAtSize(day.toUpperCase(), 7);
    page.drawText(day.toUpperCase(), {
      x: x + (colW - 1 - tw) / 2,
      y: topY(page, y + HEADER_H / 2 + 2.5),
      size: 7,
      font: fontBold,
      color: WHITE,
    });
  });
  y += HEADER_H + 2;

  const cells = buildMonthGrid(detail.period_ym);
  const weeks = chunkWeeks(cells);
  const markMap = marksByDayKey(detail.marks ?? []);
  const acts = detail.activities ?? [];

  const drawWeek = (weekIdx: number) => {
    const week = weeks[weekIdx];
    let maxLines = 1;
    const cellData = week.map((cell) => {
      if (!cell.inMonth) return { cell, lines: [] as { text: string; color: ReturnType<typeof rgb> }[] };
      const key = localDateKey(cell.date);
      const lines: { text: string; color: ReturnType<typeof rgb> }[] = [];
      for (const m of markMap.get(key) ?? []) {
        lines.push({ text: m.label.toUpperCase(), color: markColor(m.kind) });
      }
      for (const a of activitiesForDay(acts, cell.dayNum)) {
        const { start, end } = activitySpanDays(a);
        const span =
          start !== end ? ` (${start}-${end})` : '';
        lines.push({ text: `${a.name}${span}`, color: BLACK });
      }
      maxLines = Math.max(maxLines, Math.max(lines.length, 1));
      return { cell, lines };
    });

    const rowH = DAY_BAR_H + maxLines * (FONT + 2) + 6;
    const needed = y + rowH + M;
    if (needed > pageH && weekIdx > 0) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = M;
      WEEKDAYS.forEach((day, i) => {
        const x = M + i * colW;
        page.drawRectangle({ x, y: topY(page, y + HEADER_H), width: colW - 1, height: HEADER_H, color: GREEN });
        const tw = fontBold.widthOfTextAtSize(day.toUpperCase(), 7);
        page.drawText(day.toUpperCase(), {
          x: x + (colW - 1 - tw) / 2,
          y: topY(page, y + HEADER_H / 2 + 2.5),
          size: 7,
          font: fontBold,
          color: WHITE,
        });
      });
      y += HEADER_H + 2;
    }

    cellData.forEach(({ cell, lines }, colIdx) => {
      const x = M + colIdx * colW;
      const w = colW - 1;
      const cellTop = y;

      page.drawRectangle({
        x,
        y: topY(page, cellTop + rowH),
        width: w,
        height: rowH,
        borderColor: BORDER,
        borderWidth: 0.5,
        color: cell.inMonth ? WHITE : LIGHT,
      });

      if (cell.inMonth) {
        page.drawRectangle({
          x,
          y: topY(page, cellTop + DAY_BAR_H),
          width: w,
          height: DAY_BAR_H,
          color: GREEN,
        });
        const dn = String(cell.dayNum);
        const dtw = fontBold.widthOfTextAtSize(dn, 8);
        page.drawText(dn, {
          x: x + (w - dtw) / 2,
          y: topY(page, cellTop + DAY_BAR_H / 2 + 2.5),
          size: 8,
          font: fontBold,
          color: WHITE,
        });

        let ly = cellTop + DAY_BAR_H + 4;
        const maxChars = Math.max(8, Math.floor(w / (FONT * 0.45)));
        for (const item of lines) {
          const wrapped = wrapLines(item.text, maxChars, 2);
          for (const ln of wrapped) {
            page.drawText(ln, {
              x: x + 2,
              y: topY(page, ly + FONT),
              size: FONT,
              font,
              color: item.color,
            });
            ly += FONT + 2;
          }
        }
      }
    });

    y += rowH + 1;
  };

  for (let wi = 0; wi < weeks.length; wi++) drawWeek(wi);

  if (detail.notes?.trim()) {
    y += 8;
    if (y + 30 > pageH) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = M;
    }
    page.drawText(`Notas: ${detail.notes.trim()}`, {
      x: M,
      y: topY(page, y + 10),
      size: 8,
      font,
      color: GRAY,
      maxWidth: contentW,
    });
  }

  return doc.save();
}

export function financeCalendarPdfFilename(periodYm: string): string {
  return `calendario-${periodYm}.pdf`;
}
