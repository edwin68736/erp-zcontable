import type { CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import type { BuzonSync } from '../../../services/sunatBuzon';
import { formatDate, formatDateTime } from '../../../utils/format';

export type BuzonBadge = { label: string; className: string };

/** Estado a mostrar de una empresa: «Sin clave» manda sobre cualquier sincronización anterior. */
export function buzonBadge(row: Pick<CompanyAccessCredentialRow, 'sol_configurado'>, st: BuzonSync | undefined): BuzonBadge {
  if (!row.sol_configurado) return { label: 'Sin clave', className: 'bg-slate-100 text-slate-600' };
  if (!st) return { label: 'Sin sincronizar', className: 'bg-amber-50 text-amber-700' };
  if (st.status === 'credenciales_rechazadas' && st.blocked) return { label: 'Credenciales rechazadas', className: 'bg-red-50 text-red-700' };
  if (st.status === 'sin_clave') return { label: 'Sin sincronizar', className: 'bg-amber-50 text-amber-700' };
  if (st.status === 'error' || st.status === 'credenciales_rechazadas') {
    return { label: st.last_success_at ? 'Último intento con error' : 'Error', className: 'bg-red-50 text-red-700' };
  }
  return { label: 'Sincronizado', className: 'bg-green-50 text-green-700' };
}

/** «hace 5 min», «hace 3 h», «hace 2 días» (o la fecha si pasó más de una semana). */
export function timeAgo(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return 'nunca';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return formatDate(t);
}

export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : formatDateTime(d);
}

export const ETIQUETA_BADGE: Record<string, string> = {
  '10': 'bg-red-100 text-red-800',
  '11': 'bg-orange-100 text-orange-800',
  '12': 'bg-sky-100 text-sky-800',
  '13': 'bg-lime-100 text-lime-800',
  '14': 'bg-emerald-100 text-emerald-800',
  '15': 'bg-rose-100 text-rose-800',
  '16': 'bg-purple-100 text-purple-800',
};
