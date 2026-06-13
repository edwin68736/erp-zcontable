import client from '../api/client';
import type { Company, TukifacFiscalReceipt } from '../types/dashboard';
import type { DniValidationResult, RucValidationResult } from './companies';
import type { PaginationMeta } from './payments';
import type { Product } from './products';
import type { FiscalSeriesItem } from './fiscalDocumentSeries';

export type PosCartLine = {
  key: string;
  productId?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  isManual: boolean;
};

export type PosSalePaymentPayload = {
  method: string;
  amount: number;
  operation_number?: string;
  proof_url?: string;
};

export type PosSaleIssuePayload = {
  kind: 'boleta' | 'factura' | 'sale_note';
  series_id?: number;
  company_id: number;
  lines: {
    product_id?: number;
    description: string;
    quantity: number;
    unit_price: number;
    is_manual: boolean;
  }[];
  payments: PosSalePaymentPayload[];
  notes?: string;
};

export type FiscalReceiptPaymentRow = {
  id: number;
  method: string;
  amount: number;
  operation_number?: string;
  proof_url?: string;
};

export type FiscalReceiptLine = {
  id: number;
  line_type: string;
  product_id?: number;
  product_name: string;
  description: string;
  internal_code?: string;
  unit_type_id?: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  igv_amount: number;
  line_total: number;
  sort_order?: number;
};

export type PosSaleDetail = TukifacFiscalReceipt & {
  subtotal?: number;
  tax_amount?: number;
  lines?: FiscalReceiptLine[];
  notes?: string;
  payment_method?: string;
  payment_reference?: string;
  payments?: FiscalReceiptPaymentRow[];
  linked_payment?: {
    id?: number;
    date?: string;
    method?: string;
    reference?: string;
    tax_settlement_id?: number | null;
  };
  issued_by_user?: { name?: string; username?: string };
};

export const posSalesService = {
  async listCompanies(): Promise<Company[]> {
    const res = await client.get<{ data: Company[] }>('/pos/companies');
    return res.data?.data ?? [];
  },

  async createQuickCompany(body: {
    ruc: string;
    business_name: string;
    trade_name?: string;
    address?: string;
    phone?: string;
    email?: string;
  }): Promise<Company> {
    const res = await client.post<{ data: Company }>('/pos/companies', body);
    return res.data.data;
  },

  async validateRuc(ruc: string): Promise<RucValidationResult> {
    const res = await client.post<RucValidationResult>('/pos/companies/validate-ruc', { ruc });
    return res.data;
  },

  async validateDni(dni: string): Promise<DniValidationResult> {
    const res = await client.post<DniValidationResult>('/pos/companies/validate-dni', { dni });
    return res.data;
  },

  async listSeries(activeOnly = true): Promise<FiscalSeriesItem[]> {
    const res = await client.get<{ data: FiscalSeriesItem[] }>('/pos/document-series', {
      params: activeOnly ? { active_only: true } : undefined,
    });
    return res.data?.data ?? [];
  },

  async searchProducts(q: string, page = 1): Promise<{ items: Product[]; pagination: PaginationMeta }> {
    const res = await client.get<{ data: Product[]; pagination: PaginationMeta }>('/pos/products', {
      params: { q: q || undefined, page, per_page: 40, active: '1' },
    });
    return { items: res.data?.data ?? [], pagination: res.data?.pagination ?? { page: 1, per_page: 40, total: 0, total_pages: 0 } };
  },

  async emit(body: PosSaleIssuePayload): Promise<PosSaleDetail> {
    const res = await client.post<{ data: PosSaleDetail }>('/pos/sales', body);
    return res.data.data;
  },

  async listHistory(page = 1, perPage = 20): Promise<{ items: TukifacFiscalReceipt[]; pagination: PaginationMeta }> {
    const res = await client.get<{ data: TukifacFiscalReceipt[]; pagination: PaginationMeta }>('/pos/sales', {
      params: { page, per_page: perPage },
    });
    return {
      items: res.data?.data ?? [],
      pagination: res.data?.pagination ?? { page, per_page: perPage, total: 0, total_pages: 0 },
    };
  },

  async getDetail(id: number): Promise<PosSaleDetail> {
    const res = await client.get<{ data: PosSaleDetail }>(`/pos/sales/${id}`);
    return res.data.data;
  },

  async uploadPaymentProof(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const res = await client.post<{ success?: boolean; data?: { url: string } }>(
      '/pos/upload-payment-proof',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    const url = res.data?.data?.url;
    if (!url) throw new Error('No se recibió URL del comprobante');
    return url;
  },
};
