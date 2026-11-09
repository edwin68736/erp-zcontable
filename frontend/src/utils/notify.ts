/**
 * Retroalimentación tras una acción: alertas centradas (éxito, error, advertencia, información, confirmación y
 * «cargando»). Una sola a la vez: las demás esperan su turno. El dibujo vive en components/NotifyHost.tsx; aquí solo
 * hay la cola, los temporizadores y la API para el resto del código:
 *
 *   await notify.success('Usuario guardado');                    // se cierra solo (≈2 s)
 *   await notify.error('No se pudo guardar', 'Revise su conexión.'); // pide aceptar
 *   if (await notify.confirm({ message: '¿Eliminar?', danger: true })) …
 *   const l = notify.loading('Consultando SUNAT…'); try { … } finally { l.close(); }
 *
 * Los avisos antiguos (`window.dispatchEvent(new CustomEvent('miweb:toast', …))`) siguen funcionando: el Layout los
 * convierte con `notifyFromMessage`.
 */

export type NotifyKind = 'success' | 'error' | 'warning' | 'info' | 'question' | 'loading';

export interface NotifyItem {
  id: number;
  kind: NotifyKind;
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva (confirmación): el botón de confirmar va en rojo y el foco empieza en «Cancelar». */
  danger?: boolean;
  /** Icono que se dibuja si no es el de la clase de alerta (p. ej. una pregunta con check de «consulta lista»). */
  icon?: NotifyKind;
  /** Se cierra solo pasados estos milisegundos (solo éxito e información). */
  autoCloseMs?: number;
}

export interface NotifyState {
  current: NotifyItem | null;
  queue: NotifyItem[];
  /** El temporizador está en pausa (el puntero está encima de la alerta). */
  paused: boolean;
}

export interface ConfirmOptions {
  /** Texto principal. Admite saltos de línea (\n\n separa párrafos). */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Icono de la alerta (por defecto, el signo de interrogación). */
  icon?: Exclude<NotifyKind, 'loading' | 'question'>;
}

/** Cuánto dura un aviso de éxito antes de cerrarse solo. */
export const SUCCESS_MS = 2200;
export const INFO_MS = 3500;

type Entry = { item: NotifyItem; resolve: (ok: boolean) => void };

let seq = 0;
let state: NotifyState = { current: null, queue: [], paused: false };
let currentResolve: ((ok: boolean) => void) | null = null;
const waiting = new Map<number, (ok: boolean) => void>();
const listeners = new Set<() => void>();
let hosts = 0;

let timer: ReturnType<typeof setTimeout> | null = null;
let timerEndsAt = 0;
let remaining = 0;

function emit() {
  listeners.forEach((l) => l());
}

function set(next: NotifyState) {
  state = next;
  emit();
}

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function startTimer(ms: number) {
  stopTimer();
  remaining = ms;
  timerEndsAt = Date.now() + ms;
  timer = setTimeout(() => close(true), ms);
}

function show(entry: Entry, queue: NotifyItem[] = state.queue) {
  currentResolve = entry.resolve;
  set({ current: entry.item, queue, paused: false });
  if (entry.item.autoCloseMs) startTimer(entry.item.autoCloseMs);
  else stopTimer();
}

function next() {
  const item = state.queue[0];
  if (!item) {
    currentResolve = null;
    set({ current: null, queue: [], paused: false });
    return;
  }
  const resolve = waiting.get(item.id) ?? (() => undefined);
  waiting.delete(item.id);
  show({ item, resolve }, state.queue.slice(1));
}

/** Cierra la alerta visible (ok = la persona confirmó / aceptó) y pasa a la siguiente. */
export function close(ok = false): void {
  stopTimer();
  const resolve = currentResolve;
  currentResolve = null;
  resolve?.(ok);
  next();
}

export function pause(): void {
  if (!state.current?.autoCloseMs || state.paused || !timer) return;
  remaining = Math.max(0, timerEndsAt - Date.now());
  stopTimer();
  set({ ...state, paused: true });
}

export function resume(): void {
  if (!state.paused) return;
  set({ ...state, paused: false });
  if (state.current?.autoCloseMs) startTimer(Math.max(400, remaining));
}

function enqueue(item: Omit<NotifyItem, 'id'>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const full: NotifyItem = { ...item, id: ++seq };
    const cur = state.current;
    // Un éxito nuevo reemplaza al éxito que se está mostrando (no se apilan 5 «Guardado» seguidos).
    if (full.kind === 'success' && cur?.kind === 'success') {
      const old = currentResolve;
      stopTimer();
      currentResolve = null;
      old?.(true);
      show({ item: full, resolve });
      return;
    }
    // Mismo aviso que el último pendiente: no se repite.
    const last = state.queue[state.queue.length - 1] ?? cur;
    if (last && last.kind === full.kind && last.title === full.title && last.text === full.text && full.kind !== 'question') {
      resolve(true);
      return;
    }
    if (!cur) {
      show({ item: full, resolve });
      return;
    }
    waiting.set(full.id, resolve);
    set({ ...state, queue: [...state.queue, full] });
  });
}

// ───────────────────────────── API ─────────────────────────────

/** Los componentes de dibujo se registran al montarse; sin ninguno se usa el navegador como respaldo. */
export function registerNotifyHost(): () => void {
  hosts += 1;
  return () => {
    hosts = Math.max(0, hosts - 1);
  };
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getState = (): NotifyState => state;

function browserFallback(kind: NotifyKind, title: string, text?: string): void {
  if ((kind === 'error' || kind === 'warning') && typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(text ? `${title}\n\n${text}` : title);
  }
}

function simple(kind: 'success' | 'error' | 'warning' | 'info', title: string, text?: string, confirmLabel?: string): Promise<void> {
  if (hosts === 0) {
    browserFallback(kind, title, text);
    return Promise.resolve();
  }
  const autoCloseMs = kind === 'success' ? SUCCESS_MS : kind === 'info' ? INFO_MS : undefined;
  return enqueue({ kind, title, text, confirmLabel, autoCloseMs }).then(() => undefined);
}

export const notify = {
  success: (title: string, text?: string) => simple('success', title, text),
  error: (title: string, text?: string, confirmLabel?: string) => simple('error', title, text, confirmLabel),
  warning: (title: string, text?: string, confirmLabel?: string) => simple('warning', title, text, confirmLabel),
  info: (title: string, text?: string) => simple('info', title, text),

  /** Pregunta antes de una acción. true si la persona confirma; false si cancela o cierra. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    if (hosts === 0) {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') return Promise.resolve(window.confirm(options.message));
      return Promise.resolve(false);
    }
    return enqueue({
      kind: 'question',
      title: options.title ?? (options.danger ? 'Confirme esta acción' : 'Confirmar'),
      text: options.message,
      confirmLabel: options.confirmLabel ?? (options.danger ? 'Eliminar' : 'Confirmar'),
      cancelLabel: options.cancelLabel ?? 'Cancelar',
      danger: options.danger,
      icon: options.icon,
    });
  },

  /** Mensaje de una sola frase con su tipo (para textos que llegan ya armados o del servidor). */
  fromMessage: (type: 'success' | 'error' | 'info', message: string): void => showLegacyToast({ type, message }),

  /** Muestra «cargando» sin botones hasta que se llame a `close()` (úselo en un `finally`). */
  loading(title: string, text?: string): { close: () => void } {
    if (hosts === 0) return { close: () => undefined };
    let closed = false;
    void enqueue({ kind: 'loading', title, text });
    const id = seq; // enqueue asigna el id de forma síncrona
    return {
      close: () => {
        if (closed) return;
        closed = true;
        if (state.current?.id === id) {
          close(true);
        } else {
          const had = state.queue.some((q) => q.id === id);
          if (had) {
            waiting.get(id)?.(true);
            waiting.delete(id);
            set({ ...state, queue: state.queue.filter((q) => q.id !== id) });
          }
        }
      },
    };
  },
};

// ───────────────────────────── Avisos antiguos ─────────────────────────────

const stripPeriod = (s: string) => s.replace(/[.\s]+$/, '');

/**
 * Convierte el mensaje de los avisos antiguos (una sola frase) en título y texto: una frase corta es el título; una
 * larga queda como texto bajo un título genérico.
 */
export function notifyFromMessage(type: 'success' | 'error' | 'info', message: string): { title: string; text?: string } {
  const msg = message.trim();
  if (type === 'error') {
    if (msg.length <= 42 && /^no se pudo/i.test(msg)) return { title: stripPeriod(msg) };
    return { title: 'No se pudo completar', text: msg };
  }
  const generic = type === 'success' ? 'Listo' : 'Aviso';
  if (msg.length <= 60) return { title: stripPeriod(msg) };
  return { title: generic, text: msg };
}

/** Atiende un aviso antiguo (evento `miweb:toast`). */
export function showLegacyToast(detail: { type?: string; message?: string } | undefined): void {
  const message = typeof detail?.message === 'string' ? detail.message.trim() : '';
  if (!message) return;
  const type = detail?.type === 'success' || detail?.type === 'error' ? detail.type : 'info';
  const { title, text } = notifyFromMessage(type, message);
  if (type === 'success') void notify.success(title, text);
  else if (type === 'error') void notify.error(title, text);
  else void notify.info(title, text);
}

/** Solo para pruebas: deja el módulo como recién cargado. */
export function __resetNotifyForTests(): void {
  stopTimer();
  state = { current: null, queue: [], paused: false };
  currentResolve = null;
  waiting.clear();
  listeners.clear();
  hosts = 0;
  seq = 0;
}
