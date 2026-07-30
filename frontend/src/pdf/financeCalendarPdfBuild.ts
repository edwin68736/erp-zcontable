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

const M = 30;
/**
 * Columnas del calendario en el PDF: solo días laborables (Lunes–Sábado).
 * El domingo se omite —no se trabaja— para dar más ancho a los días con actividades.
 * La grilla de datos (buildMonthGrid/chunkWeeks) sigue siendo de 7 días; el domingo
 * se recorta al dibujar. No se toca WEEKDAYS compartido con el calendario web.
 */
const PDF_WEEKDAYS = WEEKDAYS.slice(0, 6);
const PDF_DAYS_PER_WEEK = PDF_WEEKDAYS.length;
/** Espacio entre margen superior y inicio de la grilla (título justo encima). */
const TOP_HEADER_H = 32;
const TITLE_SIZE = 30;
const TITLE_GRID_GAP = 6;
const FOOTER_OJO_H = 18;
const FOOTER_ROW_H = 78;
const FOOTER_COL_PAD = 6;
/** Logo zContable (pie derecho): más pequeño que el ancho de columna. */
const FOOTER_LOGO_MAX_W = 190;
const FOOTER_LOGO_MAX_H = 62;
const CELL_PAD_X = 4;
const FOOTER_TOTAL = FOOTER_OJO_H + FOOTER_ROW_H + 6;
const HEADER_H = 24;
/** Espacio entre la fila de días (LUNES–DOMINGO) y la primera semana del calendario. */
const WEEKDAY_HEADER_BOTTOM_GAP = 8;
const DAY_BAR_H = 16;
const MARK_FONT = 7;
const MARK_LINE_H = MARK_FONT + 2;
/** Actividades: más grandes y en negrita para que el rojo (y otros colores) se lean en impresión. */
const ACTIVITY_FONT = 8.5;
const ACTIVITY_LINE_H = ACTIVITY_FONT + 2.5;
const ACTIVITY_MAX_LINES = 5;
const MIN_ROW_BODY_H = 52;
const ROW_GAP = 2;
/**
 * Tamaño de hoja: A3 horizontal (en vez de A4) para dar mucho más espacio vertical
 * y horizontal al calendario, de forma que el texto pueda ser más grande y nítido
 * y casi nunca haga falta encoger. El algoritmo de ajuste (`fitMetricsForWeeks`)
 * sigue garantizando que TODO el calendario entra en una sola página aunque el
 * mes tenga muchísimas actividades.
 */
const PAGE_W = 1191;
const PAGE_H = 842;
/** Piso mínimo de escala: por debajo de esto el texto deja de ser legible. */
const MIN_FIT_SCALE = 0.55;
const FIT_SCALE_STEP = 0.04;

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

/** Métricas de tamaño de celda, escalables para el ajuste "una sola hoja". */
type SizeMetrics = {
  scale: number;
  activityFont: number;
  activityLineH: number;
  markFont: number;
  markLineH: number;
  minRowBodyH: number;
  cellPadX: number;
  dayBarH: number;
  dayNumFont: number;
  rowGap: number;
};

function baseSizeMetrics(): SizeMetrics {
  return {
    scale: 1,
    activityFont: ACTIVITY_FONT,
    activityLineH: ACTIVITY_LINE_H,
    markFont: MARK_FONT,
    markLineH: MARK_LINE_H,
    minRowBodyH: MIN_ROW_BODY_H,
    cellPadX: CELL_PAD_X,
    dayBarH: DAY_BAR_H,
    dayNumFont: 9,
    rowGap: ROW_GAP,
  };
}

/** Reduce fuentes/alturas proporcionalmente, con piso legible, para encajar en una sola página. */
function scaledSizeMetrics(scale: number): SizeMetrics {
  const b = baseSizeMetrics();
  return {
    scale,
    activityFont: Math.max(5.6, b.activityFont * scale),
    activityLineH: Math.max(7.6, b.activityLineH * scale),
    markFont: Math.max(4.8, b.markFont * scale),
    markLineH: Math.max(6.4, b.markLineH * scale),
    minRowBodyH: Math.max(24, b.minRowBodyH * scale),
    cellPadX: Math.max(2, b.cellPadX * scale),
    dayBarH: Math.max(11, b.dayBarH * scale),
    dayNumFont: Math.max(6.5, b.dayNumFont * scale),
    rowGap: b.rowGap,
  };
}

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

function lineHeightForKind(kind: PdfLine['kind'], m: SizeMetrics): number {
  return kind === 'activity' ? m.activityLineH : m.markLineH;
}

function fontSizeForKind(kind: PdfLine['kind'], m: SizeMetrics): number {
  return kind === 'activity' ? m.activityFont : m.markFont;
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
  m: SizeMetrics,
): Array<{ text: string; color: ReturnType<typeof rgb>; kind: PdfLine['kind'] }> {
  const out: Array<{ text: string; color: ReturnType<typeof rgb>; kind: PdfLine['kind'] }> = [];
  for (const item of lines) {
    const size = fontSizeForKind(item.kind, m);
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
  m: SizeMetrics,
): number {
  const rendered = wrapPdfLines(lines, innerW, font, fontBold, m);
  return rendered.reduce((sum, ln) => sum + lineHeightForKind(ln.kind, m), 0);
}

function buildWeekCellData(
  week: ReturnType<typeof chunkWeeks>[number],
  markMap: ReturnType<typeof marksByDayKey>,
  acts: FinanceCalendarDetail['activities'],
  colW: number,
  font: PDFFont,
  fontBold: PDFFont,
  m: SizeMetrics,
): { cellData: WeekCellData[]; rowH: number } {
  const innerW = colW - 1 - m.cellPadX * 2;
  let maxTextBlockH = 0;

  const cellData = week.map((cell) => {
    if (!cell.inMonth) {
      return { cell, lines: [] as PdfLine[], innerW };
    }
    const key = localDateKey(cell.date);
    const lines: PdfLine[] = [];
    for (const mark of markMap.get(key) ?? []) {
      lines.push({ text: mark.label.toUpperCase(), color: markColor(mark.kind), kind: 'mark' });
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
    maxTextBlockH = Math.max(maxTextBlockH, totalTextBlockHeight(lines, innerW, font, fontBold, m));
    return { cell, lines, innerW };
  });

  const bodyH = Math.max(m.minRowBodyH, maxTextBlockH + m.cellPadX * 2);
  const rowH = m.dayBarH + bodyH;
  return { cellData, rowH };
}

/**
 * Busca la escala más grande (1.0 hacia abajo) con la que TODAS las semanas del mes
 * caben en `gridArea` (alto disponible bajo el encabezado y sobre el pie), de forma
 * que el calendario siempre se dibuje en una sola página. Si ni siquiera el piso
 * legible (`MIN_FIT_SCALE`) alcanza, se usa igual esa escala mínima (nunca se agrega
 * una segunda página) y el sobrante se recorta proporcionalmente más abajo.
 */
function fitMetricsForWeeks(
  weeks: ReturnType<typeof chunkWeeks>,
  markMap: ReturnType<typeof marksByDayKey>,
  acts: FinanceCalendarDetail['activities'],
  colW: number,
  font: PDFFont,
  fontBold: PDFFont,
  gridArea: number,
): { metrics: SizeMetrics; weekPlans: Array<{ cellData: WeekCellData[]; rowH: number }> } {
  let scale = 1;
  let metrics = scaledSizeMetrics(scale);
  let weekPlans = weeks.map((week) => buildWeekCellData(week, markMap, acts, colW, font, fontBold, metrics));

  const totalHeight = () => {
    const rows = weekPlans.reduce((sum, p) => sum + p.rowH, 0);
    const gaps = Math.max(0, weeks.length - 1) * metrics.rowGap;
    return rows + gaps;
  };

  while (totalHeight() > gridArea && scale > MIN_FIT_SCALE) {
    scale = Math.max(MIN_FIT_SCALE, scale - FIT_SCALE_STEP);
    metrics = scaledSizeMetrics(scale);
    weekPlans = weeks.map((week) => buildWeekCellData(week, markMap, acts, colW, font, fontBold, metrics));
  }

  return { metrics, weekPlans };
}

function drawWeekdayHeader(page: PDFPage, y: number, colW: number, fontBold: PDFFont) {
  PDF_WEEKDAYS.forEach((day, i) => {
    const x = M + i * colW;
    page.drawRectangle({
      x,
      y: topY(page, y + HEADER_H),
      width: colW - 1,
      height: HEADER_H,
      color: GREEN,
    });
    const tw = fontBold.widthOfTextAtSize(day.toUpperCase(), 8);
    page.drawText(day.toUpperCase(), {
      x: x + (colW - 1 - tw) / 2,
      y: topY(page, y + HEADER_H / 2 + 2.8),
      size: 8,
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

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const pageW = PAGE_W;
  const pageH = PAGE_H;
  const contentW = pageW - M * 2;
  const colW = contentW / PDF_DAYS_PER_WEEK;

  drawPageHeader(page, periodTitle, firmLogoImg, fontTitle);

  let y = M + TOP_HEADER_H;
  drawWeekdayHeader(page, y, colW, fontBold);
  y += HEADER_H + WEEKDAY_HEADER_BOTTOM_GAP;

  const cells = buildMonthGrid(detail.period_ym);
  // chunkWeeks devuelve semanas de 7 días (Lun–Dom); recortamos el domingo (7ª celda).
  const weeks = chunkWeeks(cells).map((week) => week.slice(0, PDF_DAYS_PER_WEEK));
  const markMap = marksByDayKey(detail.marks ?? []);
  const acts = detail.activities ?? [];

  const bottomReserve = M + FOOTER_TOTAL;
  const gridArea = pageH - y - bottomReserve;

  // Encoge fuentes/alturas de fila (si hace falta) hasta que TODO el mes quepa en esta
  // única página; nunca se agrega una segunda hoja.
  const { metrics, weekPlans } = fitMetricsForWeeks(weeks, markMap, acts, colW, font, fontBold, gridArea);
  let rowHeights = weekPlans.map((p) => p.rowH);

  const totalGaps = Math.max(0, weeks.length - 1) * metrics.rowGap;
  const totalRows = rowHeights.reduce((sum, h) => sum + h, 0);
  if (totalRows + totalGaps < gridArea) {
    // Sobra espacio: reparte el extra entre filas para que el calendario llene la página.
    const extra = (gridArea - totalRows - totalGaps) / weeks.length;
    rowHeights = rowHeights.map((h) => h + extra);
  } else if (totalRows + totalGaps > gridArea) {
    // Caso extremo (ni el piso de escala alcanzó): recorta proporcionalmente para
    // garantizar que la grilla nunca se salga de la página ni empuje una segunda hoja.
    const shrink = gridArea / (totalRows + totalGaps);
    rowHeights = rowHeights.map((h) => h * shrink);
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
          y: topY(page, cellTop + metrics.dayBarH),
          width: w,
          height: metrics.dayBarH,
          color: GREEN,
        });
        const dn = String(cell.dayNum);
        const dtw = fontBold.widthOfTextAtSize(dn, metrics.dayNumFont);
        page.drawText(dn, {
          x: x + (w - dtw) / 2,
          y: topY(page, cellTop + metrics.dayBarH / 2 + metrics.dayNumFont * 0.32),
          size: metrics.dayNumFont,
          font: fontBold,
          color: WHITE,
        });

        const bodyTop = cellTop + metrics.dayBarH;
        const bodyH = rowH - metrics.dayBarH;
        const rendered = wrapPdfLines(lines, innerW, font, fontBold, metrics);
        const textBlockH = rendered.reduce((sum, ln) => sum + lineHeightForKind(ln.kind, metrics), 0);
        let ly = bodyTop + Math.max(metrics.cellPadX, (bodyH - textBlockH) / 2);
        for (const item of rendered) {
          const size = fontSizeForKind(item.kind, metrics);
          const lineH = lineHeightForKind(item.kind, metrics);
          const face = item.kind === 'activity' ? fontBold : font;
          if (ly + size > cellTop + rowH - metrics.cellPadX) break;
          const lw = face.widthOfTextAtSize(item.text, size);
          page.drawText(item.text, {
            x: x + metrics.cellPadX + Math.max(0, (innerW - lw) / 2),
            y: topY(page, ly + size),
            size,
            font: face,
            color: item.color,
          });
          ly += lineH;
        }
      }
    });

    y += rowH + metrics.rowGap;
  };

  for (let wi = 0; wi < weeks.length; wi++) {
    const rowH = rowHeights[wi] ?? metrics.minRowBodyH + metrics.dayBarH;
    drawWeekRow(weekPlans[wi]!.cellData, rowH);
  }

  drawPageFooter(page, fontBold, footerLeftImg, footerLogoImg, notice);

  return doc.save();
}

export function financeCalendarPdfFilename(periodYm: string): string {
  return `calendario-${periodYm}.pdf`;
}
