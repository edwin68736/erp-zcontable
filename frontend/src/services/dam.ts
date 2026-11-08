import client from '../api/client';
import type { SireApiError } from './sire';

/** Una DAM (Declaración Aduanera de Mercancías de exportación) de la lista de SUNAT. */
export interface DamItem {
  /** Aduana-Régimen-Año-Número */
  dam: string;
  /** dd/mm/aaaa */
  fec_numeracion: string;
  despachador: string;
  exportador: string;
  consignatario: string;
  tipo_embarque: string;
  /** Total de la cláusula de venta. */
  clausula_venta: number;
  /** Total del valor en aduanas. */
  valor_aduana: number;
  regularizacion?: string;
  id_declaracion?: string;
}

export interface DamResult {
  /** AAAA-MM-DD (fecha de numeración) */
  desde: string;
  hasta: string;
  items: DamItem[];
  total: number;
  total_clausula: number;
  total_valor: number;
  /** Mensaje de SUNAT que acompaña a la lista (por ejemplo, que hay más resultados de los que muestra). */
  aviso?: string;
}

/** Una consulta del historial de la empresa (sin su resultado). La búsqueda en Aduanas es lenta: nace «en_proceso». */
export interface DamHistoryItem {
  id: number;
  desde: string;
  hasta: string;
  status: 'en_proceso' | 'listo' | 'sin_datos' | 'error';
  total: number;
  total_valor: number;
  total_clausula: number;
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
  if (net.code === 'ECONNABORTED') return { message: 'La consulta tardó demasiado en iniciarse. Intente de nuevo.', code: 'timeout' };
  return { message: 'No se pudo consultar a SUNAT. Intente de nuevo.', detail: net.message };
}

export const damService = {
  /** Inicia la consulta en segundo plano (Aduanas tarda más de un minuto). Devuelve la fila «en proceso» del historial. */
  async start(companyId: number, desde: string, hasta: string): Promise<DamHistoryItem> {
    try {
      const res = await client.post<{ data: DamHistoryItem }>(`/tools/dam/${companyId}/consulta`, { desde, hasta }, { timeout: 30000 });
      return res.data.data;
    } catch (err) {
      throw toError(err);
    }
  },

  async history(companyId: number): Promise<DamHistoryItem[]> {
    try {
      const res = await client.get<{ data: DamHistoryItem[] }>(`/tools/dam/${companyId}/history`);
      return res.data.data ?? [];
    } catch (err) {
      throw toError(err);
    }
  },

  /** El resultado guardado de una consulta terminada. */
  async historyGet(companyId: number, id: number): Promise<DamResult> {
    try {
      const res = await client.get<{ data: DamResult | null }>(`/tools/dam/${companyId}/history/${id}`);
      if (!res.data.data) throw new Error('sin resultado');
      return res.data.data;
    } catch (err) {
      throw toError(err);
    }
  },

  async removeHistory(companyId: number, id: number): Promise<void> {
    try {
      await client.delete(`/tools/dam/${companyId}/history/${id}`);
    } catch (err) {
      throw toError(err);
    }
  },

  async clearHistory(companyId: number): Promise<void> {
    try {
      await client.delete(`/tools/dam/${companyId}/history`);
    } catch (err) {
      throw toError(err);
    }
  },
};
