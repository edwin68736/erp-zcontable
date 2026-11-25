import type { NotApplicableActivity } from '../../services/notApplicable';

/** Estado de la declaración cuando la empresa no hace esa actividad en el periodo. */
export const NO_CORRESPONDE = 'no_corresponde';
export const NO_CORRESPONDE_BADGE = 'bg-slate-200 text-slate-700';

export const NOT_APPLICABLE_ACTIVITY_LABEL: Record<NotApplicableActivity, string> = {
  pdt_601: 'PDT 601',
  pdt_621: 'PDT 621',
  detracciones: 'Estado cta. detracciones',
  sunat_inbox: 'Buzón SOL',
  informe_detracciones: 'Informe detracciones',
  siscont_balances: 'Siscont balances',
  preliminar_ventas: 'Preliminar de ventas',
};

/** Cómo se llama la marca en cada actividad (PDT 601 ya la llamaba «Sin planilla»). */
export function notApplicableMarkLabel(activity: NotApplicableActivity): string {
  return activity === 'pdt_601' ? 'Sin planilla' : 'No corresponde';
}
