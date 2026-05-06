import client from '../api/client';
import type { Company } from '../types/dashboard';

export interface FinancialCompanyRow {
  company: Company;
  total_documents: number;
  total_payments: number;
  balance: number;
  max_overdue_months: number;
  has_overdue: boolean;
  oldest_open_debt_period?: string;
}

export interface FinancialReportResponse {
  total_documents_amount: number;
  total_payments_amount: number;
  global_balance: number;
  rows: FinancialCompanyRow[];
}

export interface FinancialReportQuery {
  date_from?: string;
  date_to?: string;
  company_id?: string;
  /** 1–24: solo empresas con al menos N meses de atraso respecto al periodo contable del cargo con saldo. */
  min_overdue_months?: string;
}

export const reportsService = {
  async getFinancialReport(query?: FinancialReportQuery): Promise<FinancialReportResponse> {
    const params: Record<string, string> = { include: 'companies' };
    if (query?.date_from?.trim()) params.date_from = query.date_from.trim();
    if (query?.date_to?.trim()) params.date_to = query.date_to.trim();
    if (query?.company_id?.trim()) params.company_id = query.company_id.trim();
    if (query?.min_overdue_months?.trim()) params.min_overdue_months = query.min_overdue_months.trim();

    const res = await client.get<FinancialReportResponse>('/reports/financial', { params });
    return {
      total_documents_amount: res.data?.total_documents_amount ?? 0,
      total_payments_amount: res.data?.total_payments_amount ?? 0,
      global_balance: res.data?.global_balance ?? 0,
      rows: (res.data?.rows ?? []).map((r) => ({
        ...r,
        max_overdue_months: Number(r.max_overdue_months) || 0,
        has_overdue: Boolean(r.has_overdue),
        oldest_open_debt_period: String(r.oldest_open_debt_period ?? '').trim(),
      })),
    };
  },
};
