import { describe, expect, it } from 'vitest';
import { MODE_HELP, MODE_LABEL, VIA_LABEL, dateInputValue, recoveryCodesText } from './deviceUi';

describe('deviceUi', () => {
  it('tiene texto para cada forma de registrar un equipo y cada modo', () => {
    for (const v of ['aprendido', 'codigo', 'recuperacion', 'aprobacion']) expect(VIA_LABEL[v]).toBeTruthy();
    for (const m of ['off', 'learn', 'enforce'] as const) {
      expect(MODE_LABEL[m]).toBeTruthy();
      expect(MODE_HELP[m]).toBeTruthy();
    }
  });

  it('arma el texto de los códigos de recuperación', () => {
    const t = recoveryCodesText(['abcde-fghjk', 'mnpqr-stuvw'], 'maria');
    expect(t).toContain('Usuario: maria');
    expect(t).toContain('abcde-fghjk\nmnpqr-stuvw');
    expect(recoveryCodesText(['x'])).not.toContain('Usuario');
  });

  it('toma solo la fecha para el campo de fecha', () => {
    expect(dateInputValue('2026-11-08T00:00:00-05:00')).toBe('2026-11-08');
    expect(dateInputValue(null)).toBe('');
    expect(dateInputValue(undefined)).toBe('');
    expect(dateInputValue('basura')).toBe('');
  });
});
