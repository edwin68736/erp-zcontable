import { P } from '../rbac/codes';
import { auth } from '../services/auth';

/**
 * Accesos directos de la página de Inicio (los que giran alrededor del robot).
 *
 * `icon`: ilustración en `frontend/public/home/iconos/` (se sirve en `/home/iconos/…`). Para usar
 * otra imagen basta reemplazar el archivo conservando el nombre, o cambiar la extensión acá
 * (png/webp/svg).
 *
 * `resolve` devuelve la ruta destino según permisos del usuario, o `null` si no tiene acceso: el
 * acceso directo solo se muestra cuando hay a dónde llevar. Reusa los mismos permisos que el
 * sidebar y las rutas de App.tsx, así que no abre nada que el menú no abriera ya.
 */
export type HomeModule = {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  /** Trazado SVG (stroke) del icono pequeño de la tarjeta. */
  glyph: string;
  resolve: () => string | null;
};

const has = (code: string) => auth.hasPermission(code);

/** Los módulos de actividades viven bajo /supervisors (quien supervisa) o /assistant (quien carga). */
const activitiesBase = () => (has(P.supervisorsReportsView) ? '/supervisors/activities' : '/assistant/activities');

export const HOME_MODULES: HomeModule[] = [
  {
    key: 'clientes',
    title: 'Clientes',
    subtitle: 'Gestiona tu cartera',
    icon: '/home/iconos/clientes.svg',
    glyph: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    resolve: () => {
      if (has(P.companiesView)) return '/companies';
      if (has(P.companyCredentialsView)) return has(P.supervisorsReportsView) ? '/supervisors/companies' : '/assistant/companies';
      return null;
    },
  },
  {
    key: 'contabilidad',
    title: 'Contabilidad',
    subtitle: 'PDT, Libros y EE.FF.',
    icon: '/home/iconos/contabilidad.svg',
    glyph: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01',
    resolve: () => (has(P.supervisorsControlsView) ? `${activitiesBase()}/pdt-621` : null),
  },
  {
    key: 'supervisores',
    title: 'Supervisores',
    subtitle: 'Seguimiento y control',
    icon: '/home/iconos/supervisores.svg',
    glyph: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 11l2 2 4-4',
    resolve: () => (has(P.supervisorsReportsView) && has(P.supervisorsDashboardView) ? '/supervisors/dashboard' : null),
  },
  {
    key: 'vencimientos',
    title: 'Vencimientos',
    subtitle: 'SUNAT y obligaciones',
    icon: '/home/iconos/vencimientos.svg',
    glyph: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18',
    resolve: () => {
      if (has(P.financeCalendarView)) return '/finance/calendar';
      if (has(P.financeSunatDueDatesView)) return '/finance/sunat-due-dates';
      return null;
    },
  },
  {
    key: 'recursos',
    title: 'Recursos',
    subtitle: 'Claves SOL y del estudio',
    icon: '/home/iconos/recursos.svg',
    glyph: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    resolve: () => (has(P.companyCredentialsView) ? '/finance/claves-sol' : null),
  },
  {
    key: 'reportes',
    title: 'Reportes',
    subtitle: 'Información para decisiones',
    icon: '/home/iconos/reportes.svg',
    glyph: 'M3 3v18h18M8 17v-5M13 17V8M18 17v-9',
    resolve: () => {
      if (has(P.reportsFinancialView)) return '/reports/financial';
      if (has(P.supervisorsReportsView)) return '/supervisors/reports';
      return null;
    },
  },
  {
    key: 'ventas',
    title: 'Ventas',
    subtitle: 'Preliminar de ventas',
    icon: '/home/iconos/ventas.svg',
    glyph: 'M4 20V11M10 20V4M16 20v-7M22 20H2',
    resolve: () => (has(P.supervisorsControlsView) ? `${activitiesBase()}/preliminar-ventas` : null),
  },
  {
    key: 'comprobantes',
    title: 'Comprobantes',
    subtitle: 'Emisión y control',
    icon: '/home/iconos/comprobantes.svg',
    glyph: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
    resolve: () => (has(P.fiscalReceiptsList) ? '/comprobantes' : null),
  },
];

export type ResolvedHomeModule = HomeModule & { to: string };

export function getHomeModules(): ResolvedHomeModule[] {
  const out: ResolvedHomeModule[] = [];
  for (const m of HOME_MODULES) {
    const to = m.resolve();
    if (to) out.push({ ...m, to });
  }
  return out;
}
