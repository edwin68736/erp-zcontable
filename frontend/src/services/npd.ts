import client from '../api/client';
import type { SireApiError } from './sire';

/** Un NPD (Número de Pago de Detracciones) de la lista de SUNAT. */
export interface NpdItem {
  npd: string;
  ruc: string;
  razon_social: string;
  /** dd/mm/aaaa hh:mm:ss */
  fec_registro: string;
  /** dd/mm/aaaa */
  fec_creacion: string;
  fec_limite_pago: string;
  estado: string;
  /** 00 vigente · 10 pagado confirmado · 11 no vigente */
  estado_cod: string;
  importe: number;
}

export interface NpdResult {
  /** AAAA-MM-DD (fecha de generación) */
  desde: string;
  hasta: string;
  items: NpdItem[];
  total: number;
  total_importe: number;
  /** NPD que siguen vigentes (pendientes de pago) y su importe. */
  vigentes: number;
  importe_vigente: number;
}

export interface NpdQueryResponse {
  data: NpdResult;
  /** Id de la consulta en el historial de la empresa (la consulta queda guardada). */
  history_id?: number;
}

/** Una consulta guardada en el historial de la empresa (sin su resultado). */
export interface NpdHistoryItem {
  id: number;
  desde: string;
  hasta: string;
  status: 'listo' | 'sin_datos' | 'error';
  total: number;
  total_importe: number;
  vigentes: number;
  importe_vigente: number;
  error_code?: string;
  error_message?: string;
  error_detail?: string;
  created_at: string;
}

function toError(err: unknown): SireApiError {
  const data = (err as { response?: { data?: { error?: string; code?: string; detail?: string } } }).response?.data;
  if (data?.error) return { message: data.error, code: data.code, detail: data.detail };
  const net = err as { code?: string; message?: string };
  if (net.code === 'ECONNABORTED') return { message: 'La consulta tardó demasiado. Pruebe con un rango de fechas menor.', code: 'timeout' };
  return { message: 'No se pudo consultar a SUNAT. Intente de nuevo.', detail: net.message };
}

export const npdService = {
  /** Consulta los NPD de la empresa generados entre dos fechas (AAAA-MM-DD). El servidor entra a SOL con su clave. */
  async query(companyId: number, desde: string, hasta: string): Promise<NpdQueryResponse> {
    try {
      const res = await client.get<NpdQueryResponse>(`/tools/detracciones/${companyId}/npd`, { params: { desde, hasta }, timeout: 120000 });
      return res.data;
    } catch (err) {
      throw toError(err);
    }
  },

  async history(companyId: number): Promise<NpdHistoryItem[]> {
    try {
      const res = await client.get<{ data: NpdHistoryItem[] }>(`/tools/detracciones/${companyId}/history`);
      return res.data.data ?? [];
    } catch (err) {
      throw toError(err);
    }
  },

  /** El resultado guardado de una consulta (no vuelve a consultar a SUNAT). */
  async historyGet(companyId: number, id: number): Promise<NpdQueryResponse> {
    try {
      const res = await client.get<{ data: NpdResult | null }>(`/tools/detracciones/${companyId}/history/${id}`);
      if (!res.data.data) throw new Error('sin resultado');
      return { data: res.data.data, history_id: id };
    } catch (err) {
      throw toError(err);
    }
  },

  async removeHistory(companyId: number, id: number): Promise<void> {
    try {
      await client.delete(`/tools/detracciones/${companyId}/history/${id}`);
    } catch (err) {
      throw toError(err);
    }
  },

  async clearHistory(companyId: number): Promise<void> {
    try {
      await client.delete(`/tools/detracciones/${companyId}/history`);
    } catch (err) {
      throw toError(err);
    }
  },
};
