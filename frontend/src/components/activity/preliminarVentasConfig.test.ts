import { describe, expect, it } from 'vitest';
import { PRELIMINAR_VENTAS_EXCEL_FILL as F, preliminarVentasExcelFillArgb } from './preliminarVentasConfig';

describe('preliminarVentasExcelFillArgb', () => {
  it('colorea cada estado como los demás Excel', () => {
    expect(preliminarVentasExcelFillArgb('enviado', 'on_time', false)).toBe(F.aTiempo);
    expect(preliminarVentasExcelFillArgb('enviado', undefined, false)).toBe(F.aTiempo);
    expect(preliminarVentasExcelFillArgb('enviado', 'late', false)).toBe(F.fueraDePlazo);
    expect(preliminarVentasExcelFillArgb('registrado', 'late', false)).toBe(F.fueraDePlazo);
    expect(preliminarVentasExcelFillArgb('registrado', 'on_time', false)).toBe(F.pendiente);
    expect(preliminarVentasExcelFillArgb('pendiente', 'pending', false)).toBe(F.pendiente);
    expect(preliminarVentasExcelFillArgb('pendiente', 'missing', false)).toBe(F.pendiente);
  });

  it('la suspensión manda sobre cualquier estado', () => {
    expect(preliminarVentasExcelFillArgb('enviado', 'late', true)).toBe(F.suspendida);
    expect(preliminarVentasExcelFillArgb('pendiente', 'missing', true)).toBe(F.suspendida);
  });
});
