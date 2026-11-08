import { describe, expect, it } from 'vitest';
import { checkPassword, passwordOk } from './passwordPolicy';

describe('passwordPolicy', () => {
  it('acepta un DNI de 8 dígitos o una clave de 6 que no sea obvia', () => {
    expect(passwordOk(checkPassword('45671289', 'maria'))).toBe(true);
    expect(passwordOk(checkPassword('482910', 'maria'))).toBe(true);
    expect(passwordOk(checkPassword('123456', 'maria'))).toBe(false); // secuencia
    expect(passwordOk(checkPassword('111111', 'maria'))).toBe(false); // repetición
  });

  it('acepta una contraseña larga y no obvia', () => {
    expect(passwordOk(checkPassword('Una-clave-larga-2026', 'maria'))).toBe(true);
    expect(passwordOk(checkPassword('frase secreta del estudio', 'maria'))).toBe(true);
  });

  it('rechaza las cortas, las comunes, las secuencias y las que contienen el usuario', () => {
    expect(checkPassword('corta', 'maria').length).toBe(false);
    expect(checkPassword('12345', 'maria').length).toBe(false);
    expect(checkPassword('1234567890', 'maria').notObvious).toBe(false);
    expect(checkPassword('aaaaaaaaaaaa', 'maria').notObvious).toBe(false);
    expect(checkPassword('abcdefghijkl', 'maria').notObvious).toBe(false);
    expect(checkPassword('9876543210', 'maria').notObvious).toBe(false);
    expect(checkPassword('contraseña', 'maria').notObvious).toBe(false);
    expect(checkPassword('MARIA-2026-clave', 'maria').noUsername).toBe(false);
    expect(checkPassword('Maria-2026-clave', 'ma').noUsername).toBe(true); // usuarios de menos de 3 letras no se comparan
    expect(passwordOk(checkPassword('', ''))).toBe(false);
  });

  it('cuenta los bytes (bcrypt solo mira 72) y no las letras', () => {
    expect(checkPassword('a'.repeat(72), '').maxBytes).toBe(true);
    expect(checkPassword('a'.repeat(73), '').maxBytes).toBe(false);
    expect(checkPassword('á'.repeat(37), '').maxBytes).toBe(false); // 37 letras = 74 bytes
  });
});
