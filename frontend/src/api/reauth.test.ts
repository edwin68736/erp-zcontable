import { describe, expect, it, vi } from 'vitest';
import { askReauth, isReauthRequired, registerReauthPrompt } from './reauth';

describe('reauth', () => {
  it('reconoce la respuesta que pide confirmar la contraseña', () => {
    expect(isReauthRequired(403, 'reauth_required')).toBe(true);
    expect(isReauthRequired(403, 'password_change_required')).toBe(false);
    expect(isReauthRequired(401, 'reauth_required')).toBe(false);
    expect(isReauthRequired(undefined, undefined)).toBe(false);
  });

  it('sin diálogo registrado no hay confirmación', async () => {
    expect(await askReauth()).toBe(false);
  });

  it('varias peticiones a la vez comparten un solo diálogo', async () => {
    const prompt = vi.fn(() => Promise.resolve(true));
    const off = registerReauthPrompt(prompt);
    const [a, b, c] = await Promise.all([askReauth(), askReauth(), askReauth()]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(prompt).toHaveBeenCalledTimes(1);
    // Terminado el primero, una petición nueva vuelve a preguntar.
    await askReauth();
    expect(prompt).toHaveBeenCalledTimes(2);
    off();
    expect(await askReauth()).toBe(false);
  });

  it('si la persona cancela, o el diálogo falla, devuelve false', async () => {
    let off = registerReauthPrompt(() => Promise.resolve(false));
    expect(await askReauth()).toBe(false);
    off();
    off = registerReauthPrompt(() => Promise.reject(new Error('boom')));
    expect(await askReauth()).toBe(false);
    off();
  });

  it('quitar un diálogo viejo no quita el nuevo', async () => {
    const offOld = registerReauthPrompt(() => Promise.resolve(false));
    const offNew = registerReauthPrompt(() => Promise.resolve(true));
    offOld();
    expect(await askReauth()).toBe(true);
    offNew();
  });
});
