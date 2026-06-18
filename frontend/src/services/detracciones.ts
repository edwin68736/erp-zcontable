import client from '../api/client';
import type { SupervisorDeclaration } from './supervisors';

export type DetraccionesTimelinessCode =
  | 'on_time'
  | 'late'
  | 'pending'
  | 'missing'
  | 'exempt'
  | 'no_rule';

export interface DetraccionesTimeliness {
  timeliness: DetraccionesTimelinessCode;
  due_at?: string;
  uploaded_at?: string;
}

export interface DetraccionesListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id?: number;
  declaration_id?: number;
  status: string;
  attachment_count: number;
  last_stored_at?: string;
  file_name?: string;
  file_url?: string;
  timeliness: DetraccionesTimeliness;
}

export interface DetraccionesDetail {
  period_ym: string;
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id: number;
  declaration: SupervisorDeclaration;
  timeliness: DetraccionesTimeliness;
}

export interface DetraccionesListResponse {
  data: DetraccionesListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export const detraccionesService = {
  async list(params: {
    period_ym: string;
    q?: string;
    status?: string;
    page?: number;
    per_page?: number;
  }): Promise<DetraccionesListResponse> {
    const res = await client.get<DetraccionesListResponse>('/supervisors/activity-modules/detracciones', { params });
    return res.data;
  },

  async getDetail(companyId: number, periodYm: string): Promise<DetraccionesDetail> {
    const res = await client.get<{ data: DetraccionesDetail }>(
      `/supervisors/activity-modules/detracciones/companies/${companyId}`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  async uploadPdf(companyId: number, periodYm: string, file: File): Promise<DetraccionesDetail> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await client.post<{ data: DetraccionesDetail }>(
      `/supervisors/activity-modules/detracciones/companies/${companyId}/upload`,
      fd,
      { params: { period_ym: periodYm }, headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  async verify(declarationId: number): Promise<SupervisorDeclaration> {
    const res = await client.post<{ data: SupervisorDeclaration }>(
      `/supervisors/activity-modules/detracciones/declarations/${declarationId}/verify`,
    );
    return res.data.data;
  },

  async setSupervisorStatus(declarationId: number, status: 'sin_clave' | 'no_corresponde'): Promise<SupervisorDeclaration> {
    const res = await client.put<{ data: SupervisorDeclaration }>(
      `/supervisors/activity-modules/detracciones/declarations/${declarationId}/status`,
      { status },
    );
    return res.data.data;
  },

  /** @deprecated usar verify */
  async validate(declarationId: number): Promise<SupervisorDeclaration> {
    return this.verify(declarationId);
  },
};
