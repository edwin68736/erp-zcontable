/** Caché de series locales (sessionStorage). */
export const FISCAL_SERIES_SESSION_KEY = 'miweb_fiscal_document_series_v1';
/** @deprecated */
export const TUKIFAC_DOC_SERIES_SESSION_KEY = FISCAL_SERIES_SESSION_KEY;
/** @deprecated */
export const TUKIFAC_SALE_NOTE_SERIES_SESSION_KEY = FISCAL_SERIES_SESSION_KEY;

export function clearTukifacSeriesSessionCache(): void {
  try {
    window.sessionStorage.removeItem(FISCAL_SERIES_SESSION_KEY);
  } catch {
    return;
  }
}
