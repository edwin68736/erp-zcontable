import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFFont, type PDFPage } from 'pdf-lib';
import type { FinanceCalendarDetail } from '../services/financeCalendar';
import { loadImageBlobForPdf, rasterizeImageBlobToPngForPdf } from '../utils/pdfLogo';
import {
  WEEKDAYS,
  activitiesForDay,
  activitySpanDays,
  buildMonthGrid,
  chunkWeeks,
  formatPeriodPdfTitle,
  localDateKey,
  marksByDayKey,
  activityTextDisplayColor,
} from '../pages/finance/calendar/calendarUtils';

/** Imágenes fijas en `frontend-react/public/` para el pie del PDF del calendario. */
export const CALENDAR_PDF_PUBLIC_FOOTER_LEFT = 'calendario-pdf-ilustracion.png';
export const CALENDAR_PDF_PUBLIC_FOOTER_LOGO = 'calendario-pdf-logo.png';

const GREEN = rgb(0.08, 0.38, 0.18);
const NAVY = rgb(0.05, 0.12, 0.38);
const WHITE = rgb(1, 1, 1);
const RED = rgb(0.75, 0.12, 0.12);
const BLUE = rgb(0.1, 0.35, 0.65);
const BORDER = rgb(0.82, 0.82, 0.82);
const LIGHT = rgb(0.96, 0.96, 0.96);

const M = 28;
/** Espacio entre margen superior y inicio de la grilla (título justo encima). */
const TOP_HEADER_H = 32;
const TITLE_SIZE = 34;
const TITLE_GRID_GAP = 5;
const FOOTER_OJO_H = 16;
const FOOTER_ROW_H = 68;
const FOOTER_COL_PAD = 6;
/** Logo zContable (pie derecho): más pequeño que el ancho de columna. */
const FOOTER_LOGO_MAX_W = 168;
const FOOTER_LOGO_MAX_H = 54;
const CELL_PAD_X = 4;
const FOOTER_TOTAL = FOOTER_OJO_H + FOOTER_ROW_H + 6;
const HEADER_H = 22;
/** Espacio entre la fila de días (LUNES–DOMINGO) y la primera semana del calendario. */
const WEEKDAY_HEADER_BOTTOM_GAP = 8;
const DAY_BAR_H = 14;
const MARK_FONT = 6;
const MARK_LINE_H = MARK_FONT + 2;
/** Actividades: más grandes y en negrita para que el rojo (y otros colores) se lean en impresión. */
const ACTIVITY_FONT = 7.5;
const ACTIVITY_LINE_H = ACTIVITY_FONT + 2.5;
const ACTIVITY_MAX_LINES = 5;
const MIN_ROW_BODY_H = 48;
const ROW_GAP = 1;
const PAGE_W = 842;
const PAGE_H = 595;

const FOOTER_NOTICE = 'REVISAR BUZONES LOS DIAS MIERCOLES Y SABADO';

type PdfLine = {
  text: string;
  color: ReturnType<typeof rgb>;
  kind: 'mark' | 'activity';
};

type WeekCellData = {
  cell: ReturnType<typeof buildMonthGrid>[number];
  lines: PdfLine[];
  innerW: number;
};

export type FinanceCalendarPdfOptions = {
  /** Logo del estudio (FirmConfig.logo_url). */
  firmLogoUrl?: string | null;
  /** Aviso central del pie; por defecto el texto estándar del estudio. */
  footerNotice?: string;
};

function publicBaseUrl(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.BASE_URL === 'string') {
    return import.meta.env.BASE_URL;
  }
  return '/';
}

async function fetchPublicAsset(filename: string): Promise<{ bytes: Uint8Array; blob: Blob } | null> {
  if (typeof fetch === 'undefined') return null;
  const path = `${publicBaseUrl()}${filename.replace(/^\//, '')}`;
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), blob };
  } catch {
    return null;
  }
}

async function tryEmbedPngJpeg(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  if (!bytes.length) return null;
  try {
    return await doc.embedPng(bytes);
  } catch {
    /* noop */
  }
  try {
    return await doc.embedJpg(bytes);
  } catch {
    /* noop */
  }
  return null;
}

async function embedImageBytes(
  doc: PDFDocument,
  bytes: Uint8Array | null,
  sourceBlob?: Blob | null,
): Promise<PDFImage | null> {
  if (!bytes?.length) return null;
  const direct = await tryEmbedPngJpeg(doc, bytes);
  if (direct) return direct;
  const blob =
    sourceBlob && sourceBlob.size > 0
      ? sourceBlob
      : new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const png = await rasterizeImageBlobToPngForPdf(blob);
  if (!png?.size) return null;
  return tryEmbedPngJpeg(doc, new Uint8Array(await png.arrayBuffer()));
}

function maxLinesForKind(kind: PdfLine['kind']): number {
  return kind === 'activity' ? ACTIVITY_MAX_LINES : 2;
}

function lineHeightForKind(kind: PdfLine['kind']): number {
  return kind === 'activity' ? ACTIVITY_LINE_H : MARK_LINE_H;
}

function fontSizeForKind(kind: PdfLine['kind']): number {
  return kind === 'activity' ? ACTIVITY_FONT : MARK_FONT;
}

function fontForKind(kind: PdfLine['kind'], font: PDFFont, fontBold: PDFFont): PDFFont {
  return kind === 'activity' ? fontBold : font;
}

/** Ajuste de líneas por ancho real en pt (evita que el texto bold se salga de la celda). */
function wrapLinesByWidth(
  text: string,
  face: PDFFont,
  size: number,
  maxWidthPt: number,
  maxLines: number,
): string[] {
  const t = (text ?? '').trim();
  if (!t || maxWidthPt <= 4) return [];

  const fits = (s: string) => face.widthOfTextAtSize(s, size) <= maxWidthPt;
  const lines: string[] = [];
  let cur = '';

  const flush = () => {
    if (!cur) return;
    lines.push(cur);
    cur = '';
  };

  const pushLongToken = (token: string) => {
    let chunk = '';
    for (const ch of token) {
      const next = chunk + ch;
      if (fits(next)) {
        chunk = next;
      } else {
        if (chunk) {
          flush();
          if (lines.length >= maxLines) return;
        }
        chunk = fits(ch) ? ch : '…';
      }
    }
    cur = chunk;
  };

  for (const word of t.split(/\s+/).filter(Boolean)) {
    if (lines.length >= maxLines) break;
    const next = cur ? `${cur} ${word}` : word;
    if (fits(next)) {
      cur = next;
      continue;
    }
    flush();
    if (lines.length >= maxLines) break;
    if (!fits(word)) {
      pushLongToken(word);
    } else {
      cur = word;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function wrapPdfLines(
  lines: PdfLine[],
  innerW: number,
  font: PDFFont,
  fontBold: PDFFont,
): Array<{ text: string; color: ReturnType<typeof rgb>; kind: PdfLine['kind'] }> {
  const out: Array<{ text: string; color: ReturnType<typeof rgb>; kind: PdfLine['kind'] }> = [];
  for (const item of lines) {
    const size = fontSizeForKind(item.kind);
    const face = fontForKind(item.kind, font, fontBold);
    const wrapped = wrapLinesByWidth(item.text, face, size, innerW, maxLinesForKind(item.kind));
    for (const text of wrapped) {
      out.push({ text, color: item.color, kind: item.kind });
    }
  }
  return out;
}

function totalTextBlockHeight(
  lines: PdfLine[],
  innerW: number,
  font: PDFFont,
  fontBold: PDFFont,
): number {
  const rendered = wrapPdfLines(lines, innerW, font, fontBold);
  return rendered.reduce((sum, ln) => sum + lineHeightForKind(ln.kind), 0);
}

function buildWeekCellData(
  week: ReturnType<typeof chunkWeeks>[number],
  markMap: ReturnType<typeof marksByDayKey>,
  acts: FinanceCalendarDetail['activities'],
  colW: number,
  font: PDFFont,
  fontBold: PDFFont,
): { cellData: WeekCellData[]; rowH: number } {
  const innerW = colW - 1 - CELL_PAD_X * 2;
  let maxTextBlockH = 0;

  const cellData = week.map((cell) => {
    if (!cell.inMonth) {
      return { cell, lines: [] as PdfLine[], innerW };
    }
    const key = localDateKey(cell.date);
    const lines: PdfLine[] = [];
    for (const m of markMap.get(key) ?? []) {
      lines.push({ text: m.label.toUpperCase(), color: markColor(m.kind), kind: 'mark' });
    }
    for (const a of activitiesForDay(acts ?? [], cell.dayNum)) {
      const { start, end } = activitySpanDays(a);
      const span = start !== end ? ` (${start}-${end})` : '';
      lines.push({
        text: `${a.name}${span}`,
        color: activityTextPdfColor(a.text_color),
        kind: 'activity',
      });
    }
    maxTextBlockH = Math.max(maxTextBlockH, totalTextBlockHeight(lines, innerW, font, fontBold));
    return { cell, lines, innerW };
  });

  const bodyH = Math.max(MIN_ROW_BODY_H, maxTextBlockH + CELL_PAD_X * 2);
  const rowH = DAY_BAR_H + bodyH;
  return { cellData, rowH };
}

function drawWeekdayHeader(page: PDFPage, y: number, colW: number, fontBold: PDFFont) {
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
}

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

/** Colores de actividad reforzados para impresión/PDF (rojos y tonos claros más legibles). */
function activityTextPdfColor(hex?: string) {
  const h = activityTextDisplayColor(hex).replace('#', '');
  let r = parseInt(h.slice(0, 2), 16);
  let g = parseInt(h.slice(2, 4), 16);
  let b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const boost = lum < 0.45 ? 0.9 : 0.72;
  r = Math.round(r * boost);
  g = Math.round(g * boost);
  b = Math.round(b * boost);
  if (r > g * 1.35 && r > b * 1.35) {
    r = Math.min(220, Math.max(r, 165));
    g = Math.min(g, Math.round(g * 0.55));
    b = Math.min(b, Math.round(b * 0.55));
  }
  return rgb(r / 255, g / 255, b / 255);
}

function drawImageFit(
  page: PDFPage,
  img: PDFImage,
  x: number,
  top: number,
  maxW: number,
  maxH: number,
  align: 'left' | 'center' | 'right' = 'left',
) {
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  let drawX = x;
  if (align === 'center') drawX = x + (maxW - w) / 2;
  if (align === 'right') drawX = x + maxW - w;
  page.drawImage(img, {
    x: drawX,
    y: topY(page, top + (maxH + h) / 2),
    width: w,
    height: h,
  });
}

/** Imagen centrada horizontal y vertical dentro de una celda del pie (3 columnas). */
function drawImageFitInBox(
  page: PDFPage,
  img: PDFImage,
  boxX: number,
  boxTop: number,
  boxW: number,
  boxH: number,
  maxW = boxW,
  maxH = boxH,
) {
  const padW = Math.max(0, boxW - FOOTER_COL_PAD * 2);
  const padH = Math.max(0, boxH - FOOTER_COL_PAD * 2);
  const limitW = Math.min(maxW, padW);
  const limitH = Math.min(maxH, padH);
  const scale = Math.min(limitW / img.width, limitH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const drawX = boxX + (boxW - w) / 2;
  const imgTop = boxTop + (boxH - h) / 2;
  page.drawImage(img, {
    x: drawX,
    y: topY(page, imgTop + h),
    width: w,
    height: h,
  });
}

function drawPageHeader(
  page: PDFPage,
  title: string,
  firmLogo: PDFImage | null,
  fontTitle: PDFFont,
) {
  const pageW = page.getWidth();
  const logoMaxH = 34;
  const logoMaxW = 110;

  if (firmLogo) {
    drawImageFit(page, firmLogo, M, 6, logoMaxW, logoMaxH, 'left');
  }

  const gridTop = M + TOP_HEADER_H;
  const titleBaselineFromTop = gridTop - TITLE_GRID_GAP;
  const tw = fontTitle.widthOfTextAtSize(title, TITLE_SIZE);
  page.drawText(title, {
    x: (pageW - tw) / 2,
    y: topY(page, titleBaselineFromTop),
    size: TITLE_SIZE,
    font: fontTitle,
    color: NAVY,
  });
}

function drawPageFooter(
  page: PDFPage,
  fontBold: PDFFont,
  leftImg: PDFImage | null,
  rightImg: PDFImage | null,
  notice: string,
) {
  const pageW = page.getWidth();
  const pageH = page.getHeight();
  const contentW = pageW - M * 2;
  const footerTop = pageH - M - FOOTER_TOTAL;

  page.drawRectangle({
    x: M,
    y: topY(page, footerTop + FOOTER_OJO_H),
    width: contentW,
    height: FOOTER_OJO_H,
    color: GREEN,
  });
  const ojo = 'OJO';
  const ojoSize = 9;
  const ojoW = fontBold.widthOfTextAtSize(ojo, ojoSize);
  page.drawText(ojo, {
    x: M + (contentW - ojoW) / 2,
    y: topY(page, footerTop + FOOTER_OJO_H / 2 + 3),
    size: ojoSize,
    font: fontBold,
    color: WHITE,
  });

  const rowTop = footerTop + FOOTER_OJO_H + 4;
  const colW = contentW / 3;
  const noticeSize = 9;
  const noticeLineStep = noticeSize + 3;
  const noticeMaxChars = Math.max(12, Math.floor((colW - FOOTER_COL_PAD * 2) / (noticeSize * 0.52)));
  const noticeLines = wrapLines(notice.toUpperCase(), noticeMaxChars, 3);
  const noticeBlockH =
    noticeLines.length > 0 ? noticeLines.length * noticeLineStep - 3 : 0;
  const noticeStartY = rowTop + (FOOTER_ROW_H - noticeBlockH) / 2 + noticeSize;
  noticeLines.forEach((ln, i) => {
    const lw = fontBold.widthOfTextAtSize(ln, noticeSize);
    page.drawText(ln, {
      x: M + colW + (colW - lw) / 2,
      y: topY(page, noticeStartY + i * noticeLineStep),
      size: noticeSize,
      font: fontBold,
      color: RED,
    });
  });

  if (leftImg) {
    drawImageFitInBox(page, leftImg, M, rowTop, colW, FOOTER_ROW_H);
  }
  if (rightImg) {
    drawImageFitInBox(
      page,
      rightImg,
      M + colW * 2,
      rowTop,
      colW,
      FOOTER_ROW_H,
      FOOTER_LOGO_MAX_W,
      FOOTER_LOGO_MAX_H,
    );
  }
}

export async function buildFinanceCalendarPdf(
  detail: FinanceCalendarDetail,
  options: FinanceCalendarPdfOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontTitle = await doc.embedFont(StandardFonts.HelveticaBold);

  const [firmLogoBlob, footerLeftAsset, footerLogoAsset] = await Promise.all([
    loadImageBlobForPdf(options.firmLogoUrl),
    fetchPublicAsset(CALENDAR_PDF_PUBLIC_FOOTER_LEFT),
    fetchPublicAsset(CALENDAR_PDF_PUBLIC_FOOTER_LOGO),
  ]);

  const [firmLogoImg, footerLeftImg, footerLogoImg] = await Promise.all([
    firmLogoBlob
      ? embedImageBytes(doc, new Uint8Array(await firmLogoBlob.arrayBuffer()), firmLogoBlob)
      : Promise.resolve(null),
    footerLeftAsset
      ? embedImageBytes(doc, footerLeftAsset.bytes, footerLeftAsset.blob)
      : Promise.resolve(null),
    footerLogoAsset
      ? embedImageBytes(doc, footerLogoAsset.bytes, footerLogoAsset.blob)
      : Promise.resolve(null),
  ]);

  const notice = (options.footerNotice ?? FOOTER_NOTICE).trim() || FOOTER_NOTICE;
  const periodTitle = formatPeriodPdfTitle(detail.period_ym);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  const pageW = PAGE_W;
  const pageH = PAGE_H;
  const contentW = pageW - M * 2;
  const colW = contentW / 7;

  drawPageHeader(page, periodTitle, firmLogoImg, fontTitle);

  let y = M + TOP_HEADER_H;
  drawWeekdayHeader(page, y, colW, fontBold);
  y += HEADER_H + WEEKDAY_HEADER_BOTTOM_GAP;

  const cells = buildMonthGrid(detail.period_ym);
  const weeks = chunkWeeks(cells);
  const markMap = marksByDayKey(detail.marks ?? []);
  const acts = detail.activities ?? [];

  const weekPlans = weeks.map((week) => buildWeekCellData(week, markMap, acts, colW, font, fontBold));
  let rowHeights = weekPlans.map((p) => p.rowH);

  const bottomReserve = M + FOOTER_TOTAL;
  const gridArea = pageH - y - bottomReserve;
  const totalGaps = Math.max(0, weeks.length - 1) * ROW_GAP;
  const totalRows = rowHeights.reduce((sum, h) => sum + h, 0);
  if (totalRows + totalGaps < gridArea) {
    const extra = (gridArea - totalRows - totalGaps) / weeks.length;
    rowHeights = rowHeights.map((h) => h + extra);
  }

  const drawWeekRow = (cellData: WeekCellData[], rowH: number) => {
    cellData.forEach(({ cell, lines, innerW }, colIdx) => {
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

        const bodyTop = cellTop + DAY_BAR_H;
        const bodyH = rowH - DAY_BAR_H;
        const rendered = wrapPdfLines(lines, innerW, font, fontBold);
        const textBlockH = rendered.reduce((sum, ln) => sum + lineHeightForKind(ln.kind), 0);
        let ly = bodyTop + Math.max(CELL_PAD_X, (bodyH - textBlockH) / 2);
        for (const item of rendered) {
          const size = item.kind === 'activity' ? ACTIVITY_FONT : MARK_FONT;
          const lineH = lineHeightForKind(item.kind);
          const face = item.kind === 'activity' ? fontBold : font;
          if (ly + size > cellTop + rowH - CELL_PAD_X) break;
          const lw = face.widthOfTextAtSize(item.text, size);
          page.drawText(item.text, {
            x: x + CELL_PAD_X + Math.max(0, (innerW - lw) / 2),
            y: topY(page, ly + size),
            size,
            font: face,
            color: item.color,
          });
          ly += lineH;
        }
      }
    });

    y += rowH + ROW_GAP;
  };

  for (let wi = 0; wi < weeks.length; wi++) {
    const rowH = rowHeights[wi] ?? MIN_ROW_BODY_H + DAY_BAR_H;
    const pageBottom = pageH - bottomReserve;
    if (y + rowH > pageBottom && wi > 0) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = M;
      drawWeekdayHeader(page, y, colW, fontBold);
      y += HEADER_H + WEEKDAY_HEADER_BOTTOM_GAP;
      const remaining = weeks.length - wi;
      const remainingHeights = rowHeights.slice(wi);
      const area = pageH - y - M;
      const gaps = Math.max(0, remaining - 1) * ROW_GAP;
      const sum = remainingHeights.reduce((a, b) => a + b, 0);
      if (sum + gaps < area) {
        const extra = (area - sum - gaps) / remaining;
        for (let j = wi; j < weeks.length; j++) {
          rowHeights[j] = (rowHeights[j] ?? rowH) + extra;
        }
      }
    }
    drawWeekRow(weekPlans[wi]!.cellData, rowHeights[wi]!);
  }

  const pages = doc.getPages();
  const lastPage = pages[pages.length - 1]!;
  drawPageFooter(lastPage, fontBold, footerLeftImg, footerLogoImg, notice);

  return doc.save();
}

export function financeCalendarPdfFilename(periodYm: string): string {
  return `calendario-${periodYm}.pdf`;
}
