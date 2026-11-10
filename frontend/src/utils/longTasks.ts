/**
 * Consultas largas a SUNAT (SIRE, RH, ITF, NPD, DAM, Buzón SOL). Tardan segundos o minutos, así que NO usan el modal
 * central de las alertas (bloquearía la pantalla): muestran un panel de progreso dentro de la página
 * (components/LongTaskPanel.tsx) y un indicador en la cabecera (components/TaskIndicator.tsx).
 *
 * Este registro sigue cada tarea aunque la persona cambie de pantalla (vive fuera de los componentes):
 *
 *   const task = startTask({ tool: 'rh', toolLabel: 'RH', companyId, companyName, detail: '…', href: `/tools/rh/${companyId}` });
 *   try { const r = await rheService.list(…); finishTask(task.id, { resultId: r.history_id }); }
 *   catch (e) { failTask(task.id, e); }
 *
 * Para consultas que el servidor ya hace en segundo plano (SIRE, DAM) use `trackAsync`: el propio registro las sondea.
 *
 * Aviso al terminar: si la persona sigue en la pantalla de la consulta, el resultado aparece ahí y además sale una alerta
 * central («Consulta lista» se cierra sola; un error pide aceptar).
 * Si está en otra pantalla: los errores y los éxitos que tardaron más de LONG_SUCCESS_MS abren una alerta central con
 * «Ver»; los demás éxitos solo cambian el indicador de la cabecera.
 */
import { notify } from './notify';

export type LongTaskStatus = 'running' | 'done' | 'error';

export interface LongTask {
  id: number;
  /** Una consulta por herramienta y empresa a la vez: `rh:42`. */
  key: string;
  tool: string;
  toolLabel: string;
  companyId: number;
  companyName: string;
  /** Qué se consulta («Recibidos · 10/05/2026 – 09/11/2026»). */
  detail?: string;
  /** Pantalla donde se ve el resultado. */
  href: string;
  startedAt: number;
  finishedAt?: number;
  status: LongTaskStatus;
  errorMessage?: string;
  /** Id de la consulta guardada en el historial del servidor, si la hay. */
  resultId?: number;
  /** Resumen corto del resultado para el aviso («3 comprobantes»). */
  summary?: string;
  /** La persona ya vio el resultado (estaba en la pantalla o pulsó «Ver»). */
  seen: boolean;
}

export interface TaskMeta {
  tool: string;
  toolLabel: string;
  companyId: number;
  companyName: string;
  detail?: string;
  href: string;
  /** Si la consulta ya venía en curso (la inició otra pantalla o sesión), desde cuándo. */
  startedAt?: number;
}

/** Pasado este tiempo sin terminar, el panel avisa que SUNAT está tardando más de lo normal. */
export const SLOW_MS = 45_000;
/** Un éxito que tardó al menos esto, y termina con la persona en otra pantalla, abre una alerta central. */
export const LONG_SUCCESS_MS = 120_000;
/** Cada cuánto se sondean las tareas que el servidor hace en segundo plano. */
export const POLL_MS = 5_000;
const MAX_TASKS = 20;

export const taskKey = (tool: string, companyId: number): string => `${tool}:${companyId}`;

let seq = 0;
let tasks: LongTask[] = [];
const listeners = new Set<() => void>();
const pollers = new Map<number, ReturnType<typeof setInterval>>();
let goTo: ((to: string) => void) | null = null;

function emit(next: LongTask[]) {
  tasks = next;
  listeners.forEach((l) => l());
}

export const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getTasks = (): LongTask[] => tasks;

/** El Layout registra aquí la navegación de la aplicación para que «Ver» no recargue la página. */
export function registerNavigator(fn: ((to: string) => void) | null): void {
  goTo = fn;
}

/**
 * ¿La persona está mirando la pantalla de esa consulta ahora mismo? Compara la ruta y, si la pantalla tiene pestañas
 * (`?tab=`), también la pestaña: dos consultas de la misma ruta pueden ser de pestañas distintas.
 */
export function isOnTaskPage(task: Pick<LongTask, 'href'>): boolean {
  if (typeof window === 'undefined') return false;
  const [targetPath, targetQuery = ''] = task.href.split('#')[0].split('?');
  const here = window.location.pathname.replace(/\/+$/, '');
  const target = targetPath.replace(/\/+$/, '');
  if (!(here === target || here.startsWith(target + '/'))) return false;
  const tabOf = (q: string) => new URLSearchParams(q).get('tab') ?? '';
  return tabOf(window.location.search ?? '') === tabOf(targetQuery);
}

export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return 'SUNAT no respondió. Intente de nuevo.';
}

function patch(id: number, p: Partial<LongTask>) {
  emit(tasks.map((t) => (t.id === id ? { ...t, ...p } : t)));
}

/** Inicia el seguimiento. Si ya hay una consulta en curso de la misma herramienta y empresa, devuelve esa. */
export function startTask(meta: TaskMeta): LongTask {
  const key = taskKey(meta.tool, meta.companyId);
  const running = tasks.find((t) => t.key === key && t.status === 'running');
  if (running) return running;
  const task: LongTask = { ...meta, id: ++seq, key, startedAt: meta.startedAt ?? Date.now(), status: 'running', seen: false };
  // Las terminadas de la misma consulta se reemplazan por la nueva.
  emit([task, ...tasks.filter((t) => t.key !== key)].slice(0, MAX_TASKS));
  return task;
}

function stopPoller(id: number) {
  const p = pollers.get(id);
  if (p) clearInterval(p);
  pollers.delete(id);
}

function announce(task: LongTask) {
  const who = `${task.toolLabel} de ${task.companyName}`;
  if (isOnTaskPage(task)) {
    // En la misma pantalla el resultado ya aparece en la página; además se confirma con la alerta central (se cierra sola).
    if (task.status === 'error') void notify.error('No se pudo completar la consulta', task.errorMessage ?? 'SUNAT no respondió.');
    else void notify.success('Consulta lista', task.summary ?? who);
    return;
  }
  if (task.status === 'error') {
    void notify
      .confirm({ icon: 'error', title: 'No se pudo completar la consulta', message: `${who}: ${task.errorMessage ?? 'SUNAT no respondió.'}`, confirmLabel: 'Ver detalle', cancelLabel: 'Cerrar' })
      .then((ok) => {
        if (ok) viewTask(task.id);
      });
    return;
  }
  if ((task.finishedAt ?? 0) - task.startedAt >= LONG_SUCCESS_MS) {
    void notify
      .confirm({ icon: 'success', title: 'Consulta lista', message: `${who}${task.summary ? `: ${task.summary}` : ''}. Quedó guardada en el historial.`, confirmLabel: 'Ver resultado', cancelLabel: 'Cerrar' })
      .then((ok) => {
        if (ok) viewTask(task.id);
      });
  }
}

export function finishTask(id: number, result: { resultId?: number; summary?: string } = {}): void {
  const t = tasks.find((x) => x.id === id);
  if (!t || t.status !== 'running') return;
  stopPoller(id);
  const done: LongTask = { ...t, status: 'done', finishedAt: Date.now(), resultId: result.resultId, summary: result.summary, seen: isOnTaskPage(t) };
  emit(tasks.map((x) => (x.id === id ? done : x)));
  announce(done);
}

export function failTask(id: number, error: unknown): void {
  const t = tasks.find((x) => x.id === id);
  if (!t || t.status !== 'running') return;
  stopPoller(id);
  const failed: LongTask = { ...t, status: 'error', finishedAt: Date.now(), errorMessage: errorText(error), seen: isOnTaskPage(t) };
  emit(tasks.map((x) => (x.id === id ? failed : x)));
  announce(failed);
}

export interface AsyncCheck {
  status: LongTaskStatus;
  message?: string;
  resultId?: number;
  summary?: string;
}

/**
 * Sigue una tarea que el servidor hace en segundo plano (SIRE, DAM): el propio registro pregunta cada `intervalMs`,
 * aunque la persona ya haya salido de la pantalla.
 */
export function trackAsync(meta: TaskMeta, check: () => Promise<AsyncCheck>, intervalMs = POLL_MS): LongTask {
  const task = startTask(meta);
  if (pollers.has(task.id)) return task;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await check();
      if (r.status === 'done') finishTask(task.id, { resultId: r.resultId, summary: r.summary });
      else if (r.status === 'error') failTask(task.id, r.message);
    } catch {
      /* un fallo de red al sondear no termina la tarea: se reintenta en el siguiente ciclo */
    } finally {
      busy = false;
    }
  };
  pollers.set(task.id, setInterval(() => void tick(), intervalMs));
  return task;
}

export function markSeen(id: number): void {
  const t = tasks.find((x) => x.id === id);
  if (t && !t.seen) patch(id, { seen: true });
}

/** Quita una tarea de la lista (si seguía en curso, deja de seguirla). */
export function dismissTask(id: number): void {
  stopPoller(id);
  emit(tasks.filter((t) => t.id !== id));
}

export function clearFinished(): void {
  emit(tasks.filter((t) => t.status === 'running'));
}

/** Va a la pantalla de la consulta y la da por vista. */
export function viewTask(id: number): void {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  markSeen(id);
  if (goTo) goTo(t.href);
  else if (typeof window !== 'undefined') window.location.assign(t.href);
}

export const taskFor = (key: string): LongTask | undefined => tasks.find((t) => t.key === key);
export const countByStatus = (list: LongTask[] = tasks) => ({
  running: list.filter((t) => t.status === 'running').length,
  done: list.filter((t) => t.status === 'done' && !t.seen).length,
  error: list.filter((t) => t.status === 'error' && !t.seen).length,
});

/** Solo para pruebas. */
export function __resetLongTasksForTests(): void {
  pollers.forEach((p) => clearInterval(p));
  pollers.clear();
  tasks = [];
  listeners.clear();
  goTo = null;
  seq = 0;
}
