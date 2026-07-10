/** Paleta y estilos compartidos — liquidación PDF (referencia ZContable). */
export const PDF_LIQ = {
  blue: '#4A76B8',
  blueLight: '#6B93CB',
  blueDark: '#3D6299',
  grayBg: '#EFEFEF',
  grayBorder: '#D1D5DB',
  white: '#FFFFFF',
  text: '#1A1A1A',
  textMuted: '#475569',
  /** Fila resaltada de totales (amarillo pastel suave). */
  highlightYellow: '#FFF9C4',
};

export function formatIssueDateForPdf(raw?: string | null): string {
  const iso = (raw ?? '').slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '—';
  return `${Number(m[3])}/${m[2]}/${m[1]}`;
}
