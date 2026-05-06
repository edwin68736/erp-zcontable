import type { User } from '../types/dashboard';

/** Texto para selects y listas: nombre + usuario (+ correo si existe). */
export function formatUserPickLabel(u: Pick<User, 'name' | 'username' | 'email'>): string {
  const mail = u.email?.trim();
  const login = u.username?.trim() ? u.username.trim() : '—';
  return mail ? `${u.name} (@${login} · ${mail})` : `${u.name} (@${login})`;
}
