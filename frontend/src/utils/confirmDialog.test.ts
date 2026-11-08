import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmDialog, registerConfirmPrompt } from './confirmDialog';

afterEach(() => vi.unstubAllGlobals());

describe('confirmDialog', () => {
  it('usa el diálogo registrado y devuelve su respuesta', async () => {
    const prompt = vi.fn(() => Promise.resolve(true));
    const off = registerConfirmPrompt(prompt);
    expect(await confirmDialog({ message: '¿Seguro?', danger: true })).toBe(true);
    expect(prompt).toHaveBeenCalledWith({ message: '¿Seguro?', danger: true });
    off();
  });

  it('cancelar devuelve false', async () => {
    const off = registerConfirmPrompt(() => Promise.resolve(false));
    expect(await confirmDialog({ message: 'x' })).toBe(false);
    off();
  });

  it('si el diálogo falla, no se confirma nada', async () => {
    const off = registerConfirmPrompt(() => Promise.reject(new Error('boom')));
    expect(await confirmDialog({ message: 'x' })).toBe(false);
    off();
  });

  it('sin diálogo registrado cae al confirm del navegador', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('window', { confirm });
    expect(await confirmDialog({ message: 'hola' })).toBe(true);
    expect(confirm).toHaveBeenCalledWith('hola');
  });

  it('sin diálogo ni navegador, la respuesta es no', async () => {
    expect(await confirmDialog({ message: 'x' })).toBe(false);
  });

  it('quitar un diálogo viejo no quita el nuevo', async () => {
    const offOld = registerConfirmPrompt(() => Promise.resolve(false));
    const offNew = registerConfirmPrompt(() => Promise.resolve(true));
    offOld();
    expect(await confirmDialog({ message: 'x' })).toBe(true);
    offNew();
  });
});
