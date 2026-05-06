/** Claves de caché de series Tukifac (sessionStorage, misma sesión que el token). */
export const TUKIFAC_DOC_SERIES_SESSION_KEY = 'miweb_tukifac_document_series_v1';
export const TUKIFAC_SALE_NOTE_SERIES_SESSION_KEY = 'miweb_tukifac_sale_note_series_v1';

export function clearTukifacSeriesSessionCache(): void {
  try {
    window.sessionStorage.removeItem(TUKIFAC_DOC_SERIES_SESSION_KEY);
    window.sessionStorage.removeItem(TUKIFAC_SALE_NOTE_SERIES_SESSION_KEY);
  } catch {
    return;
  }
}
