import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceKey, getDeviceToken, newDeviceToken } from './device';

/** El entorno de pruebas es node: se simula el almacenamiento del navegador. */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

describe('device', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });

  it('genera identificadores aleatorios válidos para el servidor', () => {
    const a = newDeviceToken();
    expect(a).toMatch(/^[a-f0-9]{48}$/);
    expect(newDeviceToken()).not.toBe(a);
  });

  it('guarda el identificador por usuario y lo reutiliza', () => {
    const maria = getDeviceToken('Maria');
    expect(getDeviceToken('maria')).toBe(maria);
    expect(getDeviceToken(' MARIA ')).toBe(maria);
    expect(storage.getItem(deviceKey('maria'))).toBe(maria);
  });

  it('cada usuario del mismo navegador tiene su propio identificador', () => {
    expect(getDeviceToken('maria')).not.toBe(getDeviceToken('pedro'));
  });

  it('descarta un valor dañado y crea otro', () => {
    storage.setItem(deviceKey('maria'), 'corto');
    expect(getDeviceToken('maria')).toMatch(/^[a-f0-9]{48}$/);
  });

  it('sin almacenamiento devuelve vacío (el servidor entonces no registra el equipo)', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('bloqueado');
        },
        setItem: () => {
          throw new Error('bloqueado');
        },
      },
    });
    expect(getDeviceToken('maria')).toBe('');
  });
});
