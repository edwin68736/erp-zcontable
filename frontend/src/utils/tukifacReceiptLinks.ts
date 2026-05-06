/** Enlaces devueltos por el API tras emitir o al listar comprobantes Tukifac. */
export type TukifacReceiptViewLinks = {
  number?: string;
  print_ticket_url?: string;
  pdf_url?: string;
};

export function parseTukifacReceiptViewLinks(receipt: unknown): TukifacReceiptViewLinks | null {
  if (!receipt || typeof receipt !== 'object') return null;
  const o = receipt as Record<string, unknown>;
  const ticket = typeof o.print_ticket_url === 'string' ? o.print_ticket_url.trim() : '';
  const pdf = typeof o.pdf_url === 'string' ? o.pdf_url.trim() : '';
  if (!ticket && !pdf) return null;
  const number = typeof o.number === 'string' ? o.number : undefined;
  return { number, print_ticket_url: ticket || undefined, pdf_url: pdf || undefined };
}
