import client from '../api/client';

/** Libros del SIRE: RVIE (ventas e ingresos) y RCE (compras). */
export type SireLibro = 'ventas' | 'compras';

export const SIRE_LIBROS: { value: SireLibro; label: string; short: string }[] = [
  { value: 'ventas', label: 'Ventas e ingresos (RVIE)', short: 'Ventas' },
  { value: 'compras', label: 'Compras (RCE)', short: 'Compras' },
];

/** Error de la API SIRE: mensaje para el usuario, código estable y detalle técnico (sin claves). */
export interface SireApiError {
  message: string;
  code?: string;
  detail?: string;
}

export interface SirePeriod {
  perTributario: string;
  codEstado?: string;
  desEstado?: string;
}

export interface SirePeriodYear {
  numEjercicio: string;
  desEstado?: string;
  lisPeriodos: SirePeriod[];
}

export type SireDownloadMode = 'sin_glosas';
export type SireDownloadStatus = 'en_proceso' | 'listo' | 'sin_datos' | 'error';

/** Una consulta del historial: el período pedido y su resultado. */
export interface SireDownloadItem {
  id: number;
  company_id: number;
  libro: SireLibro;
  period: string;
  mode: SireDownloadMode;
  status: SireDownloadStatus;
  /** Mientras está en proceso: solicitando | esperando | generando. */
  step?: 'solicitando' | 'esperando' | 'generando';
  rows: number;
  size: number;
  error_code?: string;
  error_message?: string;
  error_detail?: string;
  created_at: string;
  finished_at?: string;
}

function toError(err: unknown, fallback: string): SireApiError {
  const data = (err as { response?: { data?: { error?: string; code?: string; detail?: string } } }).response?.data;
  if (data?.error) return { message: data.error, code: data.code, detail: data.detail };
  const net = err as { code?: string; message?: string };
  if (net.code === 'ECONNABORTED') return { message: 'La consulta tardó demasiado. Intente de nuevo.', code: 'timeout' };
  return { message: fallback, detail: net.message };
}

/** Los errores de una descarga (blob) llegan como JSON dentro del blob: se abre para leer el mensaje. */
async function toBlobError(err: unknown, fallback: string): Promise<SireApiError> {
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (data instanceof Blob) {
    try {
      const j = JSON.parse(await data.text()) as { error?: string; code?: string; detail?: string };
      if (j.error) return { message: j.error, code: j.code, detail: j.detail };
    } catch {
      /* no era JSON */
    }
  }
  return toError(err, fallback);
}

const base = (companyId: number) => `/tools/sire/${companyId}`;
const LONG = { timeout: 120000 };
const SHORT = { timeout: 60000 };

/** Nombre del Excel de la propuesta: «<RUC>-<AAAAMM>-SIREV-Propuesta.xlsx» (ventas) o «-SIREC-» (compras). */
export function sirePropuestaFileName(ruc: string, period: string, libro: SireLibro): string {
  return `${ruc}-${period}-${libro === 'ventas' ? 'SIREV' : 'SIREC'}-Propuesta.xlsx`;
}

/** Formato AAAAMM → "09/2026". */
export function formatSirePeriod(p: string | undefined): string {
  return p && /^\d{6}$/.test(p) ? `${p.slice(4)}/${p.slice(0, 4)}` : p ?? '';
}

/** Guarda un archivo en el navegador del usuario. */
export function saveBlobAs(blob: Blob, name: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export const sireService = {
  /** Comprueba las credenciales de API de la empresa (token + consulta de períodos). */
  async test(companyId: number): Promise<void> {
    try {
      await client.post(`${base(companyId)}/test`, undefined, LONG);
    } catch (err) {
      throw toError(err, 'No se pudo probar la conexión con SUNAT.');
    }
  },

  /** Registra solo el Client ID y el Client Secret de la API SIRE de la empresa (el secreto no vuelve del servidor). */
  async saveCredentials(companyId: number, p: { client_id: string; client_secret: string }): Promise<void> {
    try {
      await client.put(`${base(companyId)}/credentials`, p, SHORT);
    } catch (err) {
      throw toError(err, 'No se pudieron guardar las credenciales.');
    }
  },

  /** Períodos que SUNAT tiene habilitados para el libro, agrupados por año. */
  async periods(companyId: number, libro: SireLibro): Promise<SirePeriodYear[]> {
    try {
      const res = await client.get<{ data: SirePeriodYear[] | null }>(`${base(companyId)}/periods`, { params: { libro }, ...LONG });
      return Array.isArray(res.data.data) ? res.data.data : [];
    } catch (err) {
      throw toError(err, 'No se pudieron consultar los períodos en SUNAT.');
    }
  },

  /** Historial de consultas de la empresa (lo más reciente primero). */
  async downloads(companyId: number): Promise<SireDownloadItem[]> {
    try {
      const res = await client.get<{ data: SireDownloadItem[] }>(`${base(companyId)}/downloads`, SHORT);
      return res.data.data ?? [];
    } catch (err) {
      throw toError(err, 'No se pudo leer el historial.');
    }
  },

  /** Registra una consulta por período; SUNAT la procesa en segundo plano y aparece en el historial. */
  async startDownloads(companyId: number, p: { libro: SireLibro; periods: string[]; mode: SireDownloadMode }): Promise<SireDownloadItem[]> {
    try {
      const res = await client.post<{ data: SireDownloadItem[] }>(`${base(companyId)}/downloads`, p, SHORT);
      return res.data.data ?? [];
    } catch (err) {
      throw toError(err, 'No se pudo iniciar la consulta.');
    }
  },

  /** El Excel de una consulta ya lista (sin volver a consultar a SUNAT). */
  async downloadBlob(companyId: number, id: number): Promise<Blob> {
    try {
      const res = await client.get<Blob>(`${base(companyId)}/downloads/${id}/file`, { responseType: 'blob', ...SHORT });
      return res.data;
    } catch (err) {
      throw await toBlobError(err, 'No se pudo bajar el Excel.');
    }
  },

  async removeDownload(companyId: number, id: number): Promise<void> {
    try {
      await client.delete(`${base(companyId)}/downloads/${id}`, SHORT);
    } catch (err) {
      throw toError(err, 'No se pudo quitar del historial.');
    }
  },

  /** Limpia el historial (menos lo que sigue en proceso). */
  async clearDownloads(companyId: number): Promise<void> {
    try {
      await client.delete(`${base(companyId)}/downloads`, SHORT);
    } catch (err) {
      throw toError(err, 'No se pudo limpiar el historial.');
    }
  },
};
