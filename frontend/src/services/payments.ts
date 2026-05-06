import client from '../api/client';
import type { Payment, TukifacFiscalReceipt } from '../types/dashboard';

export interface PaymentsListParams {
  company_id?: string;
  document_id?: string;
  type?: string;
  date_from?: string;
  date_to?: string;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface PaymentUpsertInput {
  company_id: number;
  document_id?: number;
  type?: 'applied' | 'on_account';
  date?: string;
  amount: number;
  method?: string;
  reference?: string;
  attachment?: string;
  notes?: string;
  fiscal_status?: string;
  allocation_mode?: string;
  allocations?: { document_id: number; amount: number }[];
  /** Solo liquidación emitida; imputación manual suele venir precargada desde la liquidación. */
  tax_settlement_id?: number;
}

/** Cuerpo para POST /payments/:id/issue-tukifac (emisión Tukifac desde pago de liquidación). */
export interface PaymentTukifacIssuePayload {
  kind: 'boleta' | 'factura' | 'sale_note';
  serie_documento?: string;
  sale_note_series_id?: number;
  /** Nota de venta: ID establecimiento en Tukifac; si no se envía, usa TUKIFAC_ESTABLISHMENT_ID en el servidor (por defecto 1). */
  establishment_id?: number;
  payment_method_type_id?: string;
  payment_destination_id?: string;
  payment_reference?: string;
}

export const paymentsService = {
  async list(params: PaymentsListParams = {}): Promise<Payment[]> {
    const res = await client.get<{ data: Payment[] }>('/payments', { params });
    return res.data?.data ?? [];
  },

  async listPaged(params: PaymentsListParams & { page: number; per_page: number }): Promise<{
    items: Payment[];
    pagination: PaginationMeta;
  }> {
    const res = await client.get<{ data: Payment[]; pagination: PaginationMeta }>('/payments', { params });
    return {
      items: res.data?.data ?? [],
      pagination: res.data?.pagination ?? { page: params.page, per_page: params.per_page, total: 0, total_pages: 0 },
    };
  },

  async get(id: number): Promise<Payment> {
    const res = await client.get<Payment>(`/payments/${id}`);
    return res.data;
  },

  async create(input: PaymentUpsertInput): Promise<Payment> {
    const res = await client.post<Payment>('/payments', input);
    return res.data;
  },

  async issueTukifacFromPayment(
    id: number,
    body: PaymentTukifacIssuePayload,
  ): Promise<{ receipt: TukifacFiscalReceipt; tukifac_response: unknown }> {
    const res = await client.post<{ receipt: TukifacFiscalReceipt; tukifac_response: unknown }>(
      `/payments/${id}/issue-tukifac`,
      body,
    );
    return res.data;
  },

  async update(id: number, input: PaymentUpsertInput): Promise<Payment> {
    const res = await client.put<Payment>(`/payments/${id}`, input);
    return res.data;
  },

  async delete(id: number): Promise<void> {
    await client.delete(`/payments/${id}`);
  },

  async uploadAttachment(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const res = await client.post<{ success: boolean; data: { url: string } }>('/payments/upload-attachment', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data.url;
  },
};
