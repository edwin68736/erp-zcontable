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

let lastActivity = Date.now();
let started = false;
const listeners = new Set<() => void>();

const EVENTS: (keyof WindowEventMap)[] = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel', 'click'];

function mark() {
  lastActivity = Date.now();
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
  mark();
}

export const msSinceActivity = (now = Date.now()): number => now - lastActivity;

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
