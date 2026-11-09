import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmDialog } from './confirmDialog';
import { __resetNotifyForTests, close, getState, registerNotifyHost } from './notify';

beforeEach(() => __resetNotifyForTests());
afterEach(() => vi.unstubAllGlobals());

describe('confirmDialog', () => {
  it('con el componente de dibujo muestra una pregunta y devuelve la respuesta', async () => {
    registerNotifyHost();
    const p = confirmDialog({ message: '¿Seguro?', danger: true, confirmLabel: 'Quitar' });
    expect(getState().current).toMatchObject({ kind: 'question', text: '¿Seguro?', danger: true, confirmLabel: 'Quitar' });
    close(true);
    expect(await p).toBe(true);
    const q = confirmDialog({ message: 'otra' });
    close(false);
    expect(await q).toBe(false);
  });

  it('sin componente de dibujo cae al confirm del navegador', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('window', { confirm });
    expect(await confirmDialog({ message: 'hola' })).toBe(true);
    expect(confirm).toHaveBeenCalledWith('hola');
  });

  it('sin componente ni navegador, la respuesta es no', async () => {
    expect(await confirmDialog({ message: 'x' })).toBe(false);
  });
});
