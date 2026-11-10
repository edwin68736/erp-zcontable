import { describe, expect, it } from 'vitest';
import { ACTIVE_WINDOW_MS, IDLE_LIMIT_MS, IDLE_WARNING_MS, idleState, secondsToIdleLogout } from './activity';

describe('activity', () => {
  it('el límite de inactividad es de 30 minutos, con aviso 2 minutos antes', () => {
    expect(IDLE_LIMIT_MS).toBe(30 * 60 * 1000);
    expect(IDLE_WARNING_MS).toBe(2 * 60 * 1000);
    expect(ACTIVE_WINDOW_MS).toBe(2 * 60 * 1000);
  });

  it('pasa de ok a aviso y a cerrada según el tiempo sin actividad', () => {
    expect(idleState(0)).toBe('ok');
    expect(idleState(27 * 60 * 1000 + 59_000)).toBe('ok');
    expect(idleState(28 * 60 * 1000)).toBe('warning');
    expect(idleState(29 * 60 * 1000 + 59_000)).toBe('warning');
    expect(idleState(30 * 60 * 1000)).toBe('expired');
    expect(idleState(45 * 60 * 1000)).toBe('expired');
  });

  it('cuenta los segundos que faltan sin pasar de cero', () => {
    expect(secondsToIdleLogout(28 * 60 * 1000)).toBe(120);
    expect(secondsToIdleLogout(29 * 60 * 1000 + 30_000)).toBe(30);
    expect(secondsToIdleLogout(40 * 60 * 1000)).toBe(0);
  });
});

describe('actividad compartida entre pestañas', () => {
  it('manda un aviso periódico al servidor, bastante antes del límite de inactividad', async () => {
    const { HEARTBEAT_MS } = await import('./activity');
    expect(HEARTBEAT_MS).toBeLessThan(IDLE_LIMIT_MS / 4);
    expect(HEARTBEAT_MS).toBeGreaterThanOrEqual(ACTIVE_WINDOW_MS);
  });

  it('la última actividad es la más reciente entre esta pestaña y las demás', async () => {
    const { vi } = await import('vitest');
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: { getItem: () => JSON.stringify({ id: 7 }) },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
      addEventListener: () => undefined,
    });
    try {
      vi.resetModules();
      const act = await import('./activity');
      // Otra pestaña del mismo usuario tocó algo hace 10 s; esta lleva mucho sin actividad propia.
      store.set('zc_last_activity:7', String(Date.now() - 10_000));
      expect(act.msSinceActivity()).toBeLessThan(15_000);
      act.markActivity();
      expect(Number(store.get('zc_last_activity:7'))).toBeGreaterThan(Date.now() - 2000);
      // Otro usuario en el mismo navegador no cuenta.
      store.clear();
      store.set('zc_last_activity:99', String(Date.now() + 1_000_000));
      expect(act.msSinceActivity()).toBeLessThan(IDLE_LIMIT_MS);
      expect(act.lastActivityAt()).toBeLessThanOrEqual(Date.now());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
