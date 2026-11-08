import { describe, expect, it } from 'vitest';
import { detraccionesShowStatusEdit } from './detraccionesConfig';

describe('detraccionesShowStatusEdit', () => {
  it('depende del permiso, no de la pantalla: quien lo tiene lo ve', () => {
    expect(detraccionesShowStatusEdit(true, 'pendiente', false)).toBe(true);
    expect(detraccionesShowStatusEdit(true, 'cargado', false)).toBe(true);
  });

  it('sin el permiso no se muestra', () => {
    expect(detraccionesShowStatusEdit(false, 'pendiente', false)).toBe(false);
  });

  it('solo desde «pendiente» o «cargado» (no se revierte un «Sin clave» / «No corresponde» ya marcado)', () => {
    for (const s of ['sin_clave', 'no_corresponde', 'verificado']) {
      expect(detraccionesShowStatusEdit(true, s, false)).toBe(false);
    }
  });

  it('una empresa suspendida en el periodo bloquea cualquier cambio', () => {
    expect(detraccionesShowStatusEdit(true, 'pendiente', true)).toBe(false);
  });
});
