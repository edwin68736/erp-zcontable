import client from '../api/client';
import type { SettlementPreviewLine, TaxSettlement } from '../types/dashboard';

export interface TaxSettlementLineInput {
  line_type: string;
  document_id?: number | null;
  product_id?: number | null;
  concept: string;
  amount: number;
  sort_order?: number;
  /** YYYY-MM periodo de la línea. */
  period_ym?: string;
  /** YYYY-MM-DD legado; si no hay period_ym se puede derivar el mes. */
  period_date?: string;
}

export interface TaxSettlementCreateInput {
  company_id: number;
  issue_date?: string;
  /** YYYY-MM periodo de la liquidación (obligatorio salvo compat. API). */
  liquidation_period?: string;
  period_label?: string;
  period_from?: string | null;
  period_to?: string | null;
  notes?: string;
  pdt621_json?: string;
  lines: TaxSettlementLineInput[];
}

export interface TaxSettlementUpdateInput {
  issue_date?: string;
  liquidation_period?: string;
  period_label?: string;
  period_from?: string | null;
  period_to?: string | null;
  notes?: string;
  pdt621_json?: string;
  lines: TaxSettlementLineInput[];
}

export interface TaxSettlementsPaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface SettlementPaymentSuggestion {
  document_id: number;
  amount: number;
  concept: string;
  settlement_line_amount: number;
  document_number: string;
}

export interface PaymentSuggestionsResponse {
  tax_settlement_id: number;
  settlement_number: string;
  company_id: number;
  status: string;
  lines: SettlementPaymentSuggestion[];
  suggested_total: number;
}

export const taxSettlementsService = {
  async preview(companyId: number, asOf?: string): Promise<SettlementPreviewLine[]> {
    const res = await client.get<{ data: SettlementPreviewLine[] }>(`/companies/${companyId}/settlements/preview`, {
      params: asOf ? { as_of: asOf } : {},
    });
    return res.data?.data ?? [];
  },

  async listPaged(params: {
    company_id?: string;
    status?: string;
    page: number;
    per_page: number;
  }): Promise<{ items: TaxSettlement[]; pagination: TaxSettlementsPaginationMeta }> {
    const res = await client.get<{ data: TaxSettlement[]; pagination: TaxSettlementsPaginationMeta }>('/tax-settlements', {
      params: {
        company_id: params.company_id || undefined,
        status: params.status || undefined,
        page: params.page,
        per_page: params.per_page,
      },
    });
    return {
      items: res.data?.data ?? [],
      pagination:
        res.data?.pagination ?? {
          page: params.page,
          per_page: params.per_page,
          total: 0,
          total_pages: 0,
        },
    };
  },

  async get(id: number): Promise<TaxSettlement> {
    const res = await client.get<TaxSettlement>(`/tax-settlements/${id}`);
    return res.data;
  },

  async create(input: TaxSettlementCreateInput): Promise<TaxSettlement> {
    const res = await client.post<TaxSettlement>('/tax-settlements', input);
    return res.data;
  },

  async update(id: number, input: TaxSettlementUpdateInput): Promise<TaxSettlement> {
    const res = await client.put<TaxSettlement>(`/tax-settlements/${id}`, input);
    return res.data;
  },

  async emit(id: number): Promise<TaxSettlement> {
    const res = await client.post<TaxSettlement>(`/tax-settlements/${id}/emit`, {});
    return res.data;
  },

  async paymentSuggestions(id: number): Promise<PaymentSuggestionsResponse> {
    const res = await client.get<PaymentSuggestionsResponse>(`/tax-settlements/${id}/payment-suggestions`);
    return res.data;
  },

  async delete(id: number): Promise<void> {
    await client.delete(`/tax-settlements/${id}`);
  },
};
