import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INFO_MS,
  SUCCESS_MS,
  __resetNotifyForTests,
  close,
  getState,
  notify,
  notifyFromMessage,
  pause,
  registerNotifyHost,
  resume,
  showLegacyToast,
} from './notify';

beforeEach(() => {
  __resetNotifyForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sin componente de dibujo (respaldo)', () => {
  it('los errores y advertencias se ven con alert; el éxito no hace ruido', async () => {
    const alert = vi.fn();
    vi.stubGlobal('window', { alert, confirm: vi.fn(() => true) });
    await notify.error('No se pudo guardar', 'Intente de nuevo.');
    expect(alert).toHaveBeenCalledWith('No se pudo guardar\n\nIntente de nuevo.');
    await notify.success('Guardado');
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('confirm cae al del navegador; sin navegador responde que no', async () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    expect(await notify.confirm({ message: '¿Seguro?' })).toBe(true);
    vi.unstubAllGlobals();
    expect(await notify.confirm({ message: '¿Seguro?' })).toBe(false);
  });
});

describe('con componente de dibujo', () => {
  beforeEach(() => {
    registerNotifyHost();
  });

  it('el éxito se muestra y se cierra solo', async () => {
    const done = vi.fn();
    void notify.success('Usuario guardado').then(done);
    expect(getState().current).toMatchObject({ kind: 'success', title: 'Usuario guardado', autoCloseMs: SUCCESS_MS });
    vi.advanceTimersByTime(SUCCESS_MS - 1);
    expect(getState().current).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(getState().current).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalled();
  });

  it('un éxito nuevo reemplaza al que se está mostrando', () => {
    void notify.success('Uno');
    void notify.success('Dos');
    expect(getState().current?.title).toBe('Dos');
    expect(getState().queue).toHaveLength(0);
    vi.advanceTimersByTime(SUCCESS_MS + 1);
    expect(getState().current).toBeNull();
  });

  it('los errores esperan su turno y no se cierran solos', () => {
    void notify.error('Primero');
    void notify.error('Segundo', 'detalle');
    expect(getState().current?.title).toBe('Primero');
    expect(getState().queue.map((q) => q.title)).toEqual(['Segundo']);
    vi.advanceTimersByTime(60_000);
    expect(getState().current?.title).toBe('Primero');
    close(true);
    expect(getState().current?.title).toBe('Segundo');
    expect(getState().current?.text).toBe('detalle');
    close(true);
    expect(getState().current).toBeNull();
  });

  it('un aviso idéntico al último no se repite', () => {
    void notify.error('Igual', 'mismo texto');
    void notify.error('Igual', 'mismo texto');
    expect(getState().queue).toHaveLength(0);
  });

  it('un éxito que llega con un error abierto espera detrás', () => {
    void notify.error('Falló algo');
    void notify.success('Pero esto sí');
    expect(getState().current?.kind).toBe('error');
    expect(getState().queue[0]?.kind).toBe('success');
    close(true);
    expect(getState().current).toMatchObject({ kind: 'success', title: 'Pero esto sí' });
  });

  it('confirm devuelve true al confirmar y false al cancelar', async () => {
    const yes = notify.confirm({ message: '¿Eliminar?', danger: true });
    expect(getState().current).toMatchObject({ kind: 'question', danger: true, confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', text: '¿Eliminar?' });
    close(true);
    expect(await yes).toBe(true);
    const no = notify.confirm({ message: '¿Seguro?' });
    expect(getState().current?.confirmLabel).toBe('Confirmar');
    close(false);
    expect(await no).toBe(false);
  });

  it('las confirmaciones iguales no se fusionan (cada una espera su respuesta)', async () => {
    const a = notify.confirm({ message: '¿Seguro?' });
    const b = notify.confirm({ message: '¿Seguro?' });
    expect(getState().queue).toHaveLength(1);
    close(true);
    close(false);
    expect(await a).toBe(true);
    expect(await b).toBe(false);
  });

  it('el temporizador se pausa y se reanuda', () => {
    void notify.success('Guardado');
    vi.advanceTimersByTime(1000);
    pause();
    expect(getState().paused).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(getState().current).not.toBeNull();
    resume();
    expect(getState().paused).toBe(false);
    vi.advanceTimersByTime(1300);
    expect(getState().current).toBeNull();
  });

  it('la información dura más que el éxito', () => {
    void notify.info('Aviso');
    expect(getState().current?.autoCloseMs).toBe(INFO_MS);
  });

  it('«cargando» queda hasta que se cierra, y su cierre deja pasar a la siguiente alerta', () => {
    const l = notify.loading('Consultando SUNAT…');
    expect(getState().current?.kind).toBe('loading');
    void notify.error('Falló');
    vi.advanceTimersByTime(60_000);
    expect(getState().current?.kind).toBe('loading');
    l.close();
    expect(getState().current?.title).toBe('Falló');
    l.close(); // cerrar dos veces no rompe nada
    expect(getState().current?.title).toBe('Falló');
  });

  it('un «cargando» que todavía espera turno se retira de la cola al cerrarlo', () => {
    void notify.error('Abierto');
    const l = notify.loading('En cola');
    expect(getState().queue).toHaveLength(1);
    l.close();
    expect(getState().queue).toHaveLength(0);
  });
});

describe('avisos antiguos (miweb:toast)', () => {
  it('una frase corta es el título, sin el punto final', () => {
    expect(notifyFromMessage('success', 'Rol creado.')).toEqual({ title: 'Rol creado' });
    expect(notifyFromMessage('info', 'Estado actualizado')).toEqual({ title: 'Estado actualizado' });
  });

  it('una frase larga queda como texto bajo un título genérico', () => {
    const long = 'Se registró el pago por el total del comprobante y se aplicó a las deudas pendientes de la empresa.';
    expect(notifyFromMessage('success', long)).toEqual({ title: 'Listo', text: long });
    expect(notifyFromMessage('info', long)).toEqual({ title: 'Aviso', text: long });
  });

  it('los errores llevan el mensaje como texto, salvo «No se pudo…» corto', () => {
    expect(notifyFromMessage('error', 'La contraseña no es correcta')).toEqual({ title: 'No se pudo completar', text: 'La contraseña no es correcta' });
    expect(notifyFromMessage('error', 'No se pudo guardar.')).toEqual({ title: 'No se pudo guardar' });
  });

  it('showLegacyToast lo muestra con el tipo correcto y descarta los vacíos', () => {
    registerNotifyHost();
    showLegacyToast({ type: 'success', message: 'Empresa creada.' });
    expect(getState().current).toMatchObject({ kind: 'success', title: 'Empresa creada' });
    close(true);
    showLegacyToast({ type: 'error', message: 'Algo falló' });
    expect(getState().current).toMatchObject({ kind: 'error', title: 'No se pudo completar', text: 'Algo falló' });
    close(true);
    showLegacyToast({ type: 'success', message: '   ' });
    showLegacyToast(undefined);
    expect(getState().current).toBeNull();
  });
});
