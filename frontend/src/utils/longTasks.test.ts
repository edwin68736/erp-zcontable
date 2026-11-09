import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetNotifyForTests, close, getState, registerNotifyHost } from './notify';
import {
  LONG_SUCCESS_MS,
  POLL_MS,
  __resetLongTasksForTests,
  clearFinished,
  countByStatus,
  dismissTask,
  failTask,
  finishTask,
  getTasks,
  registerNavigator,
  startTask,
  taskFor,
  taskKey,
  trackAsync,
  viewTask,
  type TaskMeta,
} from './longTasks';

const meta = (over: Partial<TaskMeta> = {}): TaskMeta => ({
  tool: 'rh',
  toolLabel: 'RH',
  companyId: 7,
  companyName: 'A&V GRUPO SERGEN',
  detail: 'Recibidos · 10/05 – 09/11',
  href: '/tools/rh/7',
  ...over,
});

/** Simula en qué pantalla está la persona. */
const at = (pathname: string) => vi.stubGlobal('window', { location: { pathname } });

beforeEach(() => {
  __resetLongTasksForTests();
  __resetNotifyForTests();
  registerNotifyHost();
  vi.useFakeTimers();
  at('/tools/rh/7');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('seguimiento de tareas', () => {
  it('una consulta nueva queda en curso, con su clave y hora de inicio', () => {
    const t = startTask(meta());
    expect(t).toMatchObject({ status: 'running', key: taskKey('rh', 7), seen: false });
    expect(taskFor('rh:7')?.id).toBe(t.id);
    expect(countByStatus()).toEqual({ running: 1, done: 0, error: 0 });
  });

  it('no se duplica una consulta en curso de la misma herramienta y empresa', () => {
    const a = startTask(meta());
    const b = startTask(meta());
    expect(b.id).toBe(a.id);
    expect(getTasks()).toHaveLength(1);
    // Otra empresa u otra herramienta sí es otra tarea.
    startTask(meta({ companyId: 8, href: '/tools/rh/8' }));
    startTask(meta({ tool: 'itf', toolLabel: 'ITF', href: '/tools/consulta-itf/7' }));
    expect(getTasks()).toHaveLength(3);
  });

  it('una consulta nueva reemplaza a la terminada de la misma clave', () => {
    const a = startTask(meta());
    finishTask(a.id);
    const b = startTask(meta());
    expect(b.id).not.toBe(a.id);
    expect(getTasks().filter((t) => t.key === 'rh:7')).toHaveLength(1);
  });

  it('terminar guarda el resultado y la hora; terminar dos veces no cambia nada', () => {
    const t = startTask(meta());
    finishTask(t.id, { resultId: 99 });
    const done = taskFor('rh:7')!;
    expect(done).toMatchObject({ status: 'done', resultId: 99 });
    expect(done.finishedAt).toBeGreaterThanOrEqual(done.startedAt);
    failTask(t.id, 'tarde');
    expect(taskFor('rh:7')?.status).toBe('done');
  });

  it('fallar guarda el mensaje del error (texto, objeto con message o genérico)', () => {
    const a = startTask(meta());
    failTask(a.id, { message: 'SUNAT no respondió a tiempo', code: 'timeout' });
    expect(taskFor('rh:7')).toMatchObject({ status: 'error', errorMessage: 'SUNAT no respondió a tiempo' });
    const b = startTask(meta({ companyId: 9, href: '/tools/rh/9' }));
    failTask(b.id, new Error());
    expect(taskFor('rh:9')?.errorMessage).toMatch(/SUNAT no respondió/);
  });

  it('quitar y limpiar', () => {
    const a = startTask(meta());
    const b = startTask(meta({ companyId: 8, href: '/tools/rh/8' }));
    finishTask(a.id);
    clearFinished();
    expect(getTasks().map((t) => t.id)).toEqual([b.id]);
    dismissTask(b.id);
    expect(getTasks()).toEqual([]);
  });
});

describe('aviso al terminar', () => {
  it('con la persona en la pantalla de la consulta: queda vista y no se abre ninguna alerta', () => {
    const t = startTask(meta());
    finishTask(t.id);
    expect(taskFor('rh:7')?.seen).toBe(true);
    expect(getState().current).toBeNull();
    const e = startTask(meta({ companyId: 8, href: '/tools/rh/8' }));
    at('/tools/rh/8/');
    failTask(e.id, 'x');
    expect(getState().current).toBeNull();
  });

  it('en otra pantalla, un éxito corto solo cambia el indicador', () => {
    const t = startTask(meta());
    at('/dashboard');
    vi.advanceTimersByTime(30_000);
    finishTask(t.id);
    expect(taskFor('rh:7')?.seen).toBe(false);
    expect(countByStatus().done).toBe(1);
    expect(getState().current).toBeNull();
  });

  it('en otra pantalla, un éxito largo abre una alerta con «Ver resultado»', () => {
    const go = vi.fn();
    registerNavigator(go);
    const t = startTask(meta());
    at('/dashboard');
    vi.advanceTimersByTime(LONG_SUCCESS_MS + 1000);
    finishTask(t.id);
    expect(getState().current).toMatchObject({ kind: 'question', icon: 'success', title: 'Consulta lista', confirmLabel: 'Ver resultado' });
    expect(getState().current?.text).toContain('RH de A&V GRUPO SERGEN');
    close(true);
    return Promise.resolve().then(() => {
      expect(go).toHaveBeenCalledWith('/tools/rh/7');
      expect(taskFor('rh:7')?.seen).toBe(true);
    });
  });

  it('en otra pantalla, un error siempre abre una alerta; «Cerrar» no navega', async () => {
    const go = vi.fn();
    registerNavigator(go);
    const t = startTask(meta());
    at('/dashboard');
    failTask(t.id, 'El rango es demasiado grande');
    expect(getState().current).toMatchObject({ kind: 'question', icon: 'error', title: 'No se pudo completar la consulta', confirmLabel: 'Ver detalle' });
    expect(getState().current?.text).toContain('El rango es demasiado grande');
    close(false);
    await Promise.resolve();
    expect(go).not.toHaveBeenCalled();
    expect(taskFor('rh:7')?.seen).toBe(false);
  });

  it('viewTask sin navegador registrado recarga hacia la pantalla de la consulta', () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/x', assign } });
    const t = startTask(meta());
    viewTask(t.id);
    expect(assign).toHaveBeenCalledWith('/tools/rh/7');
  });
});

describe('tareas que el servidor hace en segundo plano (trackAsync)', () => {
  it('sondea hasta que termina y entonces la cierra con su resultado', async () => {
    const answers = [{ status: 'running' as const }, { status: 'running' as const }, { status: 'done' as const, resultId: 5 }];
    const check = vi.fn(() => Promise.resolve(answers.shift()!));
    trackAsync(meta({ tool: 'dam', toolLabel: 'DAM', href: '/tools/dam/7' }), check);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(taskFor('dam:7')?.status).toBe('running');
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(taskFor('dam:7')).toMatchObject({ status: 'done', resultId: 5 });
    expect(check).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(check).toHaveBeenCalledTimes(3); // ya no sondea
  });

  it('un fallo de red al sondear no termina la tarea', async () => {
    let n = 0;
    const check = vi.fn(() => (++n < 3 ? Promise.reject(new Error('red')) : Promise.resolve({ status: 'done' as const })));
    trackAsync(meta({ tool: 'dam', toolLabel: 'DAM', href: '/tools/dam/7' }), check);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(taskFor('dam:7')?.status).toBe('done');
  });

  it('un error del servidor la marca con su mensaje, aunque la persona ya haya salido', async () => {
    at('/dashboard');
    trackAsync(meta({ tool: 'sire', toolLabel: 'SIRE', href: '/tools/sire/7' }), () => Promise.resolve({ status: 'error', message: 'SUNAT rechazó las credenciales' }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(taskFor('sire:7')).toMatchObject({ status: 'error', errorMessage: 'SUNAT rechazó las credenciales' });
    expect(getState().current?.title).toBe('No se pudo completar la consulta');
  });

  it('quitar la tarea detiene el sondeo', async () => {
    const check = vi.fn(() => Promise.resolve({ status: 'running' as const }));
    const t = trackAsync(meta({ tool: 'dam', toolLabel: 'DAM', href: '/tools/dam/7' }), check);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    dismissTask(t.id);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
