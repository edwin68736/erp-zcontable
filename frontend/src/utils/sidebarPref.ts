/** Clave donde se guarda la elección EXPLÍCITA de la persona (solo se escribe al pulsar el botón del menú). */
export const SIDEBAR_PREF_KEY = 'sidebarCollapsedPref';

/** Por debajo de este ancho de pantalla (px CSS) el menú arranca colapsado si la persona no eligió nada. */
export const SIDEBAR_AUTO_COLLAPSE_BELOW = 1400;

/**
 * ¿Arranca colapsado el menú lateral? Manda lo que la persona eligió ('1' / '0'); si nunca eligió, se colapsa en
 * pantallas angostas para dejar el ancho a la información de la vista.
 */
export function initialSidebarCollapsed(stored: string | null, viewportWidth: number): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return viewportWidth < SIDEBAR_AUTO_COLLAPSE_BELOW;
}
