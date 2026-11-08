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
