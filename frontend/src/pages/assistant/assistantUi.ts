import type { AssistantWorkItem } from '../../services/supervisors';

/** Colores y textos de una tarea del panel del asistente, compartidos por la lista de trabajo y el modal de cada módulo. */

export const STATE_STYLE: Record<AssistantWorkItem['state'], { stripe: string; fg: string; bg: string; btn: string; btnBg: string; btnFg: string; btnBorder: string }> = {
  vencida: { stripe: '#DC2626', fg: '#991B1B', bg: '#FEE2E2', btn: 'Cargar', btnBg: '#0E8F47', btnFg: '#fff', btnBorder: '#0E8F47' },
  observada: { stripe: '#EA580C', fg: '#9A3412', bg: '#FFEDD5', btn: 'Corregir', btnBg: '#EA580C', btnFg: '#fff', btnBorder: '#EA580C' },
  pendiente: { stripe: '#F59E0B', fg: '#92400E', bg: '#FEF3C7', btn: 'Cargar', btnBg: '#0E8F47', btnFg: '#fff', btnBorder: '#0E8F47' },
  por_revisar: { stripe: '#6366F1', fg: '#3730A3', bg: '#E0E7FF', btn: 'Ver', btnBg: '#fff', btnFg: '#334155', btnBorder: '#CBD5E1' },
};

export function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}

export function stateLabel(w: AssistantWorkItem): string {
  if (w.state === 'vencida') return 'Vencida';
  if (w.state === 'observada') return 'Observada';
  if (w.state === 'por_revisar') return 'Por revisar';
  if (w.days_left === 0) return 'Vence hoy';
  if (w.days_left === 1) return 'Vence mañana';
  return 'Pendiente';
}

export function dueText(w: AssistantWorkItem): { text: string; urgent: boolean } {
  const d = w.days_left;
  const date = shortDate(w.due_date);
  // Buzón SOL: una fila por empresa con todas sus capturas vencidas (no tiene una sola fecha límite).
  if (w.module_key === 'sunat_inbox' && w.state === 'vencida' && (d === undefined || d === null)) {
    return { text: 'Capturas semanales sin hacer en este periodo', urgent: true };
  }
  if (w.state === 'por_revisar') return { text: 'Enviada — esperando la revisión del supervisor', urgent: false };
  if (d === undefined || d === null) {
    return { text: w.state === 'observada' ? 'Corrige y vuelve a cargar' : 'Sin fecha límite configurada', urgent: w.state === 'observada' };
  }
  if (d < 0) {
    const ago = d === -1 ? 'ayer' : `hace ${Math.abs(d)} días`;
    return { text: `Venció ${ago}${date ? ` (${date})` : ''}${w.state === 'observada' ? ' — corrige y vuelve a cargar' : ''}`, urgent: true };
  }
  if (d === 0) return { text: 'Vence hoy', urgent: true };
  if (d === 1) return { text: `Vence mañana${date ? ` (${date})` : ''}`, urgent: true };
  return { text: `En ${d} días${date ? ` (${date})` : ''}`, urgent: d <= 3 };
}
