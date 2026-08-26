import client from '../api/client';
import type { SupervisorDeclaration } from './supervisors';

/** Datos de planilla PDT 601 del período (salida del backend). */
export interface Pdt601Planilla {
  sin_planilla: boolean;
  trabajadores_onp: number;
  trabajadores_afp: number;
  trabajadores_total: number;
  essalud: number;
  onp: number;
  afp: number;
  sis: number;
  rta_4ta: number;
  rta_5ta: number;
  rh: number;
  total_aportes: number;
  fecha_entrega?: string | null;
  hora_entrega?: string;
  observaciones: string;
  fecha_declaracion_pdt?: string | null;
  nps: string;
  ticket_afp: string;
  estado_envio_boletas: string;
  fecha_envio_nps_tickets_boletas?: string | null;
}

/** Cuerpo que envía el supervisor al guardar la planilla (fechas como AAAA-MM-DD). */
export interface Pdt601PlanillaInput {
  sin_planilla: boolean;
  trabajadores_onp: number;
  trabajadores_afp: number;
  essalud: number;
  onp: number;
  afp: number;
  sis: number;
  rta_4ta: number;
  rta_5ta: number;
  rh: number;
  fecha_entrega: string;
  hora_entrega: string;
  observaciones: string;
  fecha_declaracion_pdt: string;
  nps: string;
  ticket_afp: string;
  estado_envio_boletas: string;
  fecha_envio_nps_tickets_boletas: string;
}

/**
 * Cumplimiento de la fecha de entrega vs. la regla configurada en
 * /settings/activity-configuration para la actividad "PDT 601" del calendario financiero
 * del período. 'no_rule' si esa actividad aún no está en el calendario de ese período.
 */
export type Pdt601Timeliness = 'on_time' | 'late' | 'pending' | 'missing' | 'exempt' | 'no_rule';

export interface Pdt601ListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id?: number;
  declaration_id?: number;
  status: string;
  due_date?: string;
  is_overdue: boolean;
  days_remaining?: number | null;
  attachment_count: number;
  last_stored_at?: string;
  planilla?: Pdt601Planilla | null;
  timeliness: Pdt601Timeliness;
}

export interface Pdt601Detail {
  period_ym: string;
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id: number;
  control_due_date?: string;
  declaration: SupervisorDeclaration;
  planilla?: Pdt601Planilla | null;
}

export interface Pdt601ListResponse {
  data: Pdt601ListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export const pdt601Service = {
  async list(params: {
    period_ym: string;
    q?: string;
    status?: string;
    dig?: string;
    assistant_user_id?: number;
    page?: number;
    per_page?: number;
  }): Promise<Pdt601ListResponse> {
    const res = await client.get<Pdt601ListResponse>('/supervisors/activity-modules/pdt-601', { params });
    return res.data;
  },

  async getDetail(companyId: number, periodYm: string): Promise<Pdt601Detail> {
    const res = await client.get<{ data: Pdt601Detail }>(
      `/supervisors/activity-modules/pdt-601/companies/${companyId}`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  /** Lectura pura de la planilla del período (sin crear control/declaración PDT 601). */
  async getPlanillaOnly(companyId: number, periodYm: string): Promise<Pdt601Planilla | null> {
    const res = await client.get<{ data: Pdt601Planilla | null }>(
      `/supervisors/activity-modules/pdt-601/companies/${companyId}/planilla`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  async savePlanilla(
    companyId: number,
    periodYm: string,
    body: Pdt601PlanillaInput,
  ): Promise<Pdt601Detail> {
    const res = await client.put<{ data: Pdt601Detail }>(
      `/supervisors/activity-modules/pdt-601/companies/${companyId}/planilla`,
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
  }): Promise<Pdt601ListRow[]> {
    const res = await client.get<{ data: Pdt601ListRow[] }>('/supervisors/activity-modules/pdt-601/export', {
      params,
    });
    return res.data.data;
  },
};
