import client from '../api/client';
import type { TukifacFiscalReceipt } from '../types/dashboard';

export interface CreatePaymentFromReceiptInput {
  allocation_mode: 'fifo' | 'manual';
  allocations?: { document_id: number; amount: number }[];
  method?: string;
  reference?: string;
  attachment?: string;
  notes?: string;
  /** Liquidación emitida a la que se asocia el pago generado desde Tukifac */
  tax_settlement_id?: number;
}

export interface FiscalReceiptsListParams {
  status?: string;
  origin?: string;
  company_id?: string;
  ruc?: string;
  number?: string;
  tax_settlement_id?: string;
  needs_settlement?: boolean;
  page: number;
  per_page: number;
}

export interface FiscalReceiptsPaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export const fiscalReceiptsService = {
  async listPaged(params: FiscalReceiptsListParams): Promise<{
    items: TukifacFiscalReceipt[];
    pagination: FiscalReceiptsPaginationMeta;
  }> {
    const res = await client.get<{ data: TukifacFiscalReceipt[]; pagination: FiscalReceiptsPaginationMeta }>(
      '/tukifac/fiscal-receipts',
      {
        params: {
          status: params.status,
          origin: params.origin || undefined,
          company_id: params.company_id || undefined,
          ruc: params.ruc || undefined,
          number: params.number || undefined,
          tax_settlement_id: params.tax_settlement_id || undefined,
          needs_settlement: params.needs_settlement ? '1' : undefined,
          page: params.page,
          per_page: params.per_page,
        },
      },
    );
    return {
      items: res.data?.data ?? [],
      pagination: res.data?.pagination ?? {
        page: params.page,
        per_page: params.per_page,
        total: 0,
        total_pages: 0,
      },
    };
  },

  async createPayment(receiptId: number, body: CreatePaymentFromReceiptInput): Promise<void> {
    await client.post(`/tukifac/fiscal-receipts/${receiptId}/create-payment`, body);
  },

  async linkPayment(receiptId: number, paymentId: number): Promise<void> {
    await client.post(`/tukifac/fiscal-receipts/${receiptId}/link-payment`, { payment_id: paymentId });
  },

  async discard(receiptId: number): Promise<void> {
    await client.post(`/tukifac/fiscal-receipts/${receiptId}/discard`);
  },

  async patchTaxSettlement(
    receiptId: number,
    body: { tax_settlement_id?: number; unlink?: boolean },
  ): Promise<void> {
    await client.patch(`/tukifac/fiscal-receipts/${receiptId}/tax-settlement`, body);
  },
};
