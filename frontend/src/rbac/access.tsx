import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../services/auth';
import { usePermissionsVersion } from './hooks';

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
