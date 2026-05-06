/** Convierte yyyy-MM-dd (o ISO) a dd/MM/yyyy para extractos y PDFs. */
export function formatLedgerDateDisplay(value?: string | null): string {
  if (!value) return '—';
  const s = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return value.length >= 10 ? value.slice(0, 10) : value;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
