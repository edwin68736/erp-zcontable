import client from '../api/client';
import type { Company, CompanyStatement } from '../types/dashboard';

export interface CompaniesListParams {
  q?: string;
  status?: string;
  /** Orden del listado por código interno: asc (defecto) o desc. */
  code_order?: 'asc' | 'desc';
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface RucValidationResult {
  ruc: string;
  business_name: string;
  address?: string;
  estado?: string;
  condicion?: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
}

export interface CompanyUpsertInput {
  ruc: string;
  business_name: string;
  code: string;
  status: string;
  trade_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  service_start_at?: string;
  accountant_user_id?: number;
  supervisor_user_id?: number;
  assistant_user_id?: number;
  subscription_plan_id?: number | null;
  billing_cycle?: string;
  subscription_started_at?: string;
  subscription_ended_at?: string;
  subscription_active?: boolean;
  declared_billing_amount?: number | null;
}

export const companiesService = {
  /** Siguiente código interno sugerido (4 dígitos, único en BD). */
  async getNextInternalCode(): Promise<string> {
    const res = await client.get<{ code: string }>('/companies/next-internal-code');
    const code = res.data?.code?.trim();
    if (!code) throw new Error('Respuesta inválida del servidor');
    return code;
  },

  async list(params: CompaniesListParams = {}): Promise<Company[]> {
    const res = await client.get<{ data: Company[] }>('/companies', {
      params,
    });
    return res.data?.data ?? [];
  },

  async listPaged(params: CompaniesListParams & { page: number; per_page: number }): Promise<{
    items: Company[];
    pagination: PaginationMeta;
  }> {
    const res = await client.get<{ data: Company[]; pagination: PaginationMeta }>('/companies', { params });
    return {
      items: res.data?.data ?? [],
      pagination: res.data?.pagination ?? { page: params.page, per_page: params.per_page, total: 0, total_pages: 0 },
    };
  },

  async get(id: number): Promise<Company> {
    const res = await client.get<Company>(`/companies/${id}`);
    return res.data;
  },

  async create(input: CompanyUpsertInput): Promise<Company> {
    const res = await client.post<Company>('/companies', input);
    return res.data;
  },

  async update(id: number, input: CompanyUpsertInput): Promise<Company> {
    const res = await client.put<Company>(`/companies/${id}`, input);
    return res.data;
  },

  async patchStatus(id: number, status: 'activo' | 'inactivo'): Promise<Company> {
    const res = await client.patch<Company>(`/companies/${id}/status`, { status });
    return res.data;
  },

  async delete(id: number): Promise<void> {
    await client.delete(`/companies/${id}`);
  },

  /**
   * Estado de cuenta. Use `dateFrom`+`dateTo` (yyyy-MM-dd) para rango inclusivo en Lima, o `period` (yyyy-MM) para un mes.
   * Si se envían ambos, prevalece el rango.
   */
  async getStatement(
    id: number,
    opts?: { period?: string; dateFrom?: string; dateTo?: string },
  ): Promise<CompanyStatement> {
    const params: Record<string, string> = {};
    const from = opts?.dateFrom?.trim();
    const to = opts?.dateTo?.trim();
    if (from && to) {
      params.date_from = from;
      params.date_to = to;
    } else if (opts?.period?.trim()) {
      params.period = opts.period.trim();
    }
    const res = await client.get<CompanyStatement>(`/companies/${id}/statement`, { params });
    return res.data;
  },

  async search(term: string): Promise<Company[]> {
    return this.list({ q: term });
  },

  /** Consulta SUNAT vía ApiPeru.dev (credenciales en Ajustes del estudio). */
  async validateRuc(ruc: string): Promise<RucValidationResult> {
    const res = await client.post<RucValidationResult>('/companies/validate-ruc', { ruc });
    return res.data;
  },

  /** Descarga plantilla Excel (.xlsx) para importación masiva. */
  async downloadImportTemplate(): Promise<void> {
    const res = await client.get<Blob>('/companies/import/template', { responseType: 'blob' });
    const blob = res.data as Blob;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_importacion_empresas.xlsx';
    a.click();
    window.URL.revokeObjectURL(url);
  },

  /** Valida un .xlsx sin guardar (dry_run). */
  async importCompaniesValidate(file: File): Promise<{
    ok: boolean;
    row_count: number;
    errors: Array<{ row: number; message: string }>;
  }> {
    const form = new FormData();
    form.append('file', file);
    const res = await client.post<{
      ok: boolean;
      row_count: number;
      errors: Array<{ row: number; message: string }>;
    }>('/companies/import', form, {
      params: { dry_run: 'true' },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  /** Importa empresas desde .xlsx (misma validación que en dry_run). */
  async importCompaniesCommit(file: File): Promise<{ ok: boolean; created: number }> {
    const form = new FormData();
    form.append('file', file);
    const res = await client.post<{ ok: boolean; created: number }>('/companies/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },
};
