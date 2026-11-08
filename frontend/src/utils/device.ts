/**
 * Identificador de este navegador para los «dispositivos de confianza». Es un valor aleatorio que se guarda solo en este
 * navegador (el servidor guarda únicamente su huella). Va por usuario: si varias personas comparten el mismo perfil de
 * Chrome, cada una tiene su propio identificador y la confianza de una no vale para la otra.
 */
const PREFIX = 'zc_dev_';

/** 48 caracteres hexadecimales (192 bits) a partir de un generador criptográfico. */
export function newDeviceToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deviceKey(username: string): string {
  return PREFIX + username.trim().toLowerCase();
}

/** El identificador de este navegador para ese usuario; se crea la primera vez. '' si no hay almacenamiento. */
export function getDeviceToken(username: string): string {
  const key = deviceKey(username);
  try {
    const saved = window.localStorage.getItem(key);
    if (saved && /^[A-Za-z0-9_-]{32,128}$/.test(saved)) return saved;
    const created = newDeviceToken();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return '';
  }
}
