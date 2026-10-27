import { P } from '../rbac/codes';
import { auth } from '../services/auth';

/**
 * Qué filtros de los listados de actividades ve el usuario: el administrador, supervisor y asistente; el
 * supervisor, solo asistente; el asistente (que solo tiene sus empresas), ninguno.
 */
export function ownerFilterAccess(): { supervisor: boolean; assistant: boolean } {
  const isAdmin = auth.hasPermission(P.accessStudio);
  const isSupervisor = !isAdmin && auth.hasPermission(P.supervisorsReportsView);
  return { supervisor: isAdmin, assistant: isAdmin || isSupervisor };
}
