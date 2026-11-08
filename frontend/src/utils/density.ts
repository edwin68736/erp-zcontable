export type DensityPref = 'auto' | 'comfortable' | 'compact';
export type Density = 'comfortable' | 'compact';

/** Clave donde se guarda la elección de la persona. */
export const DENSITY_KEY = 'densityPref';

/** En «Automática», por debajo de este ancho o alto (px CSS) las listas van compactas. */
export const AUTO_COMPACT_BELOW_WIDTH = 1500;
export const AUTO_COMPACT_BELOW_HEIGHT = 800;

export const DENSITY_OPTIONS: { id: DensityPref; label: string; help: string }[] = [
  { id: 'auto', label: 'Automática', help: 'Compacta en pantallas pequeñas' },
  { id: 'comfortable', label: 'Cómoda', help: 'Más aire entre filas' },
  { id: 'compact', label: 'Compacta', help: 'Más filas en pantalla' },
];

export function parseDensityPref(raw: string | null): DensityPref {
  return raw === 'comfortable' || raw === 'compact' ? raw : 'auto';
}

/** La densidad que se aplica según la elección y el tamaño de la ventana. */
export function resolveDensity(pref: DensityPref, width: number, height: number): Density {
  if (pref === 'comfortable' || pref === 'compact') return pref;
  return width < AUTO_COMPACT_BELOW_WIDTH || height < AUTO_COMPACT_BELOW_HEIGHT ? 'compact' : 'comfortable';
}
