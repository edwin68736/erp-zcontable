import client from '../api/client';
import type { SireApiError } from './sire';

/** Una tabla del resultado de la consulta de ITF: columnas tal como las muestra SUNAT y sus filas. */
export interface ItfTable {
  titulo: string;
  columnas: string[];
  filas: string[][];
  registros: number;
  total_impuesto?: number;
  total_movimientos?: number;
}

export interface ItfResult {
  /** AAAAMM */
  desde: string;
  hasta: string;
  documento: string;
  razon_social: string;
  acumulados: ItfTable;
  contra_asientos: ItfTable;
  exoneraciones: ItfTable;
  nota?: string;
}

export interface ItfQueryResponse {
  data: ItfResult;
  /** Id de la consulta en el historial de la empresa (la consulta queda guardada). */
  history_id?: number;
}

/** Una consulta guardada en el historial de la empresa (sin su resultado). */
export interface ItfHistoryItem {
  id: number;
  desde: string;
  hasta: string;
  status: 'listo' | 'sin_datos' | 'error';
  total: number;
  total_impuesto: number;
  total_movimientos: number;
  error_code?: string;
  error_message?: string;
  error_detail?: string;
  created_at: string;
}

function toError(err: unknown): SireApiError {
  const data = (err as { response?: { data?: { error?: string; code?: string; detail?: string } } }).response?.data;
  if (data?.error) return { message: data.error, code: data.code, detail: data.detail };
  const net = err as { code?: string; message?: string };
  if (net.code === 'ECONNABORTED') return { message: 'La consulta tardó demasiado. Pruebe con un rango de periodos menor.', code: 'timeout' };
  return { message: 'No se pudo consultar a SUNAT. Intente de nuevo.', detail: net.message };
}

export const itfService = {
  /** Consulta el ITF de la empresa entre dos periodos (AAAAMM). El servidor entra a SOL con su clave. */
  async query(companyId: number, desde: string, hasta: string): Promise<ItfQueryResponse> {
    try {
      const res = await client.get<ItfQueryResponse>(`/tools/itf/${companyId}/consulta`, { params: { desde, hasta }, timeout: 120000 });
      return res.data;
    } catch (err) {
      throw toError(err);
    }
  },

  async history(companyId: number): Promise<ItfHistoryItem[]> {
    try {
      const res = await client.get<{ data: ItfHistoryItem[] }>(`/tools/itf/${companyId}/history`);
      return res.data.data ?? [];
    } catch (err) {
      throw toError(err);
    }
  },

  /** El resultado guardado de una consulta (no vuelve a consultar a SUNAT). */
  async historyGet(companyId: number, id: number): Promise<ItfQueryResponse> {
    try {
      const res = await client.get<{ data: ItfResult | null }>(`/tools/itf/${companyId}/history/${id}`);
      if (!res.data.data) throw new Error('sin resultado');
      return { data: res.data.data, history_id: id };
    } catch (err) {
      throw toError(err);
    }
  },

  async removeHistory(companyId: number, id: number): Promise<void> {
    try {
      await client.delete(`/tools/itf/${companyId}/history/${id}`);
    } catch (err) {
      throw toError(err);
    }
  },

  async clearHistory(companyId: number): Promise<void> {
    try {
      await client.delete(`/tools/itf/${companyId}/history`);
    } catch (err) {
      throw toError(err);
    }
  },
};
