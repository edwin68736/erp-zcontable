import client from '../api/client';
import type { SupervisorDeclaration } from './supervisors';

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
};
