import type { DeviceTrustMode } from '../../services/security';

/** Cómo quedó registrado un equipo de confianza. */
export const VIA_LABEL: Record<string, string> = {
  aprendido: 'registrado al entrar',
  codigo: 'verificado con código',
  recuperacion: 'verificado con código de recuperación',
  aprobacion: 'aprobado por un administrador',
};

export const MODE_LABEL: Record<DeviceTrustMode, string> = {
  off: 'Desactivado',
  learn: 'Aprendizaje',
  enforce: 'Obligatorio',
};

export const MODE_HELP: Record<DeviceTrustMode, string> = {
  off: 'No se registra ni se verifica nada. Se entra solo con usuario y contraseña.',
  learn: 'Los equipos desde los que la gente entra se van registrando en silencio. No se pide nada. Sirve para preparar el paso a «Obligatorio» sin interrumpir a nadie.',
  enforce: 'Un equipo nuevo debe verificarse (código de la app o aprobación de un administrador) antes de dar acceso.',
};

/** Texto de los códigos de recuperación para copiar o descargar. */
export function recoveryCodesText(codes: string[], username?: string): string {
  const lines = ['ZContable — códigos de recuperación'];
  if (username) lines.push(`Usuario: ${username}`);
  lines.push('', ...codes, '', 'Cada código sirve una sola vez. Guárdelos en un lugar seguro, lejos de esta computadora.');
  return lines.join('\n');
}

/** «2026-11-08T00:00:00-05:00» → «2026-11-08» para un campo de fecha ('' si no hay). */
export function dateInputValue(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : '';
}
