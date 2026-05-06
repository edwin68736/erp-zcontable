/** Texto mostrado en extracto/PDF: como mucho `maxLen` caracteres del número de documento. */
export function truncateDocumentNumberDisplay(value: string | undefined | null, maxLen = 9): string {
  const s = (value ?? '').trim();
  if (!s) return '—';
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}
