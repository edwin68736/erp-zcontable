/** Rutas del módulo Control de Actividades (Supervisores / Asistente). */

export type ActivityWorkspace = 'supervisor' | 'assistant';

export const SUPERVISOR_ACTIVITIES_BASE = '/supervisors/activities';
export const ASSISTANT_ACTIVITIES_BASE = '/assistant/activities';
export const SUPERVISOR_COMPANIES = '/supervisors/companies';
export const ASSISTANT_COMPANIES = '/assistant/companies';

/** Rutas legacy — se mantienen como alias durante la migración. */
export const SUPERVISOR_CONTROLS_LEGACY = '/supervisors/controls';
export const ASSISTANT_CONTROLS_LEGACY = '/assistant/controls';

export function activitiesBasePath(workspace: ActivityWorkspace): string {
  return workspace === 'assistant' ? ASSISTANT_ACTIVITIES_BASE : SUPERVISOR_ACTIVITIES_BASE;
}

export function companiesBasePath(workspace: ActivityWorkspace): string {
  return workspace === 'assistant' ? ASSISTANT_COMPANIES : SUPERVISOR_COMPANIES;
}

export function workspaceHomePath(workspace: ActivityWorkspace): string {
  return workspace === 'assistant' ? '/assistant' : '/supervisors/dashboard';
}

export function controlsDetailBasePath(workspace: ActivityWorkspace): string {
  return workspace === 'assistant' ? ASSISTANT_CONTROLS_LEGACY : SUPERVISOR_CONTROLS_LEGACY;
}

export function notificationsPath(workspace: ActivityWorkspace): string {
  return workspace === 'assistant' ? '/assistant/notifications' : '/supervisors/notifications';
}

export function controlDetailPath(workspace: ActivityWorkspace, controlId: number): string {
  return `${controlsDetailBasePath(workspace)}/${controlId}`;
}

export function resolveActivityWorkspace(pathname: string): ActivityWorkspace {
  return pathname.includes('/assistant/') ? 'assistant' : 'supervisor';
}

export type ActivityModuleId = 'sunat-inbox' | 'detracciones' | 'pdt-601' | 'pdt-621';

/** Slug URL → declaration_type en backend. */
export const ACTIVITY_MODULE_DECLARATION_TYPE: Record<ActivityModuleId, string> = {
  'sunat-inbox': 'sunat_inbox',
  detracciones: 'detracciones',
  'pdt-601': 'pdt_601',
  'pdt-621': 'pdt_621',
};

/** Segmento API: /api/supervisors/activity-modules/:slug */
export function activityModuleApiSlug(moduleId: ActivityModuleId): string {
  return moduleId;
}

export type ActivityModuleMeta = {
  id: ActivityModuleId;
  label: string;
  description: string;
  icon: string;
  phaseLabel: string;
};

const ACTIVITY_MODULES: ActivityModuleMeta[] = [
  {
    id: 'sunat-inbox',
    label: 'Buzón SOL SUNAT – SUNAFIL',
    description: 'Capturas semanales de buzón SUNAT y SUNAFIL por empresa.',
    icon: 'fas fa-inbox',
    phaseLabel: 'Fase F3',
  },
  {
    id: 'detracciones',
    label: 'Control de Detracciones SUNAT',
    description: 'Seguimiento manual del régimen de detracciones por empresa y período.',
    icon: 'fas fa-landmark',
    phaseLabel: 'Fase F4',
  },
  {
    id: 'pdt-601',
    label: 'Control Planillas PDT 601',
    description: 'Lista de empresas y seguimiento de planillas PDT 601.',
    icon: 'fas fa-file-invoice',
    phaseLabel: 'Fase F5',
  },
  {
    id: 'pdt-621',
    label: 'Control Vencimientos PDT 621',
    description: 'Lista de empresas y seguimiento de vencimientos PDT 621.',
    icon: 'fas fa-file-signature',
    phaseLabel: 'Fase F6',
  },
];

export function activityModulePath(workspace: ActivityWorkspace, moduleId: ActivityModuleId): string {
  return `${activitiesBasePath(workspace)}/${moduleId}`;
}

export function activityModuleMeta(moduleId: string): ActivityModuleMeta | undefined {
  return ACTIVITY_MODULES.find((m) => m.id === moduleId);
}

/** @deprecated Usar activityModuleMeta; se mantiene para compatibilidad temporal. */
export type ActivityHubItem = ActivityModuleMeta & { to: string; available: boolean };

/** @deprecated Hub retirado del menú; metadata de módulos para placeholders. */
export function activityHubItems(workspace: ActivityWorkspace): ActivityHubItem[] {
  const base = activitiesBasePath(workspace);
  return ACTIVITY_MODULES.map((m) => ({
    ...m,
    to: `${base}/${m.id}`,
    available: false,
  }));
}
