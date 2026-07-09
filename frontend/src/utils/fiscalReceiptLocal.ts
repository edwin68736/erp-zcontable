/** Comprobantes emitidos en ZContable (no URLs externas legacy). */
export function isLocalFiscalReceipt(origin?: string | null): boolean {
  const o = (origin ?? '').trim();
  return o === 'issued_local' || o === 'pos_sale';
}
