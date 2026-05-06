import client from '../api/client';
import type { Company, Document } from '../types/dashboard';

export interface DocumentsListParams {
  company_id?: string;
  status?: string;
  overdue?: string;
  date_from?: string;
  date_to?: string;
  /** Sin `company_id`: `1` pide listado agrupado por empresa (meta `list_mode: by_company`). */
  group_by_company?: string;
}

/** Fila del listado agrupado por empresa (API `/documents` con `group_by_company=1`). */
export interface CompanyDebtSummary {
  company_id: number;
  company: Company;
  document_count: number;
  open_balance_total: number;
}

export type DocumentsListMode = 'documents' | 'by_company';

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface DocumentItemInput {
  product_id?: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  sort_order: number;
}

export interface DocumentUpsertInput {
  company_id: number;
  external_id?: string;
  type: string;
  /** Si se omite al crear, el backend genera un número interno (DEU-…). */
  number?: string;
  issue_date?: string;
  due_date?: string;
  total_amount: number;
  status: string;
  source?: string;
  description?: string;
  service_month?: string;
  /** Periodo contable YYYY-MM (obligatorio en deudas manuales). */
  accounting_period?: string;
  /** Si se envía, el backend recalcula total_amount como la suma de los ítems. */
  items?: DocumentItemInput[];
}

export interface SyncTukifacResponse {
  message: string;
  documents_processed: number;
  receipts_processed?: number;
  companies_created?: number;
}

export interface TukifacDocumentsListResponse<T> {
  data: T[];
}

export interface TukifacDocumentsListParams {
  start_date?: string;
  end_date?: string;
}

export const documentsService = {
  async list(params: DocumentsListParams = {}): Promise<Document[]> {
    const res = await client.get<{ data: Document[] }>('/documents', { params });
    return res.data?.data ?? [];
  },

  async listPaged(
    params: DocumentsListParams & { page: number; per_page: number },
  ): Promise<{
    list_mode: DocumentsListMode;
    items: Document[];
    company_summaries: CompanyDebtSummary[];
    pagination: PaginationMeta;
  }> {
    const res = await client.get<{
      data: Document[] | CompanyDebtSummary[];
      pagination: PaginationMeta;
      meta?: { list_mode?: string };
    }>('/documents', { params });
    const body = res.data;
    const pagination =
      body?.pagination ?? { page: params.page, per_page: params.per_page, total: 0, total_pages: 0 };
    const listMode: DocumentsListMode = body?.meta?.list_mode === 'by_company' ? 'by_company' : 'documents';
    if (listMode === 'by_company') {
      return {
        list_mode: 'by_company',
        items: [],
        company_summaries: (body?.data ?? []) as CompanyDebtSummary[],
        pagination,
      };
    }
    return {
      list_mode: 'documents',
      items: (body?.data ?? []) as Document[],
      company_summaries: [],
      pagination,
    };
  },

  async get(id: number): Promise<Document> {
    const res = await client.get<Document>(`/documents/${id}`);
    return res.data;
  },

  async create(input: DocumentUpsertInput): Promise<Document> {
    const res = await client.post<Document>('/documents', input);
    return res.data;
  },

  async update(id: number, input: DocumentUpsertInput): Promise<Document> {
    const res = await client.put<Document>(`/documents/${id}`, input);
    return res.data;
  },

  async delete(id: number): Promise<void> {
    await client.delete(`/documents/${id}`);
  },

  async syncTukifac(params: TukifacDocumentsListParams = {}): Promise<SyncTukifacResponse> {
    const res = await client.post<SyncTukifacResponse>('/documents/sync-tukifac', undefined, { params });
    return res.data;
  },

  async listTukifacDocuments<T = unknown>(params: TukifacDocumentsListParams = {}): Promise<T[]> {
    const res = await client.get<TukifacDocumentsListResponse<T>>('/tukifac/documents/lists', { params });
    return res.data?.data ?? [];
  },

  /** Listado remoto de notas de venta (API Tukifac sale-note/lists). */
  async listTukifacSaleNotes<T = unknown>(params: TukifacDocumentsListParams = {}): Promise<T[]> {
    const res = await client.get<TukifacDocumentsListResponse<T>>('/tukifac/sale-note/lists', { params });
    return res.data?.data ?? [];
  },

  /** Importa notas de venta a la bandeja de conciliación (mismo flujo que facturas/boletas). */
  async syncTukifacSaleNotes(params: TukifacDocumentsListParams = {}): Promise<SyncTukifacResponse> {
    const res = await client.post<SyncTukifacResponse>('/tukifac/sale-note/sync', undefined, { params });
    return res.data;
  },
};
