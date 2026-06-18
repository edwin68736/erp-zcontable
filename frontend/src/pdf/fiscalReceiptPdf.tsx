import type { FirmConfig } from '../types/dashboard';
import type { PosSaleDetail } from '../services/posSales';
import { buildFiscalReceiptA4Pdf, buildFiscalReceiptTicketPdf } from './fiscalReceiptPdfBuild';
import { fiscalReceiptPdfFilename } from './fiscalReceiptPdfFilename';

export { docTypeLabel } from './fiscalReceiptPdfBuild';
export { fiscalReceiptPdfFilename, fiscalReceiptPdfBaseName } from './fiscalReceiptPdfFilename';

export type ReceiptPdfFormat = 'a4' | 'ticket';

export type FirmBranding = Partial<
  Pick<FirmConfig, 'name' | 'ruc' | 'address' | 'phone' | 'email' | 'logo_url' | 'statement_bank_info'>
>;

function firmFromBranding(firm: FirmBranding): FirmConfig {
  return {
    id: 0,
    name: firm.name?.trim() || 'Estudio contable',
    ruc: firm.ruc?.trim() || '',
    address: firm.address?.trim() || '',
    phone: firm.phone,
    email: firm.email,
    logo_url: firm.logo_url,
    statement_bank_info: firm.statement_bank_info,
  };
}

export async function buildFiscalReceiptPdfBlob(
  receipt: PosSaleDetail,
  firm: FirmBranding,
  format: ReceiptPdfFormat = 'a4',
): Promise<Blob> {
  const cfg = firmFromBranding(firm);
  const bytes =
    format === 'ticket'
      ? await buildFiscalReceiptTicketPdf(receipt, cfg)
      : await buildFiscalReceiptA4Pdf(receipt, cfg);
  return new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' });
}

/**
 * Abre el PDF en una pestaña nueva.
 * El título interno del PDF (setTitle en pdf-lib) ayuda al nombre al guardar en Chrome.
 * Nota: no usar noopener aquí; con ventana en blanco + document.write la pestaña queda en about:blank.
 */
export function openPdfBlobInNewTab(blob: Blob, filename?: string): boolean {
  const name = (filename?.trim() || 'comprobante.pdf').replace(/[\\/:*?"<>|]/g, '') || 'comprobante.pdf';
  const file = new File([blob], name, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    return false;
  }
  w.opener = null;
  setTimeout(() => URL.revokeObjectURL(url), 300_000);
  return true;
}

/** Imprime el PDF vectorial (nitidez correcta en ticket 80 mm y A4). */
export function printFiscalReceiptPdfBlob(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Imprimir comprobante');
  iframe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;border:0;opacity:0;pointer-events:none;overflow:hidden';
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(url);
    }, 120_000);
  };

  iframe.onload = () => {
    window.setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        if (!win) return;
        win.focus();
        win.print();
      } finally {
        cleanup();
      }
    }, 350);
  };

  iframe.src = url;
  return true;
}

export async function openFiscalReceiptPdf(
  receipt: PosSaleDetail,
  firm: FirmBranding,
  format: ReceiptPdfFormat = 'a4',
): Promise<boolean> {
  const blob = await buildFiscalReceiptPdfBlob(receipt, firm, format);
  return openPdfBlobInNewTab(blob, fiscalReceiptPdfFilename(receipt));
}

export async function downloadFiscalReceiptPdf(
  receipt: PosSaleDetail,
  firm: FirmBranding,
  filename?: string,
  format: ReceiptPdfFormat = 'a4',
) {
  const blob = await buildFiscalReceiptPdfBlob(receipt, firm, format);
  const name = filename ?? fiscalReceiptPdfFilename(receipt);
  const file = new File([blob], name, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
