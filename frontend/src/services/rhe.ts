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
};
