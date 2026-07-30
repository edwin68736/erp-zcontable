import { useSyncExternalStore, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
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

type CanProps = {
  /** Requiere este permiso. */
  permission?: string;
  /** Requiere al menos uno de estos. */
  anyOf?: string[];
  /** Requiere todos estos. */
  allOf?: string[];
  /** Qué renderizar si no cumple (por defecto nada). */
  fallback?: ReactNode;
  children: ReactNode;
};

/**
 * Muestra `children` solo si se cumplen los permisos; si no, `fallback`.
 * Reemplaza el gating manual de acciones en las vistas:
 *   <Can permission={P.supervisorsLiquidationsUpdate}><button/></Can>
 */
export function Can({ permission, anyOf, allOf, fallback = null, children }: CanProps): ReactNode {
  usePermissionsVersion();
  let ok = true;
  if (permission) ok = ok && auth.hasPermission(permission);
  if (anyOf && anyOf.length > 0) ok = ok && auth.hasAnyPermission(...anyOf);
  if (allOf && allOf.length > 0) ok = ok && auth.hasAllPermissions(...allOf);
  return <>{ok ? children : fallback}</>;
}

type RequirePermissionProps = {
  permission?: string;
  anyOf?: string[];
  /** A dónde redirigir si no cumple (por defecto Inicio, que no requiere permisos). */
  redirectTo?: string;
  children: ReactNode;
};

/**
 * Guarda de RUTA: bloquea el acceso a una página si falta el permiso, redirigiendo
 * a un destino seguro. Defensa en profundidad además del gating de menú y del backend.
 * Durante la carga inicial de permisos no bloquea (evita rebotes; el backend igual valida).
 */
export function RequirePermission({
  permission,
  anyOf,
  redirectTo = '/',
  children,
}: RequirePermissionProps): ReactNode {
  usePermissionsVersion();
  const loaded = auth.getPermissionCodes().length > 0;
  let ok = true;
  if (loaded) {
    if (permission) ok = auth.hasPermission(permission);
    else if (anyOf && anyOf.length > 0) ok = auth.hasAnyPermission(...anyOf);
  }
  if (!ok) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
