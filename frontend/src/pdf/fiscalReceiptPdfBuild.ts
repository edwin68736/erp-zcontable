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

/** Filas de métodos de pago con monto (desde tabla fiscal_receipt_payments o cabecera). */
function paymentMethodsForPdf(receipt: PosSaleDetail): { method: string; amount: number }[] {
  const pays = receipt.payments ?? [];
  if (pays.length > 0) {
    return pays.map((p) => ({
      method: formatPaymentMethod(p.method),
      amount: Number(p.amount ?? 0),
    }));
  }
  const pm = (receipt.payment_method ?? '').trim();
  if (!pm) return [];
  const parts = splitPaymentMethodHeader(pm);
  if (parts.length > 1) {
    return parts.map((part) => ({
      method: formatPaymentMethod(part),
      amount: receipt.total ?? 0,
    }));
  }
  return [{ method: formatPaymentMethod(pm), amount: receipt.total ?? 0 }];
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

function paymentMethodDisplay(method: string): string {
  return formatPaymentMethod(method);
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

function drawTicketDivider(page: PDFPage, y: number) {
  page.drawLine({
    start: { x: TICKET_M, y: topY(page, y) },
    end: { x: TICKET_W - TICKET_M, y: topY(page, y) },
    thickness: 0.4,
    color: C.border,
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

function estimateTicketHeight(receipt: PosSaleDetail, firm: FirmConfig | null): number {
  const lines = receipt.lines ?? [];
  const bank = firm?.statement_bank_info?.trim() || '';
  let bankH = 0;
  if (bank) {
    for (const para of bank.split(/\n+/)) {
      bankH += wrapLines(para.trim(), 42, 8).length * 9 + 2;
    }
    bankH += 10;
  }
  let itemsH = 14;
  for (const ln of lines) {
    const desc = ln.description || ln.product_name || '';
    itemsH += Math.max(10, wrapLines(desc, 24, 4).length * 8);
  }
  const pays = receipt.payments?.length ?? (receipt.payment_method ? 1 : 0);
  const addrText = receipt.company?.address?.trim() || '';
  const ticketContentW = TICKET_W - TICKET_M * 2;
  const addrValueW = ticketContentW - TICKET_KV_LABEL_W;
  const addrH =
    addrText === ''
      ? 0
      : Math.max(1, Math.ceil(addrText.length / Math.max(10, Math.floor(addrValueW / 5)))) * 8 + 2;
  return Math.min(1600, Math.max(440, 300 + itemsH + bankH + pays * 11 + 70 + addrH));
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
  let logoW = 0;
  let logoH = 0;
  if (logo) {
    const scale = Math.min(logoMaxW / logo.width, logoMaxH / logo.height);
    logoW = logo.width * scale;
    logoH = logo.height * scale;
    page.drawImage(logo, {
      x: M,
      y: topY(page, y + logoH),
      width: logoW,
      height: logoH,
    });
  }

  const headerH = Math.max(78, logoH + 8);
  const centerX = M + Math.max(logoW, 0) + 14;
  const centerW = contentW - Math.max(logoW, 0) - 14 - 168;
  let cy = y + 4;
  const nameLines = wrapLines(brand.toUpperCase(), Math.floor(centerW / 5.5), 2);
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
  const metaParts = [
    ruc ? `RUC ${ruc}` : '',
    address,
    phone ? `Tel: ${phone}` : '',
    email,
  ].filter(Boolean);
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

  const boxW = 158;
  const boxX = PAGE_W - M - boxW;
  const boxY = y;
  const boxH = 68;
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
  const issue = (receipt.issue_date ?? '').slice(0, 10);
  const infoRows: [string, string][] = [
    ['FECHA DE EMISIÓN:', issue || '—'],
    ['FECHA DE VENCIMIENTO:', ''],
    ['CLIENTE:', receipt.customer_name ?? '—'],
    [`${customerDocLabel(receipt)}:`, receipt.customer_number || '—'],
    ['DIRECCIÓN:', receipt.company?.address?.trim() || '—'],
  ];
  const infoLabelW = 118;
  const infoValueX = M + infoLabelW;
  const infoValueWidth = contentW - infoLabelW;
  const infoSize = 7.5;
  for (const [label, value] of infoRows) {
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

  // —— Tabla ——
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

  let cx = M;
  page.drawRectangle({
    x: M,
    y: topY(page, y + 14),
    width: contentW,
    height: 14,
    color: C.tableHead,
  });
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
      y: topY(page, y + 11),
      size: 6.5,
      font: fontB,
      color: C.black,
    });
    cx += col.w;
  }
  y += 14;

  const lines = [...(receipt.lines ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id,
  );
  const rowH = 14;
  const tableBodyH = Math.max(rowH * 8, lines.length * rowH + 4);
  page.drawRectangle({
    x: M,
    y: topY(page, y + tableBodyH),
    width: contentW,
    height: tableBodyH,
    borderColor: C.border,
    borderWidth: 0.5,
  });

  let rowY = y + 2;
  for (const ln of lines) {
    cx = M;
    const unitId = ln.unit_type_id?.trim() || 'NIU';
    const code = ln.internal_code?.trim() || '—';
    const desc = ln.description || ln.product_name || '—';
    const qty = Number(ln.quantity).toFixed(2);
    const cells: { text: string; w: number; align: 'left' | 'center' | 'right' }[] = [
      { text: qty, w: colW.cant, align: 'center' },
      { text: unitId, w: colW.unit, align: 'center' },
      { text: code, w: colW.code, align: 'center' },
      { text: desc, w: colW.desc, align: 'left' },
      { text: money(ln.unit_price), w: colW.punit, align: 'right' },
      { text: '0', w: colW.dto, align: 'right' },
      { text: money(ln.line_total), w: colW.total, align: 'right' },
    ];
    for (const cell of cells) {
      const clipped =
        cell.align === 'left'
          ? wrapLines(cell.text, Math.floor(cell.w / 3.8), 1)[0] ?? cell.text
          : cell.text;
      const tw = font.widthOfTextAtSize(clipped, 6.5);
      const tx =
        cell.align === 'center'
          ? cx + (cell.w - tw) / 2
          : cell.align === 'right'
            ? cx + cell.w - tw - 3
            : cx + 3;
      page.drawText(clipped, {
        x: tx,
        y: topY(page, rowY + 10),
        size: 6.5,
        font,
        color: C.black,
      });
      cx += cell.w;
    }
    rowY += rowH;
  }
  y += tableBodyH + 10;

  // —— Total ——
  const total = receipt.total ?? 0;
  const totalsRight = PAGE_W - M;
  drawRightText(page, `TOTAL A PAGAR: ${moneyPen(total)}`, totalsRight, y, 9, fontB, C.black);
  y += 28;

  // —— Métodos de pago ——
  const payRows = paymentMethodsForPdf(receipt);
  page.drawText('MÉTODO(S) DE PAGO:', {
    x: M,
    y: topY(page, y + 10),
    size: 7.5,
    font: fontB,
    color: C.black,
  });
  y += 12;
  if (payRows.length === 0) {
    page.drawText('—', { x: M + 8, y: topY(page, y + 9), size: 8, font, color: C.black });
    y += 14;
  } else {
    for (const pr of payRows) {
      const line = `${pr.method} — ${moneyPen(pr.amount)}`;
      page.drawText(line, {
        x: M + 8,
        y: topY(page, y + 9),
        size: 8,
        font: fontB,
        color: C.black,
      });
      y += 12;
    }
    y += 4;
  }

  if (bankInfo) {
    page.drawText('CUENTAS BANCARIAS:', {
      x: M,
      y: topY(page, y + 9),
      size: 7.5,
      font: fontB,
      color: C.black,
    });
    y += 12;
    for (const para of bankInfo.split(/\n+/)) {
      const blines = wrapLines(para.trim(), 90, 8);
      for (const ln of blines) {
        page.drawText(ln, {
          x: M,
          y: topY(page, y + 8),
          size: 6.5,
          font,
          color: C.black,
        });
        y += 8;
      }
      y += 2;
    }
  }

  // Pie (sin Tukifac)
  const footY = PAGE_H - M - 16;
  const foot = 'GRACIAS POR SU PREFERENCIA';
  const ftw = fontB.widthOfTextAtSize(foot, 9);
  page.drawText(foot, {
    x: (PAGE_W - ftw) / 2,
    y: topY(page, footY + 9),
    size: 9,
    font: fontB,
    color: C.gray,
  });
  page.drawText('ZContable', {
    x: M,
    y: topY(page, footY + 9),
    size: 7,
    font,
    color: C.gray,
  });

  return doc.save();
}

/** Comprobante térmico 80 mm (227 pt), diseño ticket de referencia. */
export async function buildFiscalReceiptTicketPdf(
  receipt: PosSaleDetail,
  firm: FirmConfig | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  applyReceiptPdfMetadata(doc, receipt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageH = estimateTicketHeight(receipt, firm);
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
    drawCentered(page, ln, y, 8.5, fontB, C.black);
    y += 10;
  }
  if (ruc) {
    drawCentered(page, `RUC ${ruc}`, y, 6.5, font, C.gray);
    y += 8;
  }
  for (const part of [address, email, phone ? `Tel: ${phone}` : ''].filter(Boolean)) {
    for (const ln of wrapLines(part, 36, 3)) {
      drawCentered(page, ln, y, 6, font, C.gray);
      y += 7;
    }
  }
  y += 4;
  drawTicketDivider(page, y);
  y += 8;

  const docType = docTypeLabel(receipt.document_type_id ?? '');
  drawCentered(page, docType, y, 9, fontB, C.black);
  y += 12;
  drawCentered(page, receipt.number ?? '—', y, 8, fontB, C.black);
  y += 10;
  drawTicketDivider(page, y);
  y += 8;

  const issue = (receipt.issue_date ?? '').slice(0, 10);
  y = drawTicketKv(page, 'F. Emisión:', issue || '—', y, font, fontB);
  y = drawTicketKv(page, 'Cliente:', receipt.customer_name ?? '—', y, font, fontB);
  y = drawTicketKv(
    page,
    `${customerDocTicketLabel(receipt)}:`,
    receipt.customer_number || '—',
    y,
    font,
    fontB,
  );
  y = drawTicketAddressBlock(page, receipt.company?.address?.trim() || '—', y, font, fontB);
  y = drawTicketKv(page, 'Vendedor:', sellerName(receipt), y, font, fontB);
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
  const hdrSize = 5.5;
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
      color: C.black,
    });
  }
  y += 10;
  drawTicketDivider(page, y);
  y += 6;

  const lines = [...(receipt.lines ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id,
  );
  const cellSize = 5.5;
  for (const ln of lines) {
    const code = ln.internal_code?.trim() || '—';
    const unitId = ln.unit_type_id?.trim() || 'NIU';
    const desc = ln.description || ln.product_name || '—';
    const descLines = wrapLines(desc, 24, 4);
    const rowLines = Math.max(1, descLines.length);
    const rowH = rowLines * 7 + 2;

    const drawCell = (text: string, cx: number, w: number, align: 'left' | 'center' | 'right', lineIdx: number) => {
      const tw = font.widthOfTextAtSize(text, cellSize);
      const tx =
        align === 'center'
          ? cx + (w - tw) / 2
          : align === 'right'
            ? cx + w - tw
            : cx;
      page.drawText(text, {
        x: tx,
        y: topY(page, y + lineIdx * 7 + cellSize),
        size: cellSize,
        font,
        color: C.black,
      });
    };

    drawCell(code, col.cod.x, col.cod.w, 'left', 0);
    drawCell(Number(ln.quantity).toFixed(0), col.cant.x, col.cant.w, 'center', 0);
    drawCell(unitId, col.unit.x, col.unit.w, 'center', 0);
    drawCell(money(ln.unit_price), col.punit.x, col.punit.w, 'right', 0);
    drawCell(money(ln.line_total), col.total.x, col.total.w, 'right', 0);
    const dLines = descLines.length ? descLines : ['—'];
    dLines.forEach((dl, i) => drawCell(dl, col.desc.x, col.desc.w, 'left', i));
    y += rowH;
  }

  y += 2;
  drawTicketDivider(page, y);
  y += 10;

  const total = receipt.total ?? 0;
  const totalLabel = `TOTAL A PAGAR: ${moneyPen(total)}`;
  const totalSize = 6.5;
  const tlw = fontB.widthOfTextAtSize(totalLabel, totalSize);
  page.drawText(totalLabel, {
    x: TICKET_W - TICKET_M - tlw,
    y: topY(page, y + 8),
    size: totalSize,
    font: fontB,
    color: C.black,
  });
  y += 14;

  const pays = receipt.payments ?? [];
  if (pays.length > 0) {
    page.drawText('PAGOS:', { x: TICKET_M, y: topY(page, y + 7), size: 6.5, font: fontB, color: C.black });
    y += 9;
    const payDate = formatDateDDMMYYYY(issue);
    for (const p of pays) {
      const line = `- ${payDate} - ${paymentMethodDisplay(p.method)} - ${moneyPen(p.amount)}`;
      for (const ln of wrapLines(line, 44, 2)) {
        page.drawText(ln, { x: TICKET_M, y: topY(page, y + 7), size: 6, font, color: C.black });
        y += 8;
      }
    }
  } else {
    const payDate = formatDateDDMMYYYY(issue);
    const methods = paymentMethodsForPdf(receipt);
    page.drawText('PAGOS:', { x: TICKET_M, y: topY(page, y + 7), size: 6.5, font: fontB, color: C.black });
    y += 9;
    if (methods.length === 0) {
      page.drawText(`- ${payDate} - — - ${moneyPen(total)}`, {
        x: TICKET_M,
        y: topY(page, y + 7),
        size: 6,
        font,
        color: C.black,
      });
      y += 8;
    } else {
      for (const m of methods) {
        const line = `- ${payDate} - ${m.method} - ${moneyPen(m.amount)}`;
        for (const ln of wrapLines(line, 44, 2)) {
          page.drawText(ln, { x: TICKET_M, y: topY(page, y + 7), size: 6, font, color: C.black });
          y += 8;
        }
      }
    }
  }

  const paid = pays.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const saldo = Math.max(0, total - paid);
  const saldoLabel = `SALDO: ${moneyPen(saldo)}`;
  const slw = font.widthOfTextAtSize(saldoLabel, 6.5);
  page.drawText(saldoLabel, {
    x: TICKET_W - TICKET_M - slw,
    y: topY(page, y + 7),
    size: 6.5,
    font,
    color: C.black,
  });
  y += 10;

  if (bankInfo) {
    page.drawText('CUENTAS BANCARIAS:', {
      x: TICKET_M,
      y: topY(page, y + 7),
      size: 6.5,
      font: fontB,
      color: C.black,
    });
    y += 9;
    for (const para of bankInfo.split(/\n+/)) {
      const blines = wrapLines(para.trim(), 42, 8);
      for (const ln of blines) {
        page.drawText(ln, {
          x: TICKET_M,
          y: topY(page, y + 6),
          size: 6,
          font,
          color: C.black,
        });
        y += 7;
      }
      y += 1;
    }
    y += 4;
  }

  drawCentered(page, 'GRACIAS POR SU PREFERENCIA', y, 7.5, fontB, C.gray);
  y += 12;
  drawCentered(page, 'ZContable', y, 6.5, fontB, C.black);

  return doc.save();
}

function drawTicketKv(
  page: PDFPage,
  label: string,
  value: string,
  y: number,
  font: PDFFont,
  fontB: PDFFont,
): number {
  const size = 6.5;
  const valueX = TICKET_M + TICKET_KV_LABEL_W;
  const valueW = TICKET_W - TICKET_M - valueX;
  const valLines = wrapLinesByWidth((value ?? '').trim() || '—', font, size, valueW, 5);
  const lines = valLines.length > 0 ? valLines : ['—'];
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) {
      page.drawText(label, {
        x: TICKET_M,
        y: topY(page, y + size),
        size,
        font: fontB,
        color: C.black,
      });
    }
    page.drawText(lines[i], {
      x: valueX,
      y: topY(page, y + size),
      size,
      font,
      color: C.black,
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
  font: PDFFont,
  fontB: PDFFont,
): number {
  const size = 6.5;
  const label = 'Dirección:';
  const valueX = TICKET_M + TICKET_KV_LABEL_W;
  const valueW = TICKET_W - TICKET_M - valueX;
  const lines = wrapLinesByWidth(address, font, size, valueW, 12);
  const toDraw = lines.length > 0 ? lines : ['—'];
  for (let i = 0; i < toDraw.length; i++) {
    if (i === 0) {
      page.drawText(label, {
        x: TICKET_M,
        y: topY(page, y + size),
        size,
        font: fontB,
        color: C.black,
      });
    }
    page.drawText(toDraw[i], {
      x: valueX,
      y: topY(page, y + size),
      size,
      font,
      color: C.black,
    });
    y += 8;
  }
  return y + 2;
}
