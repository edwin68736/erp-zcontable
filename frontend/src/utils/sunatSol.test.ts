import { describe, expect, it } from 'vitest';
import { sunatAccessFallback, sunatLoginPageUrl } from './sunatSol';

describe('sunatAccessFallback', () => {
  it('con intentos disponibles se puede reintentar', () => {
    expect(sunatAccessFallback({ code: 'respuesta_inesperada', attempts_left: 1 })).toBe('retry');
    expect(sunatAccessFallback({ code: 'sunat_no_disponible', attempts_left: 2 })).toBe('retry');
    expect(sunatAccessFallback({ code: 'en_curso' })).toBe('retry');
  });

  it('sin intentos (el servidor ya los agotó) se pasa a las claves', () => {
    expect(sunatAccessFallback({ code: 'respuesta_inesperada', attempts_left: 0 })).toBe('manual');
    expect(sunatAccessFallback({ code: 'intentos_agotados', attempts_left: 0 })).toBe('manual');
  });

  it('clave rechazada, captcha o bloqueo: se muestran las claves de inmediato', () => {
    for (const code of ['credenciales_rechazadas', 'credenciales_en_pausa', 'captcha', 'autenticacion_bloqueada']) {
      expect(sunatAccessFallback({ code, attempts_left: 2 })).toBe('manual');
    }
  });

  it('faltan datos o sin acceso: no hay nada que hacer', () => {
    expect(sunatAccessFallback({ code: 'faltan_datos' })).toBe('none');
    expect(sunatAccessFallback({ code: 'sin_acceso', attempts_left: 2 })).toBe('none');
  });

  it('un servidor antiguo sin contador sigue permitiendo reintentar', () => {
    expect(sunatAccessFallback({ code: 'respuesta_inesperada' })).toBe('retry');
  });
});

describe('sunatLoginPageUrl', () => {
  it('apunta al login del destino con sus parámetros', () => {
    const u = new URL(sunatLoginPageUrl('sunafil'));
    expect(u.host).toBe('api-seguridad.sunat.gob.pe');
    expect(u.pathname).toBe('/v1/clientessol/b6474e23-8a3b-4153-b301-dafcc9646250/oauth2/loginMenuSol');
    expect(u.searchParams.get('originalUrl')).toBe('https://casillaelectronica.sunafil.gob.pe/si.inbox/Login/Empresa');
    expect(u.searchParams.get('state')).toBe('s');
    expect(u.searchParams.get('lang')).toBe('es-PE');
  });
});
