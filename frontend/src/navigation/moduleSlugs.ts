/** module_key (backend) → slug de la ruta `/…/activities/:slug`. */
export const MODULE_SLUG: Record<string, string> = {
  pdt_601: 'pdt-601',
  pdt_621: 'pdt-621',
  detracciones: 'detracciones',
  sunat_inbox: 'sunat-inbox',
  informe_detracciones: 'informe-detracciones',
  siscont_balances: 'siscont-balances',
  preliminar_ventas: 'preliminar-ventas',
};

/** Rótulo de un ítem de trabajo: los módulos con varias entregas por mes indican cuál ("1.ª entrega"). */
export function workModuleLabel(label: string, slot?: number, detail?: string): string {
  if (detail) return `${label} · ${detail}`;
  return slot ? `${label} · ${slot}.ª entrega` : label;
}
