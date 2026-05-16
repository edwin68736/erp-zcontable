/**
 * Configuración única del menú lateral.
 * - 5 módulos operativos (slots fijos): el primero es Finanzas (implementado); 2–5 son placeholders enlazables.
 * - Sección "Estudio": ajustes globales del tenant (configuración, usuarios); no cuenta como módulo operativo ERP.
 *
 * Al añadir pantallas a un módulo nuevo, editar solo este archivo (y rutas en App.tsx).
 */

import { auth } from '../services/auth';
import { P } from '../rbac/codes';

export type SidebarLinkItem = {
  to: string;
  icon: string;
  label: string;
  /** NavLink `end`: solo activo en coincidencia exacta */
  exact?: boolean;
  /** Permiso module.action requerido para mostrar el enlace (auth.hasPermission). */
  permission?: string;
};

export type SidebarGroup = {
  type: 'group';
  /** Texto de subsección dentro del módulo (ej. Operación, Catálogo) */
  label: string;
  items: SidebarLinkItem[];
};

export type SidebarFlatLink = {
  type: 'link';
} & SidebarLinkItem;

export type SidebarModuleEntry = SidebarGroup | SidebarFlatLink;

/** IDs estables para permisos / telemetría futura */
export type OperationalModuleId = 'finance' | 'supervisors' | 'module3' | 'module4' | 'module5';

export type OperationalModuleConfig = {
  id: OperationalModuleId;
  /** Título visible del bloque en el sidebar */
  label: string;
  icon: string;
  entries: SidebarModuleEntry[];
};

/** Rutas bajo `/m/:slug` para módulos aún sin implementar */
export const COMING_SOON_MODULE_SLUGS = ['supervisors', 'module-3', 'module-4', 'module-5'] as const;
export type ComingSoonModuleSlug = (typeof COMING_SOON_MODULE_SLUGS)[number];

/** Textos de la vista "próximamente" por ruta `/m/:slug` */
export const PLACEHOLDER_PAGE_COPY: Record<ComingSoonModuleSlug, { title: string; subtitle: string }> = {
  supervisors: {
    title: 'Supervisores',
    subtitle: 'Módulo de supervisión y contabilidad. En preparación.',
  },
  'module-3': {
    title: 'Módulo 3',
    subtitle: 'Reservado para expansión del ERP.',
  },
  'module-4': {
    title: 'Módulo 4',
    subtitle: 'Reservado para expansión del ERP.',
  },
  'module-5': {
    title: 'Módulo 5',
    subtitle: 'Reservado para expansión del ERP.',
  },
};

/** Mapeo estable id operativo → slug URL (p. ej. permisos o analytics) */
export const COMING_SOON_BY_OPERATIONAL_ID: Record<
  Exclude<OperationalModuleId, 'finance'>,
  { slug: ComingSoonModuleSlug }
> = {
  supervisors: { slug: 'supervisors' },
  module3: { slug: 'module-3' },
  module4: { slug: 'module-4' },
  module5: { slug: 'module-5' },
};

export const OPERATIONAL_MODULES: OperationalModuleConfig[] = [
  {
    id: 'finance',
    label: 'Finanzas del estudio',
    icon: 'fas fa-coins',
    entries: [
      {
        type: 'group',
        label: 'Operación',
        items: [
          { to: '/dashboard', icon: 'fas fa-th-large', label: 'Dashboard', exact: true, permission: P.dashboardView },
          { to: '/companies', icon: 'fas fa-building', label: 'Empresas', permission: P.companiesView },
          { to: '/documents', icon: 'fas fa-file-invoice-dollar', label: 'Deudas', permission: P.documentsView },
          { to: '/tax-settlements', icon: 'fas fa-file-signature', label: 'Liquidaciones', permission: P.taxSettlementsList },
          { to: '/comprobantes', icon: 'fas fa-file-invoice', label: 'Comprobantes', permission: P.tukifacFiscalReceiptsList },
          { to: '/payments', icon: 'fas fa-wallet', label: 'Pagos', permission: P.paymentsView },
        ],
      },
      {
        type: 'group',
        label: 'Catálogo e integraciones',
        items: [
          { to: '/subscription-plans', icon: 'fas fa-layer-group', label: 'Planes', permission: P.subscriptionPlansView },
          { to: '/products', icon: 'fas fa-box-open', label: 'Productos', permission: P.productsView },
          { to: '/tukifac/documentos', icon: 'fas fa-cloud-download-alt', label: 'Documentos Tukifac', permission: P.tukifacDocumentsList },
          { to: '/documents/fiscal-receipts', icon: 'fas fa-link', label: 'Conciliación Tukifac', permission: P.tukifacFiscalReceiptsList },
        ],
      },
      {
        type: 'group',
        label: 'Informes',
        items: [{ to: '/reports/financial', icon: 'fas fa-chart-line', label: 'Reportes', permission: P.reportsFinancialView }],
      },
    ],
  },
  {
    id: 'supervisors',
    label: 'Supervisores',
    icon: 'fas fa-user-check',
    entries: [],
  },
  {
    id: 'module3',
    label: 'Módulo 3',
    icon: 'fas fa-cube',
    entries: [],
  },
  {
    id: 'module4',
    label: 'Módulo 4',
    icon: 'fas fa-cubes',
    entries: [],
  },
  {
    id: 'module5',
    label: 'Módulo 5',
    icon: 'fas fa-puzzle-piece',
    entries: [],
  },
];

/** Ajustes globales del estudio (no módulo operativo contable) */
export const STUDIO_SECTION = {
  id: 'studio' as const,
  label: 'Estudio',
  icon: 'fas fa-building-columns',
  items: [
    { to: '/settings/firm', icon: 'fas fa-gear', label: 'Configuración', permission: P.settingsFirmView },
    { to: '/users', icon: 'fas fa-users-cog', label: 'Usuarios', permission: P.usersView },
    { to: '/users/roles', icon: 'fas fa-user-shield', label: 'Roles y permisos', permission: P.rbacRolesView },
  ] satisfies SidebarLinkItem[],
};

export function isComingSoonSlug(value: string): value is ComingSoonModuleSlug {
  return (COMING_SOON_MODULE_SLUGS as readonly string[]).includes(value);
}

/** Enlace visible solo con el permiso exacto del ítem (misma regla que la pantalla/API). */
export function isSidebarLinkVisible(link: SidebarLinkItem): boolean {
  const code = link.permission?.trim();
  if (!code) return false;
  return auth.hasPermission(code);
}

export function filterSidebarEntries(entries: SidebarModuleEntry[]): SidebarModuleEntry[] {
  const out: SidebarModuleEntry[] = [];
  for (const entry of entries) {
    if (entry.type === 'link') {
      if (isSidebarLinkVisible(entry)) out.push(entry);
      continue;
    }
    const items = entry.items.filter((l) => isSidebarLinkVisible(l));
    if (items.length > 0) out.push({ type: 'group', label: entry.label, items });
  }
  return out;
}

export function isOperationalModuleVisible(mod: OperationalModuleConfig): boolean {
  return filterSidebarEntries(mod.entries).length > 0;
}

export function getVisibleOperationalModules(): OperationalModuleConfig[] {
  return OPERATIONAL_MODULES.filter(isOperationalModuleVisible);
}

export function isStudioSectionVisible(): boolean {
  return STUDIO_SECTION.items.some((l) => isSidebarLinkVisible(l));
}

/** Id usado en el acordeón del sidebar (5 operativos + Estudio) */
export type SidebarAccordionId = OperationalModuleId | typeof STUDIO_SECTION.id;

type NavPathRow = {
  moduleId: SidebarAccordionId;
  path: string;
  exact?: boolean;
};

function normalizeNavPath(p: string): string {
  const t = (p ?? '').trim();
  if (!t || t === '/') return '/';
  return t.replace(/\/+$/, '') || '/';
}

function collectNavPaths(): NavPathRow[] {
  const rows: NavPathRow[] = [];
  for (const mod of OPERATIONAL_MODULES) {
    for (const e of mod.entries) {
      if (e.type === 'link') {
        rows.push({ moduleId: mod.id, path: normalizeNavPath(e.to), exact: e.exact });
      } else {
        for (const l of e.items) {
          rows.push({ moduleId: mod.id, path: normalizeNavPath(l.to), exact: l.exact });
        }
      }
    }
  }
  for (const l of STUDIO_SECTION.items) {
    const link = l as SidebarLinkItem;
    rows.push({ moduleId: STUDIO_SECTION.id, path: normalizeNavPath(link.to), exact: link.exact });
  }
  return rows.sort((a, b) => b.path.length - a.path.length);
}

const NAV_PATH_ROWS = collectNavPaths();

const SLUG_PREFIX_TO_MODULE: Record<string, OperationalModuleId> = {
  supervisors: 'supervisors',
  'module-3': 'module3',
  'module-4': 'module4',
  'module-5': 'module5',
};

/**
 * Determina qué bloque del acordeón corresponde a la ruta actual.
 * Rutas desconocidas devuelven null (el sidebar no fuerza cambio de acordeón).
 */
export function resolveSidebarModuleIdFromPathname(pathname: string): SidebarAccordionId | null {
  const p = normalizeNavPath(pathname);

  if (p.startsWith('/m/')) {
    const segment = p.slice(3).split('/')[0] ?? '';
    const mod = SLUG_PREFIX_TO_MODULE[segment];
    if (mod) return mod;
  }

  for (const row of NAV_PATH_ROWS) {
    const { path, exact, moduleId } = row;
    if (exact) {
      if (p === path) return moduleId;
      continue;
    }
    if (p === path || (path !== '/' && p.startsWith(`${path}/`))) return moduleId;
  }

  return null;
}
