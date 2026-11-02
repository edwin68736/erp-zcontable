import { describe, expect, it } from 'vitest';
import type { BuzonSync } from '../../../services/sunatBuzon';
import { buzonBadge, timeAgo } from './buzonUi';

const st = (patch: Partial<BuzonSync>): BuzonSync => ({
  company_id: 1,
  status: 'ok',
  source: 'manual',
  duration_ms: 0,
  notificaciones: 0,
  mensajes: 0,
  no_leidas: 0,
  urgentes: 0,
  nuevos: 0,
  blocked: false,
  ...patch,
});

describe('buzonBadge', () => {
  it('«Sin clave» manda sobre cualquier sincronización anterior', () => {
    expect(buzonBadge({ sol_configurado: false }, st({ status: 'ok', last_success_at: '2026-11-01T01:00:00Z' })).label).toBe('Sin clave');
  });

  it('sin estado guardado todavía no se sincronizó', () => {
    expect(buzonBadge({ sol_configurado: true }, undefined).label).toBe('Sin sincronizar');
  });

  it('credenciales rechazadas solo mientras sigan bloqueadas', () => {
    expect(buzonBadge({ sol_configurado: true }, st({ status: 'credenciales_rechazadas', blocked: true })).label).toBe('Credenciales rechazadas');
    // Corrigieron la clave: ya no está bloqueada, queda como último intento con error.
    expect(buzonBadge({ sol_configurado: true }, st({ status: 'credenciales_rechazadas', blocked: false })).label).toBe('Error');
  });

  it('un error con una sincronización buena previa lo dice', () => {
    expect(buzonBadge({ sol_configurado: true }, st({ status: 'error', last_success_at: '2026-11-01T01:00:00Z' })).label).toBe('Último intento con error');
  });

  it('ok es «Sincronizado»', () => {
    expect(buzonBadge({ sol_configurado: true }, st({ status: 'ok', last_success_at: '2026-11-01T01:00:00Z' })).label).toBe('Sincronizado');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  it('formatea en minutos, horas y días', () => {
    expect(timeAgo(undefined, now)).toBe('nunca');
    expect(timeAgo('2026-11-02T11:59:50Z', now)).toBe('hace un momento');
    expect(timeAgo('2026-11-02T11:40:00Z', now)).toBe('hace 20 min');
    expect(timeAgo('2026-11-02T09:00:00Z', now)).toBe('hace 3 h');
    expect(timeAgo('2026-11-01T12:00:00Z', now)).toBe('hace 1 día');
    expect(timeAgo('2026-10-30T12:00:00Z', now)).toBe('hace 3 días');
  });
});
