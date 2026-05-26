/** Caracteres no válidos en nombres de archivo Windows/macOS/Linux. */
const INVALID_FILENAME = /[\\/:*?"<>|]/g;

/** Número visible del comprobante (ej. NV01-00000001) como nombre base. */
export function fiscalReceiptPdfBaseName(receipt: {
  number?: string | null;
  id?: number | string;
}): string {
  const raw = (receipt.number ?? '').trim().replace(INVALID_FILENAME, '');
  if (raw) return raw;
  const id = receipt.id;
  return id != null && id !== '' ? `comprobante-${id}` : 'comprobante';
}

/** Nombre de archivo: NV01-00000001.pdf (A4 y ticket usan el mismo nombre). */
export function fiscalReceiptPdfFilename(receipt: {
  number?: string | null;
  id?: number | string;
}): string {
  return `${fiscalReceiptPdfBaseName(receipt)}.pdf`;
}
