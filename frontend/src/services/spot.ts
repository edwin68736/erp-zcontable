import client from '../api/client';
import type { SireApiError } from './sire';

/** Tipo de cuenta de detracciones del Banco de la Nación, como lo ofrece la pantalla de SUNAT. */
export type SpotTipoCuenta = '1' | '2' | '3';
/** Tipo de pago de la pantalla de SUNAT. */
export type SpotTipoPago = 'individuales' | 'masivos' | 'pasajeros';
/** Se consulta por fecha de pago (máximo 30 días) o por periodo tributario (solo pagos individuales). */
export type SpotModo = 'fecha' | 'periodo';

export interface SpotFilter {
  tipo_cuenta: SpotTipoCuenta;
  tipo_pago: SpotTipoPago;
  modo: SpotModo;
  /** AAAA-MM-DD (modo fecha) */
  desde: string;
  hasta: string;
  /** AAAAMM (modo periodo) */
  periodo: string;
}

/** Una descarga del historial de la empresa (sin los archivos). Nace «en_proceso»: se baja una constancia por pago. */
export interface SpotDownloadItem extends SpotFilter {
  id: number;
  company_id: number;
  status: 'en_proceso' | 'listo' | 'sin_datos' | 'error';
  /** Pagos encontrados. */
  total: number;
  /** Suma de los depósitos. */
  monto: number;
  /** Constancias que se bajaron en esta descarga (hasta 250 por tanda). */
  bajadas: number;
  /** Constancias de estos pagos que aún no se han bajado: la siguiente descarga con los mismos filtros las baja. */
  pendientes: number;
  aviso?: string;
  error_code?: string;
  error_message?: string;
  error_detail?: string;
  created_at: string;
  finished_at?: string;
}

function toError(err: unknown): SireApiError {
  const data = (err as { response?: { data?: { error?: string; code?: string; detail?: string } } }).response?.data;
  if (data?.error) return { message: data.error, code: data.code, detail: data.detail };
  const net = err as { code?: string; message?: string };
  if (net.code === 'ECONNABORTED') return { message: 'La solicitud tardó demasiado en iniciarse. Intente de nuevo.', code: 'timeout' };
  return { message: 'No se pudo consultar a SUNAT. Intente de nuevo.', detail: net.message };
}

async function toBlobError(err: unknown, fallback: string): Promise<SireApiError> {
  const blob = (err as { response?: { data?: unknown } }).response?.data;
  if (blob instanceof Blob) {
    try {
      const j = JSON.parse(await blob.text()) as { error?: string; code?: string; detail?: string };
      if (j.error) return { message: j.error, code: j.code, detail: j.detail };
    } catch {
      /* sin cuerpo legible */
    }
  }
  return { message: fallback };
}

const base = (companyId: number) => `/tools/detracciones/${companyId}/descargas`;

export const spotService = {
  /** Inicia la descarga en segundo plano. Devuelve la fila «en proceso» del historial. */
  async start(companyId: number, f: SpotFilter): Promise<SpotDownloadItem> {
    try {
      const res = await client.post<{ data: SpotDownloadItem }>(base(companyId), f, { timeout: 30000 });
      return res.data.data;
    } catch (err) {
      throw toError(err);
    }
  },

  async history(companyId: number): Promise<SpotDownloadItem[]> {
    try {
      const res = await client.get<{ data: SpotDownloadItem[] }>(base(companyId));
      return res.data.data ?? [];
    } catch (err) {
      throw toError(err);
    }
  },

  /** El ZIP (Excel + constancias) de una descarga lista, o solo su Excel con `excel`. */
  async file(companyId: number, id: number, excel = false): Promise<{ blob: Blob; name: string }> {
    try {
      const res = await client.get<Blob>(`${base(companyId)}/${id}/zip${excel ? '?excel=1' : ''}`, { responseType: 'blob', timeout: 120000 });
      const cd = String(res.headers['content-disposition'] ?? '');
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      const fallback = excel ? 'Reporte_Detracciones.xlsx' : 'Detracciones.zip';
      return { blob: res.data, name: m ? decodeURIComponent(m[1]) : fallback };
    } catch (err) {
      throw await toBlobError(err, 'No se pudo bajar el archivo.');
    }
  },

  async remove(companyId: number, id: number): Promise<void> {
    try {
      await client.delete(`${base(companyId)}/${id}`);
    } catch (err) {
      throw toError(err);
    }
  },

  async clear(companyId: number): Promise<void> {
    try {
      await client.delete(base(companyId));
    } catch (err) {
      throw toError(err);
    }
  },
};
