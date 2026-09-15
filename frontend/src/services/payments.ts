import client from '../api/client';
import type { Payment, TukifacFiscalReceipt, VoidedPayment } from '../types/dashboard';

export interface PaymentsListParams {
  company_id?: string;
  document_id?: string;
  type?: string;
  date_from?: string;
  date_to?: string;
}

/** Filtros de GET /payments/voided (Fase 7 — vía de auditoría, separada del listado activo). */
export interface VoidedPaymentsListParams {
  company_id?: string;
  document_id?: string;
  voided_from?: string;
  voided_to?: string;
  page?: number;
  per_page?: number;
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
  discount_amount?: number;
  method?: string;
  reference?: string;
  attachment?: string;
  description?: string;
  notes?: string;
  fiscal_status?: string;
  allocation_mode?: string;
  allocations?: { document_id: number; amount: number }[];
  /** Solo liquidación emitida; imputación manual suele venir precargada desde la liquidación. */
  tax_settlement_id?: number;
}

/** Cuerpo para POST /payments/:id/issue-comprobante (emisión local). */
export interface PaymentComprobanteIssuePayload {
  kind: 'boleta' | 'factura' | 'sale_note';
  series_id: number;
  payment_method_type_id?: string;
  payment_destination_id?: string;
  payment_reference?: string;
}

/** @deprecated usar PaymentComprobanteIssuePayload */
export type PaymentTukifacIssuePayload = PaymentComprobanteIssuePayload;

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

  async issueComprobanteFromPayment(
    id: number,
    body: PaymentComprobanteIssuePayload,
  ): Promise<{ receipt: TukifacFiscalReceipt }> {
    const res = await client.post<{ receipt: TukifacFiscalReceipt }>(`/payments/${id}/issue-comprobante`, body);
    return res.data;
  },

  /** @deprecated alias */
  async issueTukifacFromPayment(id: number, body: PaymentComprobanteIssuePayload) {
    return this.issueComprobanteFromPayment(id, body);
  },

  async update(id: number, input: PaymentUpsertInput): Promise<Payment> {
    const res = await client.put<Payment>(`/payments/${id}`, input);
    return res.data;
  },

  /** reason es obligatorio (Fase 6, Blueprint §19: cancelación auditable). */
  async delete(id: number, reason: string): Promise<void> {
    await client.delete(`/payments/${id}`, { data: { reason } });
  },

  /**
   * Fase 7 (docs/diseno-fase7-paso2-ui-reportes-2026-09-15.md D.1): vía de auditoría dedicada — NUNCA
   * usar esta función para poblar el listado activo de pagos ni ningún cálculo financiero.
   */
  async listVoided(params: VoidedPaymentsListParams = {}): Promise<{
    items: VoidedPayment[];
    pagination: PaginationMeta;
  }> {
    const page = params.page ?? 1;
    const perPage = params.per_page ?? 20;
    const res = await client.get<{ data: VoidedPayment[]; pagination: PaginationMeta }>('/payments/voided', {
      params,
    });
    return {
      items: res.data?.data ?? [],
      pagination: res.data?.pagination ?? { page, per_page: perPage, total: 0, total_pages: 0 },
    };
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
