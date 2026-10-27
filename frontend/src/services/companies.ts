import client from '../api/client';
import type { Company, CompanyStatement } from '../types/dashboard';

export interface CompaniesListParams {
  q?: string;
  status?: string;
  /** estudio | externo */
  client_type?: 'estudio' | 'externo';
  /** Orden del listado por código interno: asc (defecto) o desc. */
  code_order?: 'asc' | 'desc';
}

/** Empresa del estudio que ya tiene el RUC que se quiere registrar (respuesta 409 al crear). */
export interface CompanyRucConflict {
  kind: 'activa' | 'inactiva' | 'eliminada';
  company_id: number;
  code: string;
  business_name: string;
  ruc: string;
  status: string;
  deleted_at?: string;
  /** Se puede reactivar desde el alta (inactiva o eliminada). */
  reactivable: boolean;
}

/** Extrae el conflicto de RUC de un error de la API (409 al crear/reactivar), si lo hay. */
export function extractRucConflict(err: unknown): CompanyRucConflict | null {
  const data = (err as { response?: { status?: number; data?: { ruc_conflict?: CompanyRucConflict } } })?.response;
  return data?.status === 409 && data.data?.ruc_conflict ? data.data.ruc_conflict : null;
}

/** true si la API rechazó la reactivación porque el código ya lo usa otra empresa activa. */
export function isCodeConflict(err: unknown): boolean {
  return Boolean((err as { response?: { data?: { code_conflict?: boolean } } })?.response?.data?.code_conflict);
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

export interface DniValidationResult {
  dni: string;
  full_name: string;
}

export interface ExternalCompanyQuickInput {
  ruc: string;
  business_name: string;
  trade_name?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface CompanyUpsertInput {
  ruc: string;
  business_name: string;
  code: string;
  status: string;
  trade_name?: string;
  igv_rate?: string;
  tax_regime?: string;
  address?: string;
  phone?: string;
  email?: string;
  service_start_at?: string;
  accountant_user_id?: number;
  supervisor_user_id?: number;
  assistant_user_id?: number;
  subscription_plan_id?: number | null;
  billing_cycle?: string;
  subscription_ended_at?: string;
  subscription_active?: boolean;
  declared_billing_amount?: number | null;
  /** rh (defecto) | factura. */
  default_payment_document_type?: 'rh' | 'factura';
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

  /**
   * Reactiva una empresa inactiva o eliminada que tiene el mismo RUC que se estaba registrando, aplicando
   * los datos del formulario (conserva su historial). 409 con `ruc_conflict` o `code_conflict` si no se puede.
   */
  async reactivate(id: number, input: CompanyUpsertInput): Promise<Company> {
    const res = await client.post<Company>(`/companies/${id}/reactivate`, input);
    return res.data;
  },

  async update(id: number, input: CompanyUpsertInput): Promise<Company> {
    const res = await client.put<Company>(`/companies/${id}`, input);
    return res.data;
  },

  /**
   * `newCode` solo aplica al REACTIVAR (inactivo → activo): si el código de la empresa ya lo
   * tomó otra empresa activa mientras esta estaba inactiva, el backend responde 409 con
   * `code_conflict: true` — hay que reintentar pasando un código nuevo. Si el código sigue
   * libre, la reactivación no lo necesita.
   */
  async patchStatus(id: number, status: 'activo' | 'inactivo', newCode?: string): Promise<Company> {
    const res = await client.patch<Company>(`/companies/${id}/status`, { status, new_code: newCode });
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

  async validateDni(dni: string): Promise<DniValidationResult> {
    const res = await client.post<DniValidationResult>('/companies/validate-dni', { dni });
    return res.data;
  },

  async convertToStudio(id: number, input: CompanyUpsertInput): Promise<Company> {
    const res = await client.put<Company>(`/companies/${id}/convert-to-studio`, input);
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
