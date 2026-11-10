import { useEffect, useSyncExternalStore } from 'react';
import { sunatBuzonService, type BuzonUnreadSummary } from '../services/sunatBuzon';

/**
 * Notificaciones de SUNAT sin leer del usuario (las de sus empresas; el administrador, todas), compartidas por el aviso
 * flotante, la campana de la cabecera y la lista de empresas: una sola consulta cada pocos minutos aunque haya varios
 * lectores. Se actualiza también al volver a la pestaña y cuando una pantalla sincroniza el buzón (`emitBuzonUpdated`).
 */
export const BUZON_UPDATED_EVENT = 'miweb:buzon-updated';
const REFRESH_MS = 5 * 60 * 1000;

interface Snapshot {
  data: BuzonUnreadSummary | null;
  loading: boolean;
  error: boolean;
}

let snap: Snapshot = { data: null, loading: false, error: false };
const listeners = new Set<() => void>();
let timer: number | undefined;
let inflight = false;
/** Lectores activos (con permiso): la consulta periódica corre mientras haya al menos uno. */
let users = 0;

function set(next: Partial<Snapshot>) {
  snap = { ...snap, ...next };
  listeners.forEach((l) => l());
}

/** Vuelve a leer ahora (las pantallas lo piden tras sincronizar el buzón). */
export async function refreshBuzonUnread(): Promise<void> {
  if (inflight) return;
  inflight = true;
  if (!snap.data) set({ loading: true });
  try {
    set({ data: await sunatBuzonService.unread(), error: false });
  } catch {
    set({ error: true });
  } finally {
    inflight = false;
    set({ loading: false });
  }
}

/** Lo último leído (para pruebas y para quien no use el hook). */
export const getBuzonUnreadSnapshot = (): Snapshot => snap;

export const emitBuzonUpdated = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BUZON_UPDATED_EVENT));
};

function onVisible() {
  if (document.visibilityState === 'visible') void refreshBuzonUnread();
}
const onUpdated = () => void refreshBuzonUnread();

function start() {
  void refreshBuzonUnread();
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshBuzonUnread();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener(BUZON_UPDATED_EVENT, onUpdated);
}

function stop() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  if (typeof window !== 'undefined') window.removeEventListener(BUZON_UPDATED_EVENT, onUpdated);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Estado compartido; con `enabled` en falso no consulta (quien no tiene permiso sobre el buzón). */
export function useBuzonUnread(enabled: boolean): Snapshot {
  const s = useSyncExternalStore(subscribe, () => snap, () => snap);
  useEffect(() => {
    if (!enabled) return;
    users += 1;
    if (users === 1) start();
    return () => {
      users -= 1;
      if (users === 0) stop();
    };
  }, [enabled]);
  return s;
}

/** Solo para pruebas. */
export function __resetBuzonUnreadForTests(): void {
  stop();
  listeners.clear();
  snap = { data: null, loading: false, error: false };
  inflight = false;
  users = 0;
}
