/** Etiqueta y color de cada tipo de evento. */
export const EVENT_LABEL: Record<string, { label: string; cls: string }> = {
  login_ok: { label: 'Ingreso', cls: 'bg-emerald-50 text-emerald-700' },
  login_fail: { label: 'Intento fallido', cls: 'bg-red-50 text-red-700' },
  login_blocked: { label: 'Bloqueado', cls: 'bg-amber-100 text-amber-800' },
  password_change: { label: 'Cambió su contraseña', cls: 'bg-sky-50 text-sky-700' },
  password_change_fail: { label: 'Cambio de contraseña fallido', cls: 'bg-red-50 text-red-700' },
  password_reset: { label: 'Contraseña restablecida', cls: 'bg-violet-50 text-violet-700' },
  logout: { label: 'Cerró sesión', cls: 'bg-slate-100 text-slate-700' },
  idle_logout: { label: 'Cierre por inactividad', cls: 'bg-amber-50 text-amber-700' },
  session_revoked: { label: 'Sesión cerrada a la fuerza', cls: 'bg-violet-50 text-violet-700' },
};

/** «Chrome 130 · Windows», «Edge · Windows», «Firefox · Android»… a partir del User-Agent (solo para leer rápido). */
export function describeUserAgent(ua: string): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

