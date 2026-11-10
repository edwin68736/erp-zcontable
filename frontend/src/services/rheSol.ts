import client from '../api/client';
import type { SireApiError } from './sire';

/** recibidos por la empresa (Consulta Receptor) o emitidos por la persona natural (Consulta Emisor). */
export type RheSolLado = 'receptor' | 'emisor';

/**
 * Un comprobante (recibo por honorarios, nota de crédito u otro ingreso de 4.ª categoría), leído en SOL. Los campos
 * `emisor_*` son la contraparte: quien emitió el recibo (receptor) o el usuario del servicio, el cliente (emisor).
 */
export interface RheSolItem {
  /** AAAA-MM-DD */
  fec_emision: string;
  /** RH, NC… tal como lo muestra SUNAT. */
  tipo: string;
  /** E001-40 */
  comprobante: string;
  /** NO ANULADO | ANULADO | REVERTIDO */
  estado: string;
  anulado: boolean;
  emisor_tipo_doc: string;
  emisor_doc: string;
  emisor_nombre: string;
  tipo_renta: string;
  gratuito: boolean;
  descripcion: string;
  observacion: string;
  moneda: string;
  renta_bruta: number;
  impuesto_renta: number;
  renta_neta: number;
  monto_pendiente: number;
}

export interface RheSolResult {
  lado?: RheSolLado;
  items: RheSolItem[];
  total: number;
  /** Búsquedas hechas a SUNAT (una por tramo de 1 mes). */
  consultas: number;
  desde: string;
  hasta: string;
  truncado: boolean;
}

export interface RheSolResponse {
  data: RheSolResult;
  /** Id de la consulta en el historial de la empresa (la consulta queda guardada). */
  history_id?: number;
}

/** Una consulta guardada en el historial de la empresa (sin sus resultados). */
export interface RheSolHistoryItem {
  id: number;
  lado?: RheSolLado;
  desde: string;
  hasta: string;
  status: 'listo' | 'sin_datos' | 'error';
  total: number;
  consultas: number;
  truncado: boolean;
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

export const rheSolService = {
  /** Consulta los recibos recibidos por la empresa (fechas de emisión AAAA-MM-DD). El servidor entra a SOL con su clave. */
  async query(companyId: number, lado: RheSolLado, desde: string, hasta: string): Promise<RheSolResponse> {
    try {
      const res = await client.get<RheSolResponse>(`/tools/rh-sol/${companyId}/consulta`, { params: { lado, desde, hasta }, timeout: 300000 });
      return res.data;
    } catch (err) {
      throw toError(err);
    }
  },

  async history(companyId: number, lado: RheSolLado): Promise<RheSolHistoryItem[]> {
    try {
      const res = await client.get<{ data: RheSolHistoryItem[] }>(`/tools/rh-sol/${companyId}/history`, { params: { lado } });
      return res.data.data ?? [];
    } catch (err) {
      throw toError(err);
    }
  },

  /** El resultado guardado de una consulta (no vuelve a consultar a SUNAT). */
  async historyGet(companyId: number, id: number): Promise<RheSolResponse> {
    try {
      const res = await client.get<{ data: RheSolResult | null }>(`/tools/rh-sol/${companyId}/history/${id}`);
      if (!res.data.data) throw new Error('sin resultado');
      return { data: res.data.data, history_id: id };
    } catch (err) {
      throw toError(err);
    }
  },

  async removeHistory(companyId: number, id: number): Promise<void> {
    try {
      await client.delete(`/tools/rh-sol/${companyId}/history/${id}`);
    } catch (err) {
      throw toError(err);
    }
  },

  async clearHistory(companyId: number): Promise<void> {
    try {
      await client.delete(`/tools/rh-sol/${companyId}/history`);
    } catch (err) {
      throw toError(err);
    }
  },
};
