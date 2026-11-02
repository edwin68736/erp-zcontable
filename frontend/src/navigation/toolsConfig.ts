/**
 * Módulo "Herramientas": consultas y utilidades de uso diario (SIRE, RH, ITF, tipo de cambio, etc.).
 *
 * Las herramientas aún "en construcción" NO llevan permisos: las ve cualquier usuario autenticado. Las que
 * ya están listas pueden exigir uno (`permission`; SIRE: ver Claves SOL). Esta lista es la única fuente de los submenús del sidebar, del Inicio ("Todos mis accesos")
 * y de las rutas `/tools/:slug`; para agregar una herramienta basta sumarla acá.
 */
import { P } from '../rbac/codes';

export type ToolConfig = {
  /** Segmento de la ruta: `/tools/<slug>`. */
  slug: string;
  label: string;
  icon: string;
  /** Una línea que explica para qué servirá (se muestra en la vista en construcción). */
  description: string;
  /** Permiso para ver la herramienta; sin él, la ve cualquier usuario autenticado. */
  permission?: string;
  /** Pantalla real ya disponible (deja de mostrarse "En construcción"). */
  ready?: boolean;
};

export const TOOLS_BASE_PATH = '/tools';

export const TOOLS: ToolConfig[] = [
  {
    slug: 'sire',
    label: 'SIRE',
    icon: 'fas fa-file-invoice',
    description: 'Registro de Ventas e Ingresos y de Compras electrónico de SUNAT.',
    permission: P.companyCredentialsView,
    ready: true,
  },
  { slug: 'rh', label: 'RH', icon: 'fas fa-file-signature', description: 'Recibos por honorarios: consulta y seguimiento.' },
  { slug: 'consulta-itf', label: 'Consulta ITF', icon: 'fas fa-money-bill-transfer', description: 'Consulta del Impuesto a las Transacciones Financieras.' },
  { slug: 'tipo-de-cambio', label: 'Tipo de cambio', icon: 'fas fa-dollar-sign', description: 'Tipo de cambio SUNAT por fecha.' },
  { slug: 'consulta-detracciones', label: 'Consulta de detracciones', icon: 'fas fa-magnifying-glass-dollar', description: 'Consulta de depósitos y pendientes de detracciones.' },
  { slug: 'consulta-dam', label: 'Consulta DAM', icon: 'fas fa-box-open', description: 'Consulta de Declaraciones Aduaneras de Mercancías.' },
  { slug: 'notificaciones-sunat', label: 'Notificaciones SUNAT', icon: 'fas fa-envelope-open-text', description: 'Notificaciones y mensajes del buzón de SUNAT.' },
];

export const toolPath = (slug: string): string => `${TOOLS_BASE_PATH}/${slug}`;

export function findTool(slug: string | undefined): ToolConfig | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
