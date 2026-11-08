import { useSyncExternalStore } from 'react';
import { auth } from '../services/auth';

// ─────────────────────────────────────────────────────────────────────────────
// Primitivas de permisos para la UI. A diferencia del patrón anterior
// (`useMemo(() => auth.hasPermission(P.x), [])`, capturado al montar), estas
// primitivas son REACTIVAS: se re-evalúan cuando `auth.refreshPermissions()`
// emite `miweb:permissions-updated` (login, cambio de rol, etc.).
// ─────────────────────────────────────────────────────────────────────────────

const PERMISSIONS_EVENT = 'miweb:permissions-updated';

function readSnapshot(): string {
  try {
    return auth.getPermissionCodes().join('');
  } catch {
    return '';
  }
}

// Store externo cacheado: getSnapshot devuelve una referencia estable hasta que
// llega el evento, evitando parsear sessionStorage en cada render.
let cachedSnapshot = readSnapshot();
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener(PERMISSIONS_EVENT, () => {
    cachedSnapshot = readSnapshot();
    listeners.forEach((l) => l());
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string {
  return cachedSnapshot;
}

/** Suscribe el componente a cambios de permisos (devuelve un token de versión). */
export function usePermissionsVersion(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** true si el usuario tiene el permiso indicado (reactivo). Sin código → true. */
export function usePermission(code?: string): boolean {
  usePermissionsVersion();
  return code ? auth.hasPermission(code) : true;
}

/** true si tiene AL MENOS uno de los permisos (reactivo). Lista vacía → true. */
export function useAnyPermission(...codes: string[]): boolean {
  usePermissionsVersion();
  return codes.length === 0 || auth.hasAnyPermission(...codes);
}

/** true si tiene TODOS los permisos (reactivo). */
export function useAllPermissions(...codes: string[]): boolean {
  usePermissionsVersion();
  return auth.hasAllPermissions(...codes);
}
