import client from '../api/client';
import type { SupervisorDeclaration } from './supervisors';

export interface Pdt621ListRow {
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
}

export interface Pdt621Detail {
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
};
