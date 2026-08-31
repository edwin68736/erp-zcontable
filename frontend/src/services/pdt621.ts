import client from '../api/client';
import type { SupervisorDeclaration } from './supervisors';

/** Cumplimiento de fecha_declaracion vs. el cronograma SUNAT por dígito de RUC del período. */
export type Pdt621Timeliness = 'on_time' | 'late' | 'pending' | 'missing' | 'exempt' | 'no_rule';

/** Seguimiento manual PDT 621 del período (revisión de archivadores, importes, SIRE). */
export interface Pdt621Record {
  primera_entrega_fecha?: string | null;
  primera_entrega_hora: string;
  observacion: string;
  segunda_entrega_fecha?: string | null;
  segunda_entrega_hora: string;
  fecha_declaracion?: string | null;
  total_ventas: number;
  total_compras: number;
  igv: number;
  rta: number;
  /** Cantidad de comprobantes (NO montos) — solo registro manual, nunca se sincroniza desde la
   * liquidación. */
  cantidad_comprobantes_venta: number;
  cantidad_comprobantes_compra: number;
  envio_sire: string;
  fecha_envio_sire?: string | null;
  motivo_no_envio: string;
}

/** Cuerpo que envía el supervisor al guardar el seguimiento (fechas como AAAA-MM-DD). */
export interface Pdt621RecordInput {
  primera_entrega_fecha: string;
  primera_entrega_hora: string;
  observacion: string;
  segunda_entrega_fecha: string;
  segunda_entrega_hora: string;
  fecha_declaracion: string;
  total_ventas: number;
  total_compras: number;
  igv: number;
  rta: number;
  cantidad_comprobantes_venta: number;
  cantidad_comprobantes_compra: number;
  envio_sire: string;
  fecha_envio_sire: string;
  motivo_no_envio: string;
}

export interface Pdt621ListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  tax_regime: string;
  assistant_username: string;
  control_id?: number;
  declaration_id?: number;
  status: string;
  due_date?: string;
  is_overdue: boolean;
  days_remaining?: number | null;
  attachment_count: number;
  last_stored_at?: string;
  record?: Pdt621Record | null;
  schedule_due_date?: string;
  declaration_timeliness: Pdt621Timeliness;
  /** Cumplimiento del plazo INTERNO del estudio (calendario de actividades, tipo "pdt_621") para
   * que el asistente haga la primera entrega — distinto de declaration_timeliness (cronograma
   * SUNAT). No valida nada contra SUNAT, solo la entrega interna del asistente. */
  assistant_timeliness: Pdt621Timeliness;
}

export interface Pdt621Detail {
  period_ym: string;
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  tax_regime: string;
  assistant_username: string;
  control_id: number;
  control_due_date?: string;
  declaration: SupervisorDeclaration;
  record?: Pdt621Record | null;
}

export interface Pdt621ListResponse {
  data: Pdt621ListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export const pdt621Service = {
  async list(params: {
    period_ym: string;
    q?: string;
    status?: string;
    dig?: string;
    assistant_user_id?: number;
    page?: number;
    per_page?: number;
  }): Promise<Pdt621ListResponse> {
    const res = await client.get<Pdt621ListResponse>('/supervisors/activity-modules/pdt-621', { params });
    return res.data;
  },

  async getDetail(companyId: number, periodYm: string): Promise<Pdt621Detail> {
    const res = await client.get<{ data: Pdt621Detail }>(
      `/supervisors/activity-modules/pdt-621/companies/${companyId}`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  /** Lectura pura del seguimiento del período (sin crear control/declaración PDT 621). */
  async getRecord(companyId: number, periodYm: string): Promise<Pdt621Record | null> {
    const res = await client.get<{ data: Pdt621Record | null }>(
      `/supervisors/activity-modules/pdt-621/companies/${companyId}/record`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  async saveRecord(companyId: number, periodYm: string, body: Pdt621RecordInput): Promise<Pdt621Detail> {
    const res = await client.put<{ data: Pdt621Detail }>(
      `/supervisors/activity-modules/pdt-621/companies/${companyId}/record`,
      body,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  /** Todas las empresas que matchean los filtros (sin paginar) — para el reporte Excel. */
  async fetchExportData(params: {
    period_ym: string;
    q?: string;
    status?: string;
    dig?: string;
    assistant_user_id?: number;
  }): Promise<Pdt621ListRow[]> {
    const res = await client.get<{ data: Pdt621ListRow[] }>('/supervisors/activity-modules/pdt-621/export', {
      params,
    });
    return res.data.data;
  },
};
