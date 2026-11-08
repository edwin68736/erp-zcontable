/** Política de contraseñas (la misma que valida el servidor; el servidor es quien decide). */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX_BYTES = 72;

export interface PasswordCheck {
  /** Mínimo de 10 caracteres. */
  length: boolean;
  /** No pasa de 72 bytes (bcrypt ignora lo que sobra). */
  maxBytes: boolean;
  /** No contiene el nombre de usuario. */
  noUsername: boolean;
  /** No es una repetición ni una secuencia obvia (1234567890, aaaaaaaaaa…). */
  notObvious: boolean;
}

const COMMON = new Set(['1234567890', '0123456789', 'contraseña', 'contrasena1', 'password123', 'qwertyuiop', 'estudiocontable', 'zcontable123', 'administrador']);

function isSequence(s: string): boolean {
  const c = [...s];
  if (c.length < 4) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < c.length; i++) {
    const d = c[i].codePointAt(0)! - c[i - 1].codePointAt(0)!;
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

export function checkPassword(pw: string, username = ''): PasswordCheck {
  const low = pw.toLowerCase();
  const u = username.trim().toLowerCase();
  const chars = [...pw];
  return {
    length: chars.length >= PASSWORD_MIN,
    maxBytes: new TextEncoder().encode(pw).length <= PASSWORD_MAX_BYTES,
    noUsername: u.length < 3 || !low.includes(u),
    notObvious: pw.length > 0 && !COMMON.has(low) && !chars.every((x) => x === chars[0]) && !isSequence(low),
  };
}

export const passwordOk = (c: PasswordCheck): boolean => c.length && c.maxBytes && c.noUsername && c.notObvious;
