/**
 * Actividad real de la persona (mouse, teclado, toque, scroll). Sirve para dos cosas:
 *  - las peticiones llevan la cabecera X-Client-Active mientras hubo uso reciente: el servidor solo renueva la
 *    inactividad de la sesión con eso (lo que la pantalla hace sola —notificaciones, etc.— no la mantiene viva);
 *  - cerrar la sesión en pantalla tras 30 minutos sin tocar nada (con aviso antes).
 */

/** Clave donde se deja el aviso que el login muestra cuando la sesión se cerró sola. */
export const LOGIN_NOTICE_KEY = 'login_notice';

/** Cuánto tiempo sin actividad cierra la sesión (el mismo valor que usa el servidor). */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;
/** Aviso previo al cierre. */
export const IDLE_WARNING_MS = 2 * 60 * 1000;
/** Una petición cuenta como «actividad» si la persona hizo algo en los últimos 2 minutos. */
export const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

/** Cada cuánto, mientras la persona usa el sistema, se avisa al servidor aunque la pantalla no haya hecho peticiones. */
export const HEARTBEAT_MS = 4 * 60 * 1000;

let lastActivity = Date.now();
let started = false;
const listeners = new Set<() => void>();

// La actividad se comparte entre las pestañas del mismo navegador y usuario (localStorage): quien trabaja en una
// pestaña no debe perder la sesión porque OTRA pestaña abierta (con la misma sesión) lleva rato sin tocarse.
const SHARED_KEY = 'zc_last_activity';
const SHARED_WRITE_EVERY_MS = 5000;
let lastSharedWrite = 0;

function sharedKey(): string {
  try {
    const u = JSON.parse(window.sessionStorage.getItem('user') ?? 'null') as { id?: number } | null;
    return `${SHARED_KEY}:${u?.id ?? 'anon'}`;
  } catch {
    return `${SHARED_KEY}:anon`;
  }
}

function readShared(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const v = Number(window.localStorage.getItem(sharedKey()));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function writeShared(at: number, force = false): void {
  if (typeof window === 'undefined') return;
  if (!force && at - lastSharedWrite < SHARED_WRITE_EVERY_MS) return;
  lastSharedWrite = at;
  try {
    window.localStorage.setItem(sharedKey(), String(at));
  } catch {
    /* sin almacenamiento: queda la actividad de esta pestaña */
  }
}

const EVENTS: (keyof WindowEventMap)[] = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel', 'click'];

function mark(force = false) {
  lastActivity = Date.now();
  writeShared(lastActivity, force);
  listeners.forEach((l) => l());
}

/** Empieza a escuchar la actividad (una sola vez; no hace nada fuera del navegador). */
export function startActivityTracking(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  let last = 0;
  const throttled = () => {
    const now = Date.now();
    if (now - last < 1000) return; // un registro por segundo es suficiente
    last = now;
    mark();
  };
  EVENTS.forEach((e) => window.addEventListener(e, throttled, { passive: true, capture: true }));
}

/** Registra actividad a mano (por ejemplo, al pulsar «Seguir conectado»). */
export function markActivity(): void {
  mark(true);
}

/** Última actividad de la persona en cualquiera de sus pestañas. */
export const lastActivityAt = (): number => Math.max(lastActivity, readShared());

export const msSinceActivity = (now = Date.now()): number => now - lastActivityAt();

/** ¿La persona está usando el sistema ahora? */
export const isUserActive = (now = Date.now()): boolean => msSinceActivity(now) < ACTIVE_WINDOW_MS;

/** Se llama cada vez que hay actividad (para reiniciar el aviso de inactividad). */
export function onActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Estado del cierre por inactividad según cuánto tiempo pasó: «ok», «warning» (a punto de cerrarse) o «expired». */
export function idleState(elapsedMs: number): 'ok' | 'warning' | 'expired' {
  if (elapsedMs >= IDLE_LIMIT_MS) return 'expired';
  if (elapsedMs >= IDLE_LIMIT_MS - IDLE_WARNING_MS) return 'warning';
  return 'ok';
}

/** Segundos que faltan para el cierre. */
export const secondsToIdleLogout = (elapsedMs: number): number => Math.max(0, Math.ceil((IDLE_LIMIT_MS - elapsedMs) / 1000));
