import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
  type PDFImage,
} from 'pdf-lib';
import type { AccountLedger, Company, FirmConfig } from '../types/dashboard';
import { formatLedgerDateDisplay } from '../utils/ledgerDates';
import { rasterizeImageBlobToPngForPdf } from '../utils/pdfLogo';
import { truncateDocumentNumberDisplay } from '../utils/statementDisplay';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) =>
  `S/ ${Number(n ?? 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const DEFAULT_STATEMENT_WHATSAPP =
  'Puedes solicitar tu estado de cuenta a través del grupo de WhatsApp de tu empresa o comunicándote a los números oficiales de ZContable.';

const M      = 40;   // margen lateral
const BOTTOM = 28;   // margen inferior pie de página

// ─── Paleta ───────────────────────────────────────────────────────────────────
const C = {
  green:      rgb(0.16, 0.69, 0.29),
  greenDark:  rgb(0.12, 0.55, 0.22),
  titleGreen: rgb(0.0,  0.55, 0.27),   // "CUENTA CLIENTES" en el título
  red:        rgb(0.85, 0.13, 0.13),
  redDark:    rgb(0.65, 0.08, 0.08),
  blue:       rgb(0.05, 0.25, 0.55),   // "MES: MARZO 2026" y etiquetas
  black:      rgb(0.05, 0.05, 0.05),
  darkGray:   rgb(0.20, 0.20, 0.20),
  tableHeaderBg: rgb(0.40, 0.44, 0.50), // cabecera tabla (más claro que darkGray, texto blanco)
  midGray:    rgb(0.55, 0.55, 0.55),
  lightGray:  rgb(0.94, 0.94, 0.94),   // fondo resumen / zebra
  borderGray: rgb(0.80, 0.80, 0.80),
  white:      rgb(1,    1,    1),
  textBody:   rgb(0.10, 0.10, 0.10),
  waGreen:    rgb(0.19, 0.66, 0.36), // pie: icono aviso estilo WhatsApp
  pill1:     rgb(0.48, 0.20, 0.58), // píldora bajo el QR
  pill2:     rgb(0, 0.52, 0.55),
} as const;

// ─── Columnas de la tabla ─────────────────────────────────────────────────────
const COL_FRAC   = [0.10, 0.10, 0.07, 0.07, 0.28, 0.08, 0.08, 0.08, 0.08, 0.06] as const;
const TABLE_SIZE = 6.5;
const HEAD_H     = 28;

// ─── Utilidades ───────────────────────────────────────────────────────────────

function byTop(page: PDFPage, dFromTop: number) {
  return page.getHeight() - dFromTop;
}

/** Línea base (pdf-lib) para texto centrado verticalmente en una franja [dFromTop, dFromTop+boxH] (coords. desde arriba). */
function baselineVerticallyCentered(dFromTop: number, boxH: number, fontSize: number) {
  return dFromTop + boxH / 2 + fontSize * 0.32;
}

function colStarts(contentW: number): number[] {
  const r: number[] = [M];
  for (const f of COL_FRAC) r.push(r[r.length - 1]! + f * contentW);
  return r;
}

function wrapToWidth(
  text: string,
  maxW: number,
  font: PDFFont,
  size: number,
  maxLines: number,
): string[] {
  const t = (text ?? '').replace(/\r/g, '').trim() || '—';
  const words = t.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      line = test;
    } else {
      if (line) out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  if (out.length > maxLines)
    return [...out.slice(0, maxLines - 1), `${(out[maxLines - 1] ?? '').slice(0, 30)}…`];
  return out.length ? out : ['—'];
}

function hLine(
  page: PDFPage,
  dTop: number,
  x0: number,
  x1: number,
  color = C.borderGray,
  thickness = 0.5,
) {
  page.drawLine({
    start: { x: x0, y: byTop(page, dTop) },
    end:   { x: x1, y: byTop(page, dTop) },
    thickness,
    color,
  });
}

// ─── Encabezado ───────────────────────────────────────────────────────────────
type HeaderOpts = {
  page: PDFPage; dTop: number; W: number; contentW: number;
  periodLabel: string; isDateRange: boolean;
  logo: PDFImage | null; font: PDFFont; fontB: PDFFont;
};

function drawHeader(o: HeaderOpts): number {
  const { page, dTop, W, periodLabel, isDateRange, logo, fontB } = o;

  if (logo) {
    const maxH = 26;
    const maxW = 90;
    const sc = Math.min(maxH / Math.max(logo.height, 1), maxW / Math.max(logo.width, 1));
    const dim = logo.scale(sc);
    page.drawImage(logo, {
      x: M,
      y: byTop(page, dTop) - dim.height,
      width: dim.width,
      height: dim.height,
    });
  }

  // "ESTADO DE " negro + "CUENTA CLIENTES" verde – centrado
  const titleSize = 13;
  const part1 = 'ESTADO DE ';
  const part2 = 'CUENTA CLIENTES';
  const p1W = fontB.widthOfTextAtSize(part1, titleSize);
  const p2W = fontB.widthOfTextAtSize(part2, titleSize);
  const titleX = (W - p1W - p2W) / 2;

  page.drawText(part1, { x: titleX,       y: byTop(page, dTop + 14), size: titleSize, font: fontB, color: C.black });
  page.drawText(part2, { x: titleX + p1W, y: byTop(page, dTop + 14), size: titleSize, font: fontB, color: C.titleGreen });

  // "MES: MARZO 2026" en azul – centrado
  const subLabel = `${isDateRange ? 'PERÍODO' : 'MES'}: ${periodLabel}`;
  const subSize  = 9;
  const subW     = fontB.widthOfTextAtSize(subLabel, subSize);
  page.drawText(subLabel, {
    x: (W - subW) / 2, y: byTop(page, dTop + 26),
    size: subSize, font: fontB, color: C.blue,
  });

  return 38;
}

// ─── Datos del cliente ────────────────────────────────────────────────────────
type ClientInfoOpts = {
  page: PDFPage; dTop: number; company: Company;
  font: PDFFont; fontB: PDFFont; contentW: number;
  razonLines: string[]; dirLines: string[];
};

function drawClientInfo(o: ClientInfoOpts): number {
  const { page, dTop, company, font, fontB, razonLines, dirLines } = o;
  const lSize  = 7.8;
  const lineH  = 12;
  const labelW = 92;

  const rows: Array<{ label: string; lines: string[] }> = [
    { label: 'CODIGO CLIENTE', lines: [company.code?.trim() || '—'] },
    { label: 'RAZON SOCIAL',   lines: razonLines },
    { label: 'RUC',            lines: [company.ruc || '—'] },
    { label: 'DIRECCION',      lines: dirLines },
  ];

  let y = dTop + 10;
  for (const row of rows) {
    page.drawText(row.label, {
      x: M, y: byTop(page, y),
      size: lSize, font: fontB, color: C.black,
    });
    for (let li = 0; li < row.lines.length; li++) {
      page.drawText(row.lines[li]!, {
        x: M + labelW, y: byTop(page, y + li * lineH),
        size: lSize, font, color: C.textBody,
      });
    }
    y += lineH * row.lines.length;
  }

  y += 8;
  return y - dTop;
}

// ─── Bloque resumen ───────────────────────────────────────────────────────────
type SummaryOpts = {
  page: PDFPage; dTop: number; contentW: number; W: number;
  isDateRange: boolean; vals: [string, string, string, string];
  font: PDFFont; fontB: PDFFont;
};

function drawSummary(o: SummaryOpts): number {
  const { page, dTop, contentW, W, isDateRange, vals, fontB } = o;

  // Barra título gris
  const titleBarH = 14;
  page.drawRectangle({
    x: M, y: byTop(page, dTop + titleBarH),
    width: contentW, height: titleBarH,
    color: C.lightGray,
    borderColor: C.borderGray, borderWidth: 0.4,
  });
  const sumLabel = isDateRange ? 'RESUMEN DEL PERÍODO' : 'RESUMEN DEL MES';
  const sumSize = 8.5;
  const slW = fontB.widthOfTextAtSize(sumLabel, sumSize);
  page.drawText(sumLabel, {
    x: (W - slW) / 2,
    y: byTop(page, baselineVerticallyCentered(dTop, titleBarH, sumSize)),
    size: sumSize,
    font: fontB,
    color: C.darkGray,
  });

  // Fila íconos (círculos)
  const iconRowH = 22;
  const d2  = dTop + titleBarH;
  const colW = contentW / 4;
  const c1x = M + colW + colW / 2;        // centro círculo verde (col abonos)
  const c2x = M + 2 * colW + colW / 2;   // centro círculo rojo  (col cargos)
  const yIcon    = d2 + iconRowH * 0.5;
  const yIconPdf = byTop(page, yIcon);
  const rCirc = 8;

  page.drawCircle({ x: c1x, y: yIconPdf, size: rCirc, color: C.green });
  page.drawCircle({ x: c2x, y: yIconPdf, size: rCirc, color: C.red });

  const symSize = 5;
  const sym = 'S/';
  page.drawText(sym, { x: c1x - fontB.widthOfTextAtSize(sym, symSize) / 2, y: yIconPdf - 2.5, size: symSize, font: fontB, color: C.white });
  page.drawText(sym, { x: c2x - fontB.widthOfTextAtSize(sym, symSize) / 2, y: yIconPdf - 2.5, size: symSize, font: fontB, color: C.white });

  // Bloque 4 columnas
  const d3      = d2 + iconRowH;
  const bar1H   = 10;
  const bar2H   = 9;
  const valRowH = 18;
  const blockH  = bar1H + bar2H + valRowH;

  for (let i = 0; i < 4; i++) {
    const x0   = M + i * colW;
    const fill = (i === 0 || i === 3) ? C.lightGray : C.white;
    page.drawRectangle({
      x: x0, y: byTop(page, d3 + blockH),
      width: colW, height: blockH,
      color: fill,
      borderColor: C.borderGray, borderWidth: 0.3,
    });
  }

  // ABONOS – verde
  {
    const x0 = M + colW;
    page.drawRectangle({ x: x0, y: byTop(page, d3 + bar1H), width: colW, height: bar1H, color: C.green });
    page.drawRectangle({ x: x0, y: byTop(page, d3 + bar1H + bar2H), width: colW, height: bar2H, color: C.greenDark });
    const t1 = 'ABONOS';
    const t1Size = 5.5;
    page.drawText(t1, {
      x: x0 + (colW - fontB.widthOfTextAtSize(t1, t1Size)) / 2,
      y: byTop(page, baselineVerticallyCentered(d3, bar1H, t1Size)),
      size: t1Size,
      font: fontB,
      color: C.white,
    });
    const t2 = 'PAGOS REALIZADOS POR EL CLIENTE';
    const t2S = 3.2;
    page.drawText(t2, { x: x0 + (colW - fontB.widthOfTextAtSize(t2, t2S)) / 2, y: byTop(page, d3 + bar1H + 2), size: t2S, font: fontB, color: C.white });
    const v = vals[1]!;
    const vW = fontB.widthOfTextAtSize(v, 9.5);
    page.drawText(v, { x: x0 + (colW - vW) / 2, y: byTop(page, d3 + bar1H + bar2H + valRowH - 4), size: 9.5, font: fontB, color: C.green });
  }

  // CARGOS – rojo
  {
    const x0 = M + 2 * colW;
    page.drawRectangle({ x: x0, y: byTop(page, d3 + bar1H), width: colW, height: bar1H, color: C.red });
    page.drawRectangle({ x: x0, y: byTop(page, d3 + bar1H + bar2H), width: colW, height: bar2H, color: C.redDark });
    const t1 = 'CARGOS';
    const t1Size = 5.5;
    page.drawText(t1, {
      x: x0 + (colW - fontB.widthOfTextAtSize(t1, t1Size)) / 2,
      y: byTop(page, baselineVerticallyCentered(d3, bar1H, t1Size)),
      size: t1Size,
      font: fontB,
      color: C.white,
    });
    const t2 = 'DEUDAS AL ESTUDIO';
    const t2S = 3.2;
    page.drawText(t2, { x: x0 + (colW - fontB.widthOfTextAtSize(t2, t2S)) / 2, y: byTop(page, d3 + bar1H + 2), size: t2S, font: fontB, color: C.white });
    const v = vals[2]!;
    const vW = fontB.widthOfTextAtSize(v, 9.5);
    page.drawText(v, { x: x0 + (colW - vW) / 2, y: byTop(page, d3 + bar1H + bar2H + valRowH - 4), size: 9.5, font: fontB, color: C.red });
  }

  // Saldo anterior / saldo final
  for (const i of [0, 3] as const) {
    const x0  = M + i * colW;
    const lab = i === 0 ? 'SALDO ANTERIOR' : 'SALDO FINAL';
    const v   = vals[i]!;
    page.drawText(lab, { x: x0 + (colW - fontB.widthOfTextAtSize(lab, 5)) / 2, y: byTop(page, d3 + bar1H * 0.8), size: 5, font: fontB, color: C.darkGray });
    page.drawText(v,   { x: x0 + (colW - fontB.widthOfTextAtSize(v, 9)) / 2,   y: byTop(page, d3 + bar1H + bar2H + valRowH - 4), size: 9, font: fontB, color: C.textBody });
  }

  return titleBarH + iconRowH + blockH + 8;
}

// ─── Cabecera de tabla ────────────────────────────────────────────────────────
const HEAD_LABELS: Array<{ line1: string; line2: string }> = [
  { line1: 'FECHA DE',    line2: 'OPERACIÓN' },
  { line1: 'FECHA DE',    line2: 'PROCESO'   },
  { line1: 'TIPO',        line2: ''           },
  { line1: 'NRO',         line2: 'DOCUMENTO' },
  { line1: 'DETALLE',     line2: ''           },
  { line1: 'METODO',      line2: 'DE PAGO'   },
  { line1: 'CODIGO DE',   line2: 'OPERACIÓN' },
  { line1: 'CARGO',       line2: ''           },
  { line1: 'ABONO',       line2: ''           },
  { line1: 'SALDO',       line2: ''           },
];

type TableHeadCtx = {
  p: PDFPage; d: number; xs: number[];
  contentW: number; font: PDFFont; fontB: PDFFont;
};

function drawTableHeader(ctx: TableHeadCtx) {
  const { p, d, xs, contentW, fontB } = ctx;

  p.drawRectangle({
    x: M,
    y: byTop(p, d + HEAD_H),
    width: contentW,
    height: HEAD_H,
    color: C.tableHeaderBg,
  });

  const colRight = (c: number) => (c < 9 ? xs[c + 1]! : M + contentW);
  const colWidth = (c: number) => colRight(c) - xs[c]!;

  const s1 = 5;
  const s2 = 4.5;
  const twoLineBaseline1 = 9.5; // franja 2 líneas: 1.ª baselines desde d
  const twoLineBaseline2 = 17.5;

  for (let c = 0; c < 10; c++) {
    const { line1, line2 } = HEAD_LABELS[c]!;
    const wcol = colWidth(c);
    const xLeft = xs[c]!;

    if (line2) {
      const w1 = fontB.widthOfTextAtSize(line1, s1);
      const w2 = fontB.widthOfTextAtSize(line2, s2);
      p.drawText(line1, {
        x: xLeft + (wcol - w1) / 2,
        y: byTop(p, d + twoLineBaseline1),
        size: s1,
        font: fontB,
        color: C.white,
      });
      p.drawText(line2, {
        x: xLeft + (wcol - w2) / 2,
        y: byTop(p, d + twoLineBaseline2),
        size: s2,
        font: fontB,
        color: C.white,
      });
    } else {
      const w1 = fontB.widthOfTextAtSize(line1, s1);
      p.drawText(line1, {
        x: xLeft + (wcol - w1) / 2,
        y: byTop(p, baselineVerticallyCentered(d, HEAD_H, s1)),
        size: s1,
        font: fontB,
        color: C.white,
      });
    }
  }
}

/** Ancho columna QR (derecha) en el pie. */
const FOOT_COL3 = 78;
/** Separación entre bloque central y columna QR. */
const FOOT_GAP = 10;
/** Tamaño máx. del logo banco en el pie (pt); un poco menor que antes para no competir con el texto. */
const FOOT_BANK_LOGO_MAX_W = 58;
const FOOT_BANK_LOGO_MAX_H = 27;
/** Reserva máx. usada al medir altura del pie cuando hay logo banco (evita solapamiento al re-envolver). */
const FOOT_BANK_LEFT_MAX = FOOT_BANK_LOGO_MAX_W + 14;
/** Espacio horizontal mínimo entre borde derecho del logo banco y el texto (pt). */
const FOOT_BANK_TEXT_GAP = 4;
/** Altura objetivo del icono WhatsApp en el PDF (pt). */
const WA_ICON_H = 11;
/** Si no hay PNG: en pdf-lib `drawCircle({ size })` es el **diámetro** en pt (no el radio). */
const WA_FALLBACK_DIAM = 11;
function measureStatementFooterHeight(
  contentW: number,
  font: PDFFont,
  fontB: PDFFont,
  whatsapp: string,
  bankBlock: string,
  obsBlock: string,
  hasBankLogo: boolean,
  hasQr: boolean,
): number {
  const bankReserve = hasBankLogo ? FOOT_BANK_LEFT_MAX : 12;
  const midW   = contentW - bankReserve - FOOT_BANK_TEXT_GAP - FOOT_COL3 - FOOT_GAP;
  const waWMeas = Math.max(100, contentW - 22);
  const waLines = wrapToWidth(whatsapp, waWMeas, font, 6, 30);
  const waLineHMeas = 7.1;
  const waAscM = 6 * 0.72;
  const waDescM = 6 * 0.24;
  const waTVH =
    waLines.length > 0 ? (waLines.length - 1) * waLineHMeas + waAscM + waDescM : waLineHMeas;
  const hWa = 4 + Math.max(WA_ICON_H + 2, waTVH + 1) + 3;
  const bTrim  = (bankBlock || '').trim();
  const bankRows: string[] = [];
  if (bTrim) {
    for (const para of bTrim.split(/\r?\n/)) {
      if (!para.trim()) continue;
      bankRows.push(...wrapToWidth(para.trim(), midW, font, 6, 30));
    }
  }
  let hMid = 0;
  if (bankRows.length) hMid = bankRows.length * 7.1;
  if (obsBlock.trim()) {
    const oLines = wrapToWidth('OBS: ' + obsBlock.trim(), midW, fontB, 6, 12);
    hMid += (bankRows.length ? 3 : 0) + oLines.length * 7.1;
  }
  if (hMid > 0) hMid += 1;
  const hLogo = hasBankLogo ? FOOT_BANK_LOGO_MAX_H + 4 : 0;
  const hQr   = hasQr ? 66 + 16 : 0; // imagen + píldora
  const show3 = bTrim || obsBlock.trim() || hasBankLogo || hasQr;
  if (!show3) return 0.4 + hWa;
  return 0.4 + 4 + hWa + 5 + 0.4 + 7 + Math.max(hMid, hLogo, hQr) + 2;
}

type FooterAtOpts = {
  page: PDFPage;
  dStart: number;
  contentW: number;
  font: PDFFont;
  fontB: PDFFont;
  whatsapp: string;
  bankBlock: string;
  obsBlock: string;
  /** Logo WhatsApp embebido (p. ej. JPEG desde `public/logo_wp.jpg`); si es null, círculo verde de respaldo. */
  waImg: PDFImage | null;
  bankImg: PDFImage | null;
  qrImg: PDFImage | null;
  qrCaption: string;
};

function drawStatementFooterAt(o: FooterAtOpts): void {
  const { page, dStart, contentW, font, fontB, whatsapp, bankBlock, obsBlock, waImg, bankImg, qrImg, qrCaption } = o;
  const x1 = M;
  const x3 = M + contentW - FOOT_COL3;

  let    d   = dStart;
  hLine(page, d, M, M + contentW, C.borderGray, 0.4);
  d   += 3;

  const waFs = 6;
  const waIconW = waImg ? waImg.width * (WA_ICON_H / waImg.height) : WA_FALLBACK_DIAM;
  const textLeftX = M + waIconW + 5;
  const waWrapW = Math.max(100, contentW - (textLeftX - M) - 8);
  const waLines = wrapToWidth(whatsapp, waWrapW, font, waFs, 32);
  const waLineH = 7.1;
  const waAsc = waFs * 0.72;
  const waDesc = waFs * 0.24;
  const waTextVisualH =
    waLines.length > 0 ? (waLines.length - 1) * waLineH + waAsc + waDesc : waLineH;
  const waBlockH = Math.max(WA_ICON_H + 2, waTextVisualH + 1);
  const dWaTop = d;
  const midWaFromTop = dWaTop + waBlockH / 2;
  const textStartY =
    waLines.length > 0 ? midWaFromTop - waTextVisualH / 2 + waAsc : dWaTop + (waBlockH - waLineH) / 2;
  const iconTopFromWa = midWaFromTop - WA_ICON_H / 2;

  if (waImg) {
    const ih = WA_ICON_H;
    const iw = waIconW;
    page.drawImage(waImg, {
      x: M,
      y: byTop(page, iconTopFromWa + ih),
      width: iw,
      height: ih,
    });
  } else {
    const diam = WA_FALLBACK_DIAM;
    page.drawCircle({
      x: M + diam / 2,
      y: byTop(page, midWaFromTop),
      size: diam,
      color: C.waGreen,
    });
  }

  let wy = textStartY;
  for (const ln of waLines) {
    page.drawText(ln, { x: textLeftX, y: byTop(page, wy), size: waFs, font, color: C.textBody });
    wy += waLineH;
  }
  d = dWaTop + waBlockH + 4;

  const bTrim = (bankBlock || '').trim();
  const show3 = bTrim || obsBlock.trim() || bankImg != null || qrImg != null;
  if (!show3) return;

  hLine(page, d, M, M + contentW, C.borderGray, 0.4);
  d   += 6;
  const d3Top = d;

  let logoH = 0;
  let logoW_ = 0;
  if (bankImg) {
    const s = Math.min(
      FOOT_BANK_LOGO_MAX_W / bankImg.width,
      FOOT_BANK_LOGO_MAX_H / bankImg.height,
      1,
    );
    logoW_ = bankImg.width * s;
    logoH = bankImg.height * s;
  }
  const bankLeftColW = bankImg ? logoW_ + 5 : 0;
  const x2 = M + bankLeftColW + (bankLeftColW > 0 ? FOOT_BANK_TEXT_GAP : 4);
  const mid2w = Math.max(80, x3 - x2 - 4);

  const bankRows: string[] = [];
  if (bTrim) {
    for (const para of bTrim.split(/\r?\n/)) {
      if (!para.trim()) continue;
      bankRows.push(...wrapToWidth(para.trim(), mid2w, font, 6, 32));
    }
  }
  const obsLines = obsBlock.trim()
    ? wrapToWidth('OBS: ' + obsBlock.trim(), mid2w, fontB, 6, 12)
    : [];

  let    hMid = 0;
  if (bankRows.length) hMid = bankRows.length * 7.1;
  if (obsLines.length)  hMid += (bankRows.length ? 3 : 0) + obsLines.length * 7.1;
  hMid         = hMid + (hMid > 0 ? 1 : 0);
  const qrMax = 64;
  let    qrH  = 0;
  let    qrW  = 0;
  if (qrImg) {
    const s = Math.min(qrMax / qrImg.width, qrMax / qrImg.height, 1);
    qrH = qrImg.height * s;
    qrW = qrImg.width  * s;
  }
  const capFs  = 4.8;
  const capT   = qrCaption.trim() || 'Paga aquí con Yape';
  const capW   = Math.max(qrW, fontB.widthOfTextAtSize(capT, capFs) + 8);
  const ph     = 7.5;
  const qrBlockH = qrH > 0 ? qrH + 3 + ph : 0;
  const rowH     = Math.max(logoH, hMid, qrBlockH, 1);

  if (bankImg) {
    // Centrado vertical respecto solo al bloque de texto bancario + OBS (no a la fila completa con QR).
    const hasBankText = bankRows.length > 0 || obsLines.length > 0;
    const textBlockH = hasBankText ? Math.max(0, hMid - 1) : 0;
    const tImg = hasBankText
      ? d3Top + Math.max(0, (textBlockH - logoH) / 2)
      : d3Top + Math.max(0, (rowH - logoH) / 2);
    page.drawImage(bankImg, { x: x1, y: byTop(page, tImg + logoH), width: logoW_, height: logoH });
  }

  let    ty = d3Top;
  for (let i = 0; i < bankRows.length; i++) {
    const f = i === 0 ? fontB : font;
    page.drawText(bankRows[i]!, { x: x2, y: byTop(page, ty + 0.1), size: 6, font: f, color: C.textBody });
    ty += 7.1;
  }
  if (obsLines.length) {
    if (bankRows.length) ty += 2.5;
    for (const ln of obsLines) {
      page.drawText(ln, { x: x2, y: byTop(page, ty), size: 6, font: fontB, color: C.textBody });
      ty += 7.1;
    }
  }

  if (qrImg) {
    const tQrTop  = d3Top + (rowH - qrBlockH) / 2;
    const qx2     = x3 + (FOOT_COL3 - qrW) / 2;
    const tPill   = tQrTop + qrH + 3.5;
    const capX    = x3 + (FOOT_COL3 - capW) / 2;
    const halfW   = capW * 0.5;
    page.drawImage(qrImg, { x: qx2, y: byTop(page, tQrTop + qrH), width: qrW, height: qrH });
    page.drawRectangle({ x: capX,         y: byTop(page, tPill + ph), width: halfW,         height: ph, color: C.pill1 });
    page.drawRectangle({ x: capX + halfW, y: byTop(page, tPill + ph), width: capW - halfW, height: ph, color: C.pill2 });
    const tw2 = fontB.widthOfTextAtSize(capT, capFs);
    page.drawText(capT, { x: capX + (capW - tw2) / 2, y: byTop(page, tPill + 4.6), size: capFs, font: fontB, color: C.white });
  }
}

// ─── Embed helpers ────────────────────────────────────────────────────────────

async function tryEmbedPngJpeg(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  if (!bytes?.length) return null;
  try { return await pdf.embedPng(bytes); } catch { /* noop */ }
  try { return await pdf.embedJpg(bytes); } catch { /* noop */ }
  return null;
}

async function blobToBytes(blob: Blob | null | undefined): Promise<Uint8Array | null> {
  if (!blob || blob.size === 0) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

async function embedWithRasterFallback(
  pdf: PDFDocument,
  sourceBlob: Blob | null | undefined,
  bytes: Uint8Array | null,
): Promise<PDFImage | null> {
  if (!bytes?.length) return null;
  const img = await tryEmbedPngJpeg(pdf, bytes);
  if (img) return img;
  const blobForRaster =
    sourceBlob && sourceBlob.size > 0
      ? sourceBlob
      : new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const pngOut = await rasterizeImageBlobToPngForPdf(blobForRaster);
  if (!pngOut || pngOut.size === 0) return null;
  return tryEmbedPngJpeg(pdf, new Uint8Array(await pngOut.arrayBuffer()));
}

// ─── Export principal ─────────────────────────────────────────────────────────

export type StatementPdfAssets = {
  bankLogoPng?: Blob | null;
  paymentQrPng?: Blob | null;
};

export async function buildAccountStatementPdfBlob(
  company: Company,
  ledger: AccountLedger,
  firm: FirmConfig | null,
  logoPng: Blob | null,
  extra?: StatementPdfAssets | null,
): Promise<Blob> {
  const W = PageSizes.A4[0]!;
  const H = PageSizes.A4[1]!;
  const contentW = W - 2 * M;
  const xs = colStarts(contentW);
  const detailW = xs[5]! - xs[4]! - 3;

  const brand       = firm?.name?.trim() || 'Estudio contable';
  const isDateRange = ledger.ledger_kind === 'date_range';
  const whatsapp    = (firm?.statement_whatsapp_notice ?? '').trim() || DEFAULT_STATEMENT_WHATSAPP;
  const bankBlock   = (firm?.statement_bank_info ?? '').trim();
  const obsBlock    = (firm?.statement_payment_observations ?? '').trim() || '';
  const qrCaption   = (firm?.statement_payment_qr_caption ?? '').trim() || 'Paga aquí con Yape';
  const movs        = ledger.movements ?? [];

  const pdf   = await PDFDocument.create();
  const font  = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  const [logoB, bankB, qrB] = await Promise.all([
    blobToBytes(logoPng),
    blobToBytes(extra?.bankLogoPng),
    blobToBytes(extra?.paymentQrPng),
  ]);

  const [logoImg, bankImg, qrImg] = await Promise.all([
    logoB ? embedWithRasterFallback(pdf, logoPng, logoB)            : Promise.resolve<PDFImage | null>(null),
    bankB ? embedWithRasterFallback(pdf, extra?.bankLogoPng, bankB) : Promise.resolve<PDFImage | null>(null),
    qrB   ? embedWithRasterFallback(pdf, extra?.paymentQrPng, qrB) : Promise.resolve<PDFImage | null>(null),
  ]);

  /** Logo WhatsApp para el pie del PDF (`public/logo_wp.jpg`). La vista web usa otro recurso; aquí solo JPEG embebido. */
  let waStatementIcon: PDFImage | null = null;
  try {
    const base =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      typeof import.meta.env.BASE_URL === 'string'
        ? import.meta.env.BASE_URL
        : '/';
    const waPath = `${base}logo_wp.jpg`;
    const res = await fetch(waPath);
    if (res.ok) {
      const blob = await res.blob();
      const wb = new Uint8Array(await blob.arrayBuffer());
      waStatementIcon = await embedWithRasterFallback(pdf, blob, wb);
    }
  } catch {
    /* Si no hay imagen o falla la carga, el pie usa el círculo verde de respaldo. */
  }

  const maxW       = contentW - 92 - 4;
  const razonLines = wrapToWidth((company.business_name || '—').replace(/\r/g, ''), maxW, font, 7.8, 3);
  const dirLines   = wrapToWidth((company.address?.trim() || '—').replace(/\r/g, ''), maxW, font, 7.8, 3);

  let d    = 28;
  let page = pdf.addPage(PageSizes.A4);

  // ── Encabezado ──
  d += drawHeader({ page, dTop: d, W, contentW, periodLabel: ledger.period_label, isDateRange, logo: logoImg, font, fontB });
  d += 6;

  hLine(page, d, M, M + contentW, C.borderGray, 0.6);
  d += 8;

  // ── Datos cliente ──
  d += drawClientInfo({ page, dTop: d, company, font, fontB, contentW, razonLines, dirLines });

  // ── Resumen ──
  const summaryVals: [string, string, string, string] = [
    money(ledger.saldo_anterior),
    money(ledger.total_abonos),
    money(ledger.total_cargos),
    money(ledger.saldo_final),
  ];
  d += drawSummary({ page, dTop: d, contentW, W, isDateRange, vals: summaryVals, font, fontB });

  // ── Tabla ──
  const drawThead = (p: PDFPage, rowD: number) =>
    drawTableHeader({ p, d: rowD, xs, contentW, font, fontB });

  drawThead(page, d);
  d += HEAD_H;

  const newPage = () => {
    page = pdf.addPage(PageSizes.A4);
    d = 32;
    drawThead(page, d);
    d += HEAD_H;
  };

  const tablePageBreak = (nextRowH: number) => {
    if (d + nextRowH + 8 > H - BOTTOM - 12) newPage();
  };

  if (movs.length === 0) {
    tablePageBreak(18);
    page.drawText('No hay movimientos registrados en este periodo.', {
      x: M + 4, y: byTop(page, d + 8), size: 8, font, color: C.midGray,
    });
    d += 18;
  } else {
    for (let idx = 0; idx < movs.length; idx++) {
      const row    = movs[idx]!;
      const dLines = wrapToWidth((row.detail ?? '—').trim() || '—', detailW, font, TABLE_SIZE, 5);
      const hRow   = Math.max(11, 6 + dLines.length * 7);

      tablePageBreak(hRow);

      const zeb = idx % 2 === 0 ? C.white : C.lightGray;
      page.drawRectangle({
        x: M, y: byTop(page, d + hRow),
        width: contentW, height: hRow,
        color: zeb,
        borderColor: C.borderGray, borderWidth: 0.2,
      });

      for (let li = 0; li < dLines.length; li++) {
        page.drawText(dLines[li]!, {
          x: xs[4]! + 2, y: byTop(page, d + 6.5 + li * 7),
          size: TABLE_SIZE, font, color: C.textBody,
        });
      }

      const y1  = d + 6.5;
      const opD = formatLedgerDateDisplay(row.operation_date);
      const prD = formatLedgerDateDisplay(row.process_date);
      const doc = truncateDocumentNumberDisplay(row.document_number, 24);
      const cgo = row.cargo > 0 ? money(row.cargo) : '-';
      const abo = row.abono > 0 ? money(row.abono) : '-';
      const bal = money(row.balance);
      const tc = C.textBody;

      page.drawText(opD,  { x: xs[0]! + 2, y: byTop(page, y1), size: 6,   font, color: tc });
      page.drawText(prD,  { x: xs[1]! + 2, y: byTop(page, y1), size: 6,   font, color: tc });
      page.drawText((row.type_code      || '—').slice(0, 8),  { x: xs[2]! + 2, y: byTop(page, y1), size: 6,   font, color: tc });
      page.drawText(doc,                                        { x: xs[3]! + 2, y: byTop(page, y1), size: 5.5, font, color: tc });
      page.drawText((row.payment_method  || '—').slice(0, 10), { x: xs[5]! + 2, y: byTop(page, y1), size: 5,   font, color: tc });
      page.drawText((row.operation_code || '—').slice(0, 10),  { x: xs[6]! + 2, y: byTop(page, y1), size: 5,   font, color: tc });

      const cgoW = fontB.widthOfTextAtSize(cgo, TABLE_SIZE);
      const abW  = fontB.widthOfTextAtSize(abo, TABLE_SIZE);
      const balW = fontB.widthOfTextAtSize(bal, TABLE_SIZE);

      // Cargo, abono y saldo: mismo color de cuerpo que el resto de columnas (sin semáforo rojo/verde en PDF).
      page.drawText(cgo, { x: xs[8]!  - 2 - cgoW, y: byTop(page, y1), size: TABLE_SIZE, font: fontB, color: tc });
      page.drawText(abo, { x: xs[9]!  - 2 - abW,  y: byTop(page, y1), size: TABLE_SIZE, font: fontB, color: tc });
      page.drawText(bal, { x: xs[10]! - 2 - balW, y: byTop(page, y1), size: TABLE_SIZE, font: fontB, color: tc });

      d += hRow;
    }
  }

  // ── Bloque fijo: WhatsApp + banco + QR (datos de Ajustes) anclado al pie de la última página ──
  {
    const Hp      = page.getHeight();
    const footH_  = measureStatementFooterHeight(
      contentW, font, fontB, whatsapp, bankBlock, obsBlock, bankImg != null, qrImg != null,
    );
    const band    = BOTTOM + 8;
    let  footerD0 = Hp - band - footH_;
    if (d + 8 > footerD0) {
      newPage();
      const H2 = page.getHeight();
      footerD0  = H2 - band - footH_;
    }
    drawStatementFooterAt({
      page,
      dStart:  footerD0,
      contentW,
      font,
      fontB,
      whatsapp,
      bankBlock,
      obsBlock,
      waImg: waStatementIcon,
      bankImg,
      qrImg,
      qrCaption,
    });
  }

  // Leyenda "· Pág. n/m" en todas las hojas
  const nP = pdf.getPageCount();
  for (let pi = 0; pi < nP; pi++) {
    const pg = pdf.getPage(pi);
    const s  = `${brand}  ·  Estado de cuenta ${company.ruc}  ·  ${ledger.period_label}  ·  Pág. ${pi + 1}/${nP}`;
    const fs = 5.2;
    const tw = font.widthOfTextAtSize(s, fs);
    pg.drawText(s, { x: (W - tw) / 2, y: BOTTOM, size: fs, font, color: C.midGray });
  }

  const u8 = await pdf.save();
  return new Blob([u8 as unknown as BlobPart], { type: 'application/pdf' });
}

export function companyAccountStatementPdfFilename(company: Company, ledger: AccountLedger): string {
  const ruc = String(company.ruc ?? '').replace(/\W+/g, '');
  if (ledger.ledger_kind === 'date_range' && ledger.range_date_from && ledger.range_date_to)
    return `EstadoCuenta-${ruc || 'cliente'}-${ledger.range_date_from}_${ledger.range_date_to}.pdf`;
  const p = `${ledger.period_year}-${String(ledger.period_month).padStart(2, '0')}`;
  return `EstadoCuenta-${ruc || 'cliente'}-${p}.pdf`;
}