import client from '../api/client';
import type { SireApiError } from './sire';

/** Tipo de consulta en la plataforma de confirmación: compras (soy el adquirente) o ventas (soy el emisor). */
export type RheTipo = 'C' | 'V';

export interface RheCuota {
  numero: string;
  monto: number;
  vencimiento: string;
}

export interface RheNota {
  cod_cpe: string;
  serie: string;
  numero: string;
  motivos: string[];
  comentario: string;
}

export interface RheComprobante {
  estado: string;
  estado_desc: string;
  ruc_emisor: string;
  cod_cpe: string;
  serie: string;
  numero: string;
  fec_emision: string;
  fec_puesta_disposicion: string;
  fec_plazo_pago: string;
  moneda: string;
  monto_pendiente: number;
  importe_factura: number;
  total_honorarios: number;
  retencion: number;
  neto_recibido: number;
  cuotas?: RheCuota[];
  fec_disconformidad?: string;
  motivos_disconformidad?: string[];
  sustento_disconformidad?: string;
  fec_subsanacion?: string;
  notas_subsanacion?: RheNota[];
}

export interface RheResult {
  items: RheComprobante[];
  total: number;
  consultas: number;
  desde: string;
  hasta: string;
  truncado: boolean;
  estados: string[];
}

export interface RheResponse {
  data: RheResult;
  estados: Record<string, string>;
  motivos: Record<string, string>;
  /** Id de la consulta en el historial de la empresa (la consulta queda guardada). */
  history_id?: number;
}

/** Una consulta guardada en el historial de la empresa (sin sus resultados). */
export interface RheHistoryItem {
  id: number;
  tipo: RheTipo;
  cod_cpe: '02' | '01';
  desde: string;
  hasta: string;
  /** Estados consultados, separados por coma. */
  estados: string;
  status: 'listo' | 'sin_datos' | 'error';
  total: number;
  consultas: number;
  truncado: boolean;
  error_code?: string;
  error_message?: string;
  error_detail?: string;
  created_at: string;
}

export interface RheParams {
  tipo: RheTipo;
  cod_cpe: '02' | '01';
  desde: string;
  hasta: string;
  estados?: string[];
}

function toError(err: unknown): SireApiError {
  const data = (err as { response?: { data?: { error?: string; code?: string; detail?: string } } }).response?.data;
  if (data?.error) return { message: data.error, code: data.code, detail: data.detail };
  const net = err as { code?: string; message?: string };
  if (net.code === 'ECONNABORTED') return { message: 'La consulta tardó demasiado. Pruebe con un rango de fechas menor.', code: 'timeout' };
  return { message: 'No se pudo consultar a SUNAT. Intente de nuevo.', detail: net.message };
}

export const rheService = {
  async list(companyId: number, p: RheParams): Promise<RheResponse> {
    try {
      const res = await client.get<RheResponse>(`/tools/rh/${companyId}/comprobantes`, {
        params: { tipo: p.tipo, cod_cpe: p.cod_cpe, desde: p.desde, hasta: p.hasta, estados: p.estados?.join(',') || undefined },
        timeout: 180000,
      });
      return res.data;
    } catch (err) {
      throw toError(err);
    }
  },

  /** Historial de consultas de la empresa (lo más reciente primero). */
  async history(companyId: number): Promise<RheHistoryItem[]> {
    try {
      const res = await client.get<{ data: RheHistoryItem[] }>(`/tools/rh/${companyId}/history`);
      return res.data.data ?? [];
    } catch (err) {
      throw toError(err);
    }
  },

  /** El resultado guardado de una consulta (no vuelve a consultar a SUNAT). */
  async historyGet(companyId: number, id: number): Promise<RheResponse> {
    try {
      const res = await client.get<{ data: RheResult | null; motivos: Record<string, string>; estados: Record<string, string> }>(
        `/tools/rh/${companyId}/history/${id}`,
      );
      if (!res.data.data) throw new Error('sin resultado');
      return { data: res.data.data, estados: res.data.estados, motivos: res.data.motivos, history_id: id };
    } catch (err) {
      throw toError(err);
    }
  },

  async removeHistory(companyId: number, id: number): Promise<void> {
    try {
      await client.delete(`/tools/rh/${companyId}/history/${id}`);
    } catch (err) {
      throw toError(err);
    }
  },

  async clearHistory(companyId: number): Promise<void> {
    try {
      await client.delete(`/tools/rh/${companyId}/history`);
    } catch (err) {
      throw toError(err);
    }
  },
};
