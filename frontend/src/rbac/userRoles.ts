import type { User } from '../types/dashboard';
import { P } from './codes';

function permSet(u: User | undefined): Set<string> {
  return new Set(u?.permission_codes ?? []);
}

/** Comprueba permisos efectivos del usuario (viene de API en listados con permission_codes). */
export function userHasAnyPermissionCode(u: User | undefined, ...codes: string[]): boolean {
  const s = permSet(u);
  return codes.some((c) => c && s.has(c));
}

/** Puede figurar como contador en equipo de empresa (plantilla import / formularios). */
export function userIsTeamAccountantOrAdmin(u: User): boolean {
  return userHasAnyPermissionCode(u, P.companiesAssignAccountant, P.accessStudio);
}

export function userIsTeamAssistantOrAdmin(u: User): boolean {
  return userHasAnyPermissionCode(u, P.companiesAssignAssistant, P.accessStudio);
}

export function userIsTeamSupervisorOrAdmin(u: User): boolean {
  return userHasAnyPermissionCode(u, P.companiesAssignSupervisor, P.accessStudio);
}

export function formatUserRolesDisplay(u: User): string {
  const names = (u.roles ?? []).map((r) => r.name).sort();
  return names.length ? names.join(', ') : '—';
}
