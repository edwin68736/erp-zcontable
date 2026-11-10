import client from '../api/client';

export type BuzonStatus = 'ok' | 'error' | 'sin_clave' | 'credenciales_rechazadas';

/** Estado de la última sincronización del buzón de una empresa. */
export interface BuzonSync {
  company_id: number;
  status: BuzonStatus;
  error_code?: string;
  error_message?: string;
  last_attempt_at?: string;
  last_success_at?: string;
  /** manual, nocturna (1:00 a. m.) o programada (pasadas del día). */
  source: 'manual' | 'nocturna' | 'programada';
  duration_ms: number;
  notificaciones: number;
  mensajes: number;
  no_leidas: number;
  urgentes: number;
  nuevos: number;
  /** NOTIFICACIONES (no mensajes) sin leer en SUNAT que siguen en el buzón. */
  notif_no_leidas: number;
  /** Las credenciales vigentes son las mismas que SUNAT rechazó: no se reintenta hasta corregirlas. */
  blocked: boolean;
}

export interface BuzonMessage {
  id: number;
  cod_mensaje: number;
  /** 1 = mensaje, 2 = notificación. */
  tipo: 1 | 2;
  asunto: string;
  fec_publica?: string;
  fec_publica_texto: string;
  remitente: string;
  cod_etiqueta: string;
  adjuntos: number;
  leido: boolean;
  urgente: boolean;
  destacado: boolean;
  es_nuevo: boolean;
}

export interface BuzonPage {
  rows: BuzonMessage[];
  total: number;
  page: number;
  per_page: number;
}

export interface BuzonDetail {
  state: BuzonSync | null;
  /** Empresa que se está sincronizando ahora (0 = ninguna). */
  running: number;
  messages: BuzonPage;
  etiquetas: Record<string, string>;
}

/** Las notificaciones de SUNAT sin leer de una empresa. */
export interface BuzonUnreadCompany {
  company_id: number;
  code: string;
  business_name: string;
  ruc: string;
  unread: number;
  urgent: number;
  /** Publicación de la más antigua sin leer. */
  oldest?: string;
  last_sync_at?: string;
}

/** Notificaciones sin leer de las empresas del alcance de quien consulta (asistente y supervisor: las suyas; administrador: todas). */
export interface BuzonUnreadSummary {
  total: number;
  urgent: number;
  companies: BuzonUnreadCompany[];
  /** Empresas del alcance que no se pudieron revisar: ahí «sin avisos» no significa «sin notificaciones». */
  unchecked: { rejected: number; error: number };
}

export interface BuzonFilters {
  tipo?: 0 | 1 | 2;
  etiqueta?: string;
  no_leidas?: boolean;
  urgentes?: boolean;
  nuevos?: boolean;
  q?: string;
  page?: number;
  per_page?: number;
}

export interface BuzonApiError {
  message: string;
  code?: string;
  detail?: string;
  state?: BuzonSync | null;
}

function toError(err: unknown, fallback: string): BuzonApiError {
  const data = (err as { response?: { data?: { error?: string; code?: string; detail?: string; state?: BuzonSync } } }).response?.data;
  if (data?.error) return { message: data.error, code: data.code, detail: data.detail, state: data.state };
  const net = err as { code?: string; message?: string };
  if (net.code === 'ECONNABORTED') return { message: 'La sincronización tardó demasiado. Intente de nuevo.', code: 'timeout' };
  return { message: fallback, detail: net.message };
}

export const sunatBuzonService = {
  async summary(ids: number[]): Promise<{ data: Record<string, BuzonSync>; running: number }> {
    if (ids.length === 0) return { data: {}, running: 0 };
    try {
      const res = await client.get<{ data: Record<string, BuzonSync>; running: number }>('/tools/buzon/summary', { params: { ids: ids.join(',') } });
      return { data: res.data.data ?? {}, running: res.data.running ?? 0 };
    } catch (err) {
      throw toError(err, 'No se pudo leer el estado de las sincronizaciones.');
    }
  },

  async unread(): Promise<BuzonUnreadSummary> {
    try {
      const res = await client.get<{ data: BuzonUnreadSummary }>('/tools/buzon/unread');
      return res.data.data;
    } catch (err) {
      throw toError(err, 'No se pudieron leer las notificaciones sin leer.');
    }
  },

  async get(companyId: number, f: BuzonFilters): Promise<BuzonDetail> {
    try {
      const res = await client.get<BuzonDetail>(`/tools/buzon/${companyId}`, {
        params: {
          tipo: f.tipo || undefined,
          etiqueta: f.etiqueta || undefined,
          no_leidas: f.no_leidas ? 1 : undefined,
          urgentes: f.urgentes ? 1 : undefined,
          nuevos: f.nuevos ? 1 : undefined,
          q: f.q?.trim() || undefined,
          page: f.page,
          per_page: f.per_page,
        },
      });
      return res.data;
    } catch (err) {
      throw toError(err, 'No se pudo leer el buzón guardado.');
    }
  },

  /** Entra a SUNAT con la clave guardada y actualiza el buzón de la empresa. */
  async sync(companyId: number): Promise<BuzonSync> {
    try {
      const res = await client.post<{ state: BuzonSync }>(`/tools/buzon/${companyId}/sync`, undefined, { timeout: 120000 });
      return res.data.state;
    } catch (err) {
      throw toError(err, 'No se pudo sincronizar el buzón con SUNAT.');
    }
  },

  async markSeen(companyId: number): Promise<BuzonSync | null> {
    try {
      const res = await client.post<{ state: BuzonSync | null }>(`/tools/buzon/${companyId}/seen`);
      return res.data.state;
    } catch (err) {
      throw toError(err, 'No se pudo marcar como visto.');
    }
  },
};
