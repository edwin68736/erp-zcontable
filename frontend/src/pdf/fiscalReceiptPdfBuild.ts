import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { FirmConfig } from '../types/dashboard';
import type { PosSaleDetail } from '../services/posSales';
import { loadImageBlobForPdf } from '../utils/pdfLogo';
export function docTypeLabel(code: string) {
  const c = (code ?? '').trim();
  if (c === '01') return 'FACTURA';
  if (c === '03') return 'BOLETA';
  if (c === '00' || c === 'NV') return 'NOTA DE VENTA';
  return c || 'COMPROBANTE';
}

const M = 36;
const PAGE_W = 595;
const PAGE_H = 842;

const C = {
  black: rgb(0.08, 0.08, 0.08),
  gray: rgb(0.45, 0.45, 0.45),
  lightGray: rgb(0.88, 0.88, 0.88),
  tableHead: rgb(0.75, 0.75, 0.75),
  white: rgb(1, 1, 1),
  border: rgb(0.55, 0.55, 0.55),
  green: rgb(0.02, 0.59, 0.41),
};

const money = (v: number) =>
  Number(v ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Monto con símbol y espacio: «S/ 450.00» */
const moneyPen = (v: number) => `S/ ${money(v)}`;

function drawRightText(
  page: PDFPage,
  text: string,
  rightX: number,
  yFromTop: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: rightX - tw,
    y: topY(page, yFromTop + size),
    size,
    font,
    color,
  });
}

function topY(page: PDFPage, fromTop: number) {
  return page.getHeight() - fromTop;
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
      if (lines.length >= maxLines) return lines;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

/** Salto de línea por ancho real (pt), no por cantidad de caracteres. */
function wrapLinesByWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxWidthPt: number,
  maxLines: number,
): string[] {
  const t = (text ?? '').trim();
  if (!t || maxWidthPt <= 4) return [];

  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxWidthPt;
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

/** Respeta saltos de línea explícitos y luego ajusta por ancho en pt. */
function wrapLinesByWidthMultiline(
  text: string,
  font: PDFFont,
  size: number,
  maxWidthPt: number,
  maxLines: number,
): string[] {
  const raw = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const para of raw.split('\n')) {
    const chunk = para.trim();
    if (!chunk) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    const wrapped = wrapLinesByWidth(chunk, font, size, maxWidthPt, maxLines - out.length);
    for (const ln of wrapped) {
      if (out.length >= maxLines) return out;
      out.push(ln);
    }
  }
  return out;
}

function drawTextInColumn(
  page: PDFPage,
  lines: string[],
  x: number,
  yTop: number,
  w: number,
  size: number,
  font: PDFFont,
  align: 'left' | 'center' | 'right',
  lineHeight: number,
  color: ReturnType<typeof rgb> = C.black,
) {
  const pad = 2;
  const maxW = Math.max(4, w - pad * 2);
  const toDraw = lines.length ? lines : ['—'];
  toDraw.forEach((line, i) => {
    const clipped =
      font.widthOfTextAtSize(line, size) > maxW
        ? wrapLinesByWidth(line, font, size, maxW, 1)[0] ?? line
        : line;
    const tw = font.widthOfTextAtSize(clipped, size);
    const tx =
      align === 'center' ? x + (w - tw) / 2 : align === 'right' ? x + w - tw - pad : x + pad;
    page.drawText(clipped, {
      x: tx,
      y: topY(page, yTop + i * lineHeight + size),
      size,
      font,
      color,
    });
  });
}

function estimateBankBlockHeight(bankInfo: string): number {
  const text = bankInfo.trim();
  if (!text) return 0;
  let h = 12 + 6;
  for (const para of text.split(/\n+/)) {
    h += wrapLines(para.trim(), 90, 8).length * 8 + 2;
  }
  return h + 4;
}

function drawA4ProductTableGrid(
  page: PDFPage,
  tableX: number,
  tableTop: number,
  tableW: number,
  headH: number,
  bodyH: number,
  colBoundaries: number[],
) {
  const totalH = headH + bodyH;
  const yTop = tableTop;
  const yBottom = tableTop + totalH;
  const yHead = tableTop + headH;
  const lineOpts = { thickness: 0.5, color: C.border };

  page.drawLine({
    start: { x: tableX, y: topY(page, yTop) },
    end: { x: tableX + tableW, y: topY(page, yTop) },
    ...lineOpts,
  });
  page.drawLine({
    start: { x: tableX, y: topY(page, yTop) },
    end: { x: tableX, y: topY(page, yBottom) },
    ...lineOpts,
  });
  page.drawLine({
    start: { x: tableX + tableW, y: topY(page, yTop) },
    end: { x: tableX + tableW, y: topY(page, yBottom) },
    ...lineOpts,
  });
  page.drawLine({
    start: { x: tableX, y: topY(page, yBottom) },
    end: { x: tableX + tableW, y: topY(page, yBottom) },
    ...lineOpts,
    dashArray: [3, 2],
  });
  page.drawLine({
    start: { x: tableX, y: topY(page, yHead) },
    end: { x: tableX + tableW, y: topY(page, yHead) },
    ...lineOpts,
  });
  for (const cx of colBoundaries) {
    page.drawLine({
      start: { x: cx, y: topY(page, yTop) },
      end: { x: cx, y: topY(page, yBottom) },
      ...lineOpts,
    });
  }
}

function formatPaymentMethod(method: string): string {
  const m = (method ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    efectivo: 'Efectivo',
    cash: 'Efectivo',
    contado: 'Efectivo',
    transferencia: 'Transferencia',
    yape: 'Yape',
    plin: 'Plin',
    tarjeta: 'Tarjeta',
    otro: 'Otro',
  };
  if (map[m]) return map[m];
  if (!m) return '—';
  return method.trim().charAt(0).toUpperCase() + method.trim().slice(1);
}

function splitPaymentMethodHeader(header: string): string[] {
  const h = (header ?? '').trim();
  if (!h) return [];
  if (h.includes('+')) {
    return h
      .split('+')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [h];
}

/** Filas de métodos de pago con monto, fecha y operación (desde fiscal_receipt_payments o cabecera). */
type PdfPaymentRow = { method: string; amount: number; operationNumber?: string; payDate?: string };

function receiptPaymentDateIso(receipt: PosSaleDetail): string {
  const linked = (receipt.linked_payment?.date ?? '').trim();
  if (linked) return linked.slice(0, 10);
  return (receipt.issue_date ?? '').slice(0, 10);
}

function receiptPaymentDateLabel(receipt: PosSaleDetail): string {
  return formatDateDDMMYYYY(receiptPaymentDateIso(receipt));
}

function paymentMethodsForPdf(receipt: PosSaleDetail): PdfPaymentRow[] {
  const payDate = receiptPaymentDateLabel(receipt);
  const pays = receipt.payments ?? [];
  if (pays.length > 0) {
    return pays.map((p) => ({
      method: formatPaymentMethod(p.method),
      amount: Number(p.amount ?? 0),
      operationNumber: (p.operation_number ?? '').trim() || undefined,
      payDate: payDate || undefined,
    }));
  }
  const pm = (receipt.payment_method ?? '').trim();
  if (!pm) return [];
  const ref = (receipt.payment_reference ?? '').trim() || undefined;
  const parts = splitPaymentMethodHeader(pm);
  if (parts.length > 1) {
    return parts.map((part) => ({
      method: formatPaymentMethod(part),
      amount: receipt.total ?? 0,
      operationNumber: ref,
      payDate: payDate || undefined,
    }));
  }
  return [{ method: formatPaymentMethod(pm), amount: receipt.total ?? 0, operationNumber: ref, payDate: payDate || undefined }];
}

function formatPaymentPdfLine(row: PdfPaymentRow): string {
  const segments = [row.method, moneyPen(row.amount)];
  if (row.payDate) segments.push(row.payDate);
  if (row.operationNumber) segments.push(`Op. ${row.operationNumber}`);
  return segments.join(' — ');
}

function measureA4PaymentBlock(
  payRows: PdfPaymentRow[],
  contentW: number,
): { paymentBlockH: number; payLineH: number } {
  const payLineH = 10;
  const maxChars = Math.max(16, Math.floor(contentW / 4.2));
  let lineCount = payRows.length === 0 ? 1 : 0;
  for (const row of payRows) {
    lineCount += wrapLines(formatPaymentPdfLine(row), maxChars, 3).length;
  }
  return { paymentBlockH: 12 + lineCount * payLineH, payLineH };
}

function customerDocLabel(receipt: PosSaleDetail): string {
  const n = (receipt.customer_number ?? '').trim();
  if (n.length === 11) return 'RUC';
  if (n.length === 8) return 'DNI';
  return 'Doc. identidad';
}

function customerDocTicketLabel(receipt: PosSaleDetail): string {
  const n = (receipt.customer_number ?? '').trim();
  if (n === '99999999') return 'Doc.trib.no.dom.sin.ruc';
  return customerDocLabel(receipt);
}

/** Metadatos del PDF: Chrome y otros visores usan el título al guardar desde la pestaña. */
function applyReceiptPdfMetadata(doc: PDFDocument, receipt: PosSaleDetail) {
  const title = (receipt.number ?? '').trim() || `comprobante-${receipt.id}`;
  doc.setTitle(title);
  doc.setAuthor('ZContable');
}

function sellerName(receipt: PosSaleDetail): string {
  const u = receipt.issued_by_user;
  return u?.name?.trim() || u?.username?.trim() || '—';
}

function formatDateDDMMYYYY(iso: string): string {
  const s = (iso ?? '').slice(0, 10);
  if (s.length < 10) return s || '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

async function embedLogo(doc: PDFDocument, url?: string): Promise<PDFImage | null> {
  try {
    const blob = await loadImageBlobForPdf(url);
    if (!blob) return null;
    const buf = await blob.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
      return doc.embedJpg(buf);
    }
    return doc.embedPng(buf);
  } catch {
    return null;
  }
}

const TICKET_W = 227;
const TICKET_M = 8;
/** Ancho columna de etiquetas (F. Emisión, Cliente, RUC, etc.); valores a la derecha, alineados a la izquierda. */
const TICKET_KV_LABEL_W = 56;
/** Tinta negra pura: en térmicas el gris y el negro suave (0.08) pierden trazo. */
const TICKET_INK = rgb(0, 0, 0);
/** Tamaños mínimos legibles en impresora térmica 80 mm (Helvetica regular < 7 pt sale débil). */
const TICKET_SZ_TITLE = 9;
const TICKET_SZ_BRAND = 8.5;
const TICKET_SZ_META = 7;
const TICKET_SZ_KV = 7;
const TICKET_SZ_HDR = 6.5;
const TICKET_SZ_CELL = 6.5;
const TICKET_SZ_BODY = 7;
const TICKET_SZ_TOTAL = 7;
const TICKET_LINE_H = 8;

function drawTicketDivider(page: PDFPage, y: number) {
  page.drawLine({
    start: { x: TICKET_M, y: topY(page, y) },
    end: { x: TICKET_W - TICKET_M, y: topY(page, y) },
    thickness: 0.55,
    color: TICKET_INK,
    dashArray: [1.5, 2],
  });
}

function drawCentered(
  page: PDFPage,
  text: string,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  width = TICKET_W,
) {
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (width - tw) / 2,
    y: topY(page, y + size),
    size,
    font,
    color,
  });
}

function estimateTicketHeight(receipt: PosSaleDetail, firm: FirmConfig | null, dataFont: PDFFont): number {
  const lines = receipt.lines ?? [];
  const bank = firm?.statement_bank_info?.trim() || '';
  const ticketContentW = TICKET_W - TICKET_M * 2;
  const descColW = 72;
  const cellSize = TICKET_SZ_CELL;
  const descLineH = TICKET_LINE_H;
  let bankH = 0;
  if (bank) {
    for (const para of bank.split(/\n+/)) {
      bankH += wrapLinesByWidthMultiline(para.trim(), dataFont, TICKET_SZ_BODY, ticketContentW, 8).length * 9 + 2;
    }
    bankH += 10;
  }
  let itemsH = 14;
  for (const ln of lines) {
    const desc = ln.description || ln.product_name || '';
    const descLines = wrapLinesByWidthMultiline(desc, dataFont, cellSize, descColW - 4, 20);
    itemsH += Math.max(10, descLines.length * descLineH + 2);
  }
  const pays = paymentMethodsForPdf(receipt);
  const payLines = pays.length > 0 ? pays.length : 1;
  const addrText = receipt.company?.address?.trim() || '';
  const addrValueW = ticketContentW - TICKET_KV_LABEL_W;
  const addrH =
    addrText === ''
      ? 0
      : wrapLinesByWidthMultiline(addrText, dataFont, TICKET_SZ_KV, addrValueW, 12).length * 9 + 2;
  return Math.min(1600, Math.max(440, 300 + itemsH + bankH + payLines * 14 + 70 + addrH));
}

export async function buildFiscalReceiptA4Pdf(
  receipt: PosSaleDetail,
  firm: FirmConfig | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  applyReceiptPdfMetadata(doc, receipt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const contentW = PAGE_W - M * 2;
  const payRows = paymentMethodsForPdf(receipt);
  const payLayout = measureA4PaymentBlock(payRows, contentW);
  const paymentBlockH = payLayout.paymentBlockH;

  const brand = firm?.name?.trim() || 'Estudio contable';
  const ruc = firm?.ruc?.trim() || '';
  const address = firm?.address?.trim() || '';
  const phone = firm?.phone?.trim() || '';
  const email = firm?.email?.trim() || '';
  const bankInfo = firm?.statement_bank_info?.trim() || '';
  const thanks = '¡Gracias por su compra!';

  const logo = await embedLogo(doc, firm?.logo_url);
  let y = M;

  // —— Cabecera: logo | empresa | caja comprobante ——
  const logoMaxW = 110;
  const logoMaxH = 78;
  const boxW = 158;
  const boxH = 68;
  let logoW = 0;
  let logoH = 0;
  if (logo) {
    const scale = Math.min(logoMaxW / logo.width, logoMaxH / logo.height);
    logoW = logo.width * scale;
    logoH = logo.height * scale;
  }

  const centerX = M + Math.max(logoW, 0) + 14;
  const centerW = contentW - Math.max(logoW, 0) - 14 - 168;
  const nameLines = wrapLines(brand.toUpperCase(), Math.floor(centerW / 5.5), 2);
  const metaParts = [
    ruc ? `RUC ${ruc}` : '',
    address,
    phone ? `Tel: ${phone}` : '',
    email,
  ].filter(Boolean);
  let centerContentH = nameLines.length * 13;
  for (const part of metaParts) {
    centerContentH += wrapLines(part, Math.floor(centerW / 4.2), 3).length * 9;
  }
  centerContentH += 18; // línea «Gracias por su compra»
  const headerH = Math.max(78, logoH + 8, boxH, centerContentH);
  const headerTop = y;
  /** Desplazamiento fino del logo hacia arriba respecto al centro del encabezado. */
  const logoNudgeUp = 15;

  if (logo) {
    const logoTop = Math.max(headerTop, headerTop + (headerH - logoH) / 2 - logoNudgeUp);
    page.drawImage(logo, {
      x: M,
      y: topY(page, logoTop + logoH),
      width: logoW,
      height: logoH,
    });
  }

  let cy = headerTop + (headerH - centerContentH) / 2;
  for (const ln of nameLines) {
    const tw = fontB.widthOfTextAtSize(ln, 11);
    page.drawText(ln, {
      x: centerX + Math.max(0, (centerW - tw) / 2),
      y: topY(page, cy + 11),
      size: 11,
      font: fontB,
      color: C.black,
    });
    cy += 13;
  }
  for (const part of metaParts) {
    const lines = wrapLines(part, Math.floor(centerW / 4.2), 3);
    for (const ln of lines) {
      const tw = font.widthOfTextAtSize(ln, 7.5);
      page.drawText(ln, {
        x: centerX + Math.max(0, (centerW - tw) / 2),
        y: topY(page, cy + 8),
        size: 7.5,
        font,
        color: C.gray,
      });
      cy += 9;
    }
  }
  const twThanks = font.widthOfTextAtSize(thanks, 7.5);
  page.drawText(thanks, {
    x: centerX + Math.max(0, (centerW - twThanks) / 2),
    y: topY(page, cy + 10),
    size: 7.5,
    font: fontB,
    color: C.green,
  });

  const boxX = PAGE_W - M - boxW;
  const boxY = headerTop + (headerH - boxH) / 2;
  page.drawRectangle({
    x: boxX,
    y: topY(page, boxY + boxH),
    width: boxW,
    height: boxH,
    borderColor: C.border,
    borderWidth: 0.8,
    borderDashArray: [3, 2],
  });
  const docTypeSize = 9;
  if (ruc) {
    const rucText = `RUC ${ruc}`;
    const rucW = fontB.widthOfTextAtSize(rucText, docTypeSize);
    page.drawText(rucText, {
      x: boxX + (boxW - rucW) / 2,
      y: topY(page, boxY + 16),
      size: docTypeSize,
      font: fontB,
      color: C.black,
    });
  }
  const docType = docTypeLabel(receipt.document_type_id ?? '');
  page.drawRectangle({
    x: boxX + 1,
    y: topY(page, boxY + 38),
    width: boxW - 2,
    height: 16,
    color: C.lightGray,
  });
  const dtW = fontB.widthOfTextAtSize(docType, docTypeSize);
  page.drawText(docType, {
    x: boxX + (boxW - dtW) / 2,
    y: topY(page, boxY + 32),
    size: docTypeSize,
    font: fontB,
    color: C.black,
  });
  const num = receipt.number ?? '—';
  const numW = fontB.widthOfTextAtSize(num, 11);
  page.drawText(num, {
    x: boxX + (boxW - numW) / 2,
    y: topY(page, boxY + 58),
    size: 11,
    font: fontB,
    color: C.black,
  });

  y += headerH + 8;

  // —— Datos cliente ——
  const issue = formatDateDDMMYYYY(receipt.issue_date ?? '');
  const paymentDate = receiptPaymentDateLabel(receipt);
  const infoRows: [string, string][] = [
    ['FECHA DE EMISIÓN:', issue || '—'],
    ['FECHA DE PAGO:', paymentDate || '—'],
    ['CLIENTE:', receipt.customer_name ?? '—'],
    [`${customerDocLabel(receipt)}:`, receipt.customer_number || '—'],
    ['DIRECCIÓN:', receipt.company?.address?.trim() || '—'],
  ];
  const infoLabelW = 118;
  const infoValueX = M + infoLabelW;
  const infoValueWidth = contentW - infoLabelW;
  const infoSize = 7.5;
  for (let rowIdx = 0; rowIdx < infoRows.length; rowIdx++) {
    const [label, value] = infoRows[rowIdx]!;
    const maxValLines = label.startsWith('DIRECCIÓN') ? 10 : 4;
    const valLines = wrapLinesByWidth(value, font, infoSize, infoValueWidth, maxValLines);
    const lines = valLines.length > 0 ? valLines : ['—'];
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) {
        page.drawText(label, { x: M, y: topY(page, y + infoSize), size: infoSize, font: fontB, color: C.black });
      }
      page.drawText(lines[i], { x: infoValueX, y: topY(page, y + infoSize), size: infoSize, font, color: C.black });
      y += 11;
    }
  }
  y += 6;

  // —— Tabla productos (altura fija, rejilla hasta el pie de la zona) ——
  const colW = {
    cant: 32,
    unit: 36,
    code: 44,
    desc: contentW - 32 - 36 - 44 - 52 - 36 - 52,
    punit: 52,
    dto: 36,
    total: 52,
  };
  const cols = [
    { key: 'cant', label: 'CANT.', w: colW.cant, align: 'center' as const },
    { key: 'unit', label: 'UNIDAD', w: colW.unit, align: 'center' as const },
    { key: 'code', label: 'CÓDIGO', w: colW.code, align: 'center' as const },
    { key: 'desc', label: 'DESCRIPCIÓN', w: colW.desc, align: 'left' as const },
    { key: 'punit', label: 'P.UNIT', w: colW.punit, align: 'right' as const },
    { key: 'dto', label: 'DTO.', w: colW.dto, align: 'right' as const },
    { key: 'total', label: 'TOTAL', w: colW.total, align: 'right' as const },
  ];
  const colBoundaries: number[] = [];
  let boundaryX = M;
  for (let i = 0; i < cols.length - 1; i++) {
    boundaryX += cols[i].w;
    colBoundaries.push(boundaryX);
  }

  const tableHeadH = 14;
  const totalsSectionH = 17;
  const totalsGap = 8;
  const sellerH = 14;
  const footerBlockH = 18;
  const bottomSpacing = 8;
  const bankBlockH = estimateBankBlockHeight(bankInfo);
  const bottomBlockH =
    footerBlockH +
    bottomSpacing +
    sellerH +
    bottomSpacing +
    bankBlockH +
    (bankBlockH ? bottomSpacing : 0) +
    paymentBlockH +
    bottomSpacing;

  const tableTop = y;
  const totalsStartY = PAGE_H - M - bottomBlockH - totalsSectionH;
  const tableBottom = totalsStartY - totalsGap;
  const tableBodyH = Math.max(80, tableBottom - tableTop - tableHeadH);

  page.drawRectangle({
    x: M,
    y: topY(page, tableTop + tableHeadH),
    width: contentW,
    height: tableHeadH,
    color: C.tableHead,
  });

  let cx = M;
  for (const col of cols) {
    const tw = fontB.widthOfTextAtSize(col.label, 6.5);
    const tx =
      col.align === 'center'
        ? cx + (col.w - tw) / 2
        : col.align === 'right'
          ? cx + col.w - tw - 3
          : cx + 3;
    page.drawText(col.label, {
      x: tx,
      y: topY(page, tableTop + 11),
      size: 6.5,
      font: fontB,
      color: C.black,
    });
    cx += col.w;
  }

  drawA4ProductTableGrid(page, M, tableTop, contentW, tableHeadH, tableBodyH, colBoundaries);

  const lines = [...(receipt.lines ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id,
  );
  const cellSize = 6.5;
  const lineH = 9;
  const cellPad = 3;
  const maxRowBottom = tableTop + tableHeadH + tableBodyH - 2;

  type A4RowLayout = { descLines: string[]; codeLines: string[]; rowH: number };
  let rowY = tableTop + tableHeadH + 2;
  for (const ln of lines) {
    const desc = ln.description || ln.product_name || '—';
    const code = ln.internal_code?.trim() || '—';
    const descLines = wrapLinesByWidthMultiline(desc, font, cellSize, colW.desc - cellPad * 2, 30);
    const codeLines = wrapLinesByWidthMultiline(code, font, cellSize, colW.code - cellPad * 2, 4);
    const lineCount = Math.max(1, descLines.length, codeLines.length);
    const layout: A4RowLayout = {
      descLines: descLines.length ? descLines : ['—'],
      codeLines: codeLines.length ? codeLines : ['—'],
      rowH: Math.max(14, lineCount * lineH + cellPad * 2),
    };
    if (rowY + layout.rowH > maxRowBottom) break;

    const unitId = ln.unit_type_id?.trim() || 'NIU';
    const qty = Number(ln.quantity).toFixed(2);

    let colX = M;
    drawTextInColumn(page, [qty], colX, rowY, colW.cant, cellSize, font, 'center', lineH);
    colX += colW.cant;
    drawTextInColumn(page, [unitId], colX, rowY, colW.unit, cellSize, font, 'center', lineH);
    colX += colW.unit;
    drawTextInColumn(page, layout.codeLines, colX, rowY, colW.code, cellSize, font, 'center', lineH);
    colX += colW.code;
    drawTextInColumn(page, layout.descLines, colX, rowY, colW.desc, cellSize, font, 'left', lineH);
    colX += colW.desc;
    drawTextInColumn(page, [money(ln.unit_price)], colX, rowY, colW.punit, cellSize, font, 'right', lineH);
    colX += colW.punit;
    drawTextInColumn(page, ['0'], colX, rowY, colW.dto, cellSize, font, 'right', lineH);
    colX += colW.dto;
    drawTextInColumn(page, [money(ln.line_total)], colX, rowY, colW.total, cellSize, font, 'right', lineH);

    rowY += layout.rowH;
  }

  // —— Totales (debajo de la tabla, alineados a la derecha) ——
  const total = receipt.total ?? 0;
  const totalsRight = PAGE_W - M;
  drawRightText(page, `TOTAL A PAGAR: ${moneyPen(total)}`, totalsRight, totalsStartY, 9, fontB, C.black);

  // —— Bloque inferior anclado al pie de página ——
  let bottomY = PAGE_H - M - footerBlockH;
  const foot = 'GRACIAS POR SU PREFERENCIA';
  const ftw = fontB.widthOfTextAtSize(foot, 9);
  page.drawText(foot, {
    x: (PAGE_W - ftw) / 2,
    y: topY(page, bottomY + 9),
    size: 9,
    font: fontB,
    color: C.gray,
  });
  page.drawText('ZContable', {
    x: M,
    y: topY(page, bottomY + 9),
    size: 7,
    font,
    color: C.gray,
  });

  bottomY -= bottomSpacing + sellerH;
  page.drawText(`Vendedor: ${sellerName(receipt)}`, {
    x: M,
    y: topY(page, bottomY + 8),
    size: 7.5,
    font,
    color: C.black,
  });

  if (bankInfo.trim()) {
    bottomY -= bottomSpacing + bankBlockH;
    let bankY = bottomY;
    page.drawText('CUENTAS BANCARIAS:', {
      x: M,
      y: topY(page, bankY + 9),
      size: 7.5,
      font: fontB,
      color: C.black,
    });
    bankY += 12;
    for (const para of bankInfo.split(/\n+/)) {
      for (const ln of wrapLines(para.trim(), 90, 8)) {
        page.drawText(ln, {
          x: M,
          y: topY(page, bankY + 8),
          size: 6.5,
          font,
          color: C.black,
        });
        bankY += 8;
      }
      bankY += 2;
    }
  }

  bottomY -= bottomSpacing + paymentBlockH;
  page.drawText('MÉTODO(S) DE PAGO:', {
    x: M,
    y: topY(page, bottomY + 10),
    size: 7.5,
    font: fontB,
    color: C.black,
  });
  const maxChars = Math.max(16, Math.floor(contentW / 4.2));
  let payTextY = bottomY + 12;
  if (payRows.length === 0) {
    page.drawText('—', {
      x: M,
      y: topY(page, payTextY + 8),
      size: 8,
      font: fontB,
      color: C.black,
    });
  } else {
    for (const row of payRows) {
      const wrapped = wrapLines(formatPaymentPdfLine(row), maxChars, 3);
      for (const ln of wrapped) {
        page.drawText(ln, {
          x: M,
          y: topY(page, payTextY + 8),
          size: 8,
          font: fontB,
          color: C.black,
        });
        payTextY += payLayout.payLineH;
      }
    }
  }

  return doc.save();
}

/** Comprobante térmico 80 mm (227 pt), diseño ticket de referencia. */
export async function buildFiscalReceiptTicketPdf(
  receipt: PosSaleDetail,
  firm: FirmConfig | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  applyReceiptPdfMetadata(doc, receipt);
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
  /** En térmica el trazo regular es débil; datos con negrita para legibilidad uniforme. */
  const dataFont = fontB;
  const pageH = estimateTicketHeight(receipt, firm, dataFont);
  const page = doc.addPage([TICKET_W, pageH]);
  const contentW = TICKET_W - TICKET_M * 2;

  const brand = firm?.name?.trim() || 'Estudio contable';
  const ruc = firm?.ruc?.trim() || '';
  const address = firm?.address?.trim() || '';
  const phone = firm?.phone?.trim() || '';
  const email = firm?.email?.trim() || '';
  const bankInfo = firm?.statement_bank_info?.trim() || '';

  const logo = await embedLogo(doc, firm?.logo_url);
  let y = TICKET_M + 4;

  if (logo) {
    const logoMaxW = contentW * 0.55;
    const logoMaxH = 44;
    const scale = Math.min(logoMaxW / logo.width, logoMaxH / logo.height);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawImage(logo, {
      x: (TICKET_W - lw) / 2,
      y: topY(page, y + lh),
      width: lw,
      height: lh,
    });
    y += lh + 6;
  }

  for (const ln of wrapLines(brand.toUpperCase(), 32, 2)) {
    drawCentered(page, ln, y, TICKET_SZ_BRAND, fontB, TICKET_INK);
    y += 10;
  }
  if (ruc) {
    drawCentered(page, `RUC ${ruc}`, y, TICKET_SZ_META, dataFont, TICKET_INK);
    y += 9;
  }
  for (const part of [address, email, phone ? `Tel: ${phone}` : ''].filter(Boolean)) {
    for (const ln of wrapLines(part, 36, 3)) {
      drawCentered(page, ln, y, TICKET_SZ_META, dataFont, TICKET_INK);
      y += 8;
    }
  }
  y += 4;
  drawTicketDivider(page, y);
  y += 8;

  const docType = docTypeLabel(receipt.document_type_id ?? '');
  drawCentered(page, docType, y, TICKET_SZ_TITLE, fontB, TICKET_INK);
  y += 12;
  drawCentered(page, receipt.number ?? '—', y, TICKET_SZ_BRAND, fontB, TICKET_INK);
  y += 10;
  drawTicketDivider(page, y);
  y += 8;

  const issue = (receipt.issue_date ?? '').slice(0, 10);
  y = drawTicketKv(page, 'F. Emisión:', issue || '—', y, dataFont, fontB);
  y = drawTicketKv(page, 'Cliente:', receipt.customer_name ?? '—', y, dataFont, fontB);
  y = drawTicketKv(
    page,
    `${customerDocTicketLabel(receipt)}:`,
    receipt.customer_number || '—',
    y,
    dataFont,
    fontB,
  );
  y = drawTicketAddressBlock(page, receipt.company?.address?.trim() || '—', y, dataFont, fontB);
  y = drawTicketKv(page, 'Vendedor:', sellerName(receipt), y, dataFont, fontB);
  y += 2;
  drawTicketDivider(page, y);
  y += 8;

  const col = {
    cod: { x: TICKET_M, w: 26 },
    cant: { x: TICKET_M + 26, w: 18 },
    unit: { x: TICKET_M + 44, w: 22 },
    desc: { x: TICKET_M + 66, w: 72 },
    punit: { x: TICKET_M + 138, w: 34 },
    total: { x: TICKET_M + 172, w: contentW - 172 },
  };
  const hdrSize = TICKET_SZ_HDR;
  const headers: { label: string; cx: number; w: number; align: 'left' | 'center' | 'right' }[] = [
    { label: 'COD.', cx: col.cod.x, w: col.cod.w, align: 'left' },
    { label: 'CANT.', cx: col.cant.x, w: col.cant.w, align: 'center' },
    { label: 'UNIDAD', cx: col.unit.x, w: col.unit.w, align: 'center' },
    { label: 'DESCRIPCIÓN', cx: col.desc.x, w: col.desc.w, align: 'left' },
    { label: 'P.UNIT', cx: col.punit.x, w: col.punit.w, align: 'right' },
    { label: 'TOTAL', cx: col.total.x, w: col.total.w, align: 'right' },
  ];
  for (const h of headers) {
    const tw = fontB.widthOfTextAtSize(h.label, hdrSize);
    const tx =
      h.align === 'center'
        ? h.cx + (h.w - tw) / 2
        : h.align === 'right'
          ? h.cx + h.w - tw
          : h.cx;
    page.drawText(h.label, {
      x: tx,
      y: topY(page, y + hdrSize),
      size: hdrSize,
      font: fontB,
      color: TICKET_INK,
    });
  }
  y += 10;
  drawTicketDivider(page, y);
  y += 6;

  const lines = [...(receipt.lines ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id,
  );
  const cellSize = TICKET_SZ_CELL;
  const ticketLineH = TICKET_LINE_H;
  for (const ln of lines) {
    const code = ln.internal_code?.trim() || '—';
    const unitId = ln.unit_type_id?.trim() || 'NIU';
    const desc = ln.description || ln.product_name || '—';
    const codeLines = wrapLinesByWidthMultiline(code, dataFont, cellSize, col.cod.w - 2, 3);
    const descLines = wrapLinesByWidthMultiline(desc, dataFont, cellSize, col.desc.w - 2, 25);
    const rowLineCount = Math.max(1, codeLines.length, descLines.length);
    const rowH = rowLineCount * ticketLineH + 2;

    drawTextInColumn(page, codeLines.length ? codeLines : ['—'], col.cod.x, y, col.cod.w, cellSize, dataFont, 'left', ticketLineH, TICKET_INK);
    drawTextInColumn(page, [Number(ln.quantity).toFixed(0)], col.cant.x, y, col.cant.w, cellSize, dataFont, 'center', ticketLineH, TICKET_INK);
    drawTextInColumn(page, [unitId], col.unit.x, y, col.unit.w, cellSize, dataFont, 'center', ticketLineH, TICKET_INK);
    drawTextInColumn(page, [money(ln.unit_price)], col.punit.x, y, col.punit.w, cellSize, dataFont, 'right', ticketLineH, TICKET_INK);
    drawTextInColumn(page, [money(ln.line_total)], col.total.x, y, col.total.w, cellSize, dataFont, 'right', ticketLineH, TICKET_INK);
    drawTextInColumn(
      page,
      descLines.length ? descLines : ['—'],
      col.desc.x,
      y,
      col.desc.w,
      cellSize,
      dataFont,
      'left',
      ticketLineH,
      TICKET_INK,
    );
    y += rowH;
  }

  y += 2;
  drawTicketDivider(page, y);
  y += 10;

  const total = receipt.total ?? 0;
  const totalLabel = `TOTAL A PAGAR: ${moneyPen(total)}`;
  const totalSize = TICKET_SZ_TOTAL;
  const tlw = fontB.widthOfTextAtSize(totalLabel, totalSize);
  page.drawText(totalLabel, {
    x: TICKET_W - TICKET_M - tlw,
    y: topY(page, y + 8),
    size: totalSize,
    font: fontB,
    color: TICKET_INK,
  });
  y += 14;

  const payRows = paymentMethodsForPdf(receipt);
  page.drawText('PAGOS:', { x: TICKET_M, y: topY(page, y + 7), size: TICKET_SZ_BODY, font: fontB, color: TICKET_INK });
  y += 9;
  const defaultPayDate = receiptPaymentDateLabel(receipt);
  if (payRows.length === 0) {
    page.drawText(`- ${defaultPayDate || '—'} - — - ${moneyPen(total)}`, {
      x: TICKET_M,
      y: topY(page, y + 7),
      size: TICKET_SZ_BODY,
      font: dataFont,
      color: TICKET_INK,
    });
    y += 9;
  } else {
    for (const row of payRows) {
      const payDate = row.payDate || defaultPayDate || '—';
      const line = `- ${payDate} - ${formatPaymentPdfLine({ ...row, payDate: undefined })}`;
      for (const ln of wrapLines(line, 44, 3)) {
        page.drawText(ln, { x: TICKET_M, y: topY(page, y + 7), size: TICKET_SZ_BODY, font: dataFont, color: TICKET_INK });
        y += 9;
      }
    }
  }

  const paid = payRows.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const saldo = Math.max(0, total - paid);
  const saldoLabel = `SALDO: ${moneyPen(saldo)}`;
  const slw = dataFont.widthOfTextAtSize(saldoLabel, TICKET_SZ_BODY);
  page.drawText(saldoLabel, {
    x: TICKET_W - TICKET_M - slw,
    y: topY(page, y + 7),
    size: TICKET_SZ_BODY,
    font: dataFont,
    color: TICKET_INK,
  });
  y += 10;

  if (bankInfo) {
    page.drawText('CUENTAS BANCARIAS:', {
      x: TICKET_M,
      y: topY(page, y + 7),
      size: TICKET_SZ_BODY,
      font: fontB,
      color: TICKET_INK,
    });
    y += 9;
    for (const para of bankInfo.split(/\n+/)) {
      const blines = wrapLines(para.trim(), 42, 8);
      for (const ln of blines) {
        page.drawText(ln, {
          x: TICKET_M,
          y: topY(page, y + 6),
          size: TICKET_SZ_BODY,
          font: dataFont,
          color: TICKET_INK,
        });
        y += 8;
      }
      y += 1;
    }
    y += 4;
  }

  drawCentered(page, 'GRACIAS POR SU PREFERENCIA', y, TICKET_SZ_META, fontB, TICKET_INK);
  y += 12;
  drawCentered(page, 'ZContable', y, TICKET_SZ_META, fontB, TICKET_INK);

  return doc.save();
}

function drawTicketKv(
  page: PDFPage,
  label: string,
  value: string,
  y: number,
  valueFont: PDFFont,
  labelFont: PDFFont,
): number {
  const size = TICKET_SZ_KV;
  const valueX = TICKET_M + TICKET_KV_LABEL_W;
  const valueW = TICKET_W - TICKET_M - valueX;
  const valLines = wrapLinesByWidth((value ?? '').trim() || '—', valueFont, size, valueW, 5);
  const lines = valLines.length > 0 ? valLines : ['—'];
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) {
      page.drawText(label, {
        x: TICKET_M,
        y: topY(page, y + size),
        size,
        font: labelFont,
        color: TICKET_INK,
      });
    }
    page.drawText(lines[i], {
      x: valueX,
      y: topY(page, y + size),
      size,
      font: valueFont,
      color: TICKET_INK,
    });
    y += 9;
  }
  return y + 1;
}

/** Dirección en ticket: etiqueta a la izquierda, valor alineado como el resto de filas; salto solo si no cabe. */
function drawTicketAddressBlock(
  page: PDFPage,
  address: string,
  y: number,
  valueFont: PDFFont,
  labelFont: PDFFont,
): number {
  const size = TICKET_SZ_KV;
  const label = 'Dirección:';
  const valueX = TICKET_M + TICKET_KV_LABEL_W;
  const valueW = TICKET_W - TICKET_M - valueX;
  const lines = wrapLinesByWidth(address, valueFont, size, valueW, 12);
  const toDraw = lines.length > 0 ? lines : ['—'];
  for (let i = 0; i < toDraw.length; i++) {
    if (i === 0) {
      page.drawText(label, {
        x: TICKET_M,
        y: topY(page, y + size),
        size,
        font: labelFont,
        color: TICKET_INK,
      });
    }
    page.drawText(toDraw[i], {
      x: valueX,
      y: topY(page, y + size),
      size,
      font: valueFont,
      color: TICKET_INK,
    });
    y += 9;
  }
  return y + 2;
}
