import client from '../api/client';

export interface CredentialFilterUserOption {
  user_id: number;
  username: string;
}

export interface CompanyAccessCredentialFilterFacets {
  assistants: CredentialFilterUserOption[];
  supervisors: CredentialFilterUserOption[];
  claves_sol_dig_colors_json?: string;
}

export interface CompanyAccessCredentialRow {
  company_id: number;
  code: string;
  dig: string;
  ruc: string;
  business_name: string;
  assistant_user_id?: number;
  supervisor_user_id?: number;
  assistant_username: string;
  supervisor_username: string;
  sol_usuario: string;
  sol_clave: string;
  bnl_cuenta: string;
  bnl_dni: string;
  bnl_clave_detracciones: string;
  afp_usuario: string;
  afp_clave: string;
  rnp_clave: string;
  facturador_link: string;
  facturador_usuario: string;
  facturador_contrasena: string;
  credentials_updated_at?: string;
}

export type CompanyAccessCredentialUpdateInput = Omit<
  CompanyAccessCredentialRow,
  'company_id' | 'code' | 'ruc' | 'business_name' | 'assistant_username' | 'supervisor_username' | 'credentials_updated_at'
>;

export interface CompanyAccessCredentialListResponse {
  data: CompanyAccessCredentialRow[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface CredentialImportRowError {
  row: number;
  message: string;
}

export interface CredentialImportValidateResult {
  ok: boolean;
  row_count: number;
  errors: CredentialImportRowError[];
  unmatched_rucs: string[];
  unmatched_count: number;
}

export interface CredentialImportCommitResult {
  ok: boolean;
  updated: number;
  unmatched_rucs: string[];
  unmatched_count: number;
  errors?: CredentialImportRowError[];
}

export const companyAccessCredentialsService = {
  async filterFacets(): Promise<CompanyAccessCredentialFilterFacets> {
    const res = await client.get<{ data: CompanyAccessCredentialFilterFacets }>(
      '/finance/company-credentials/filter-facets',
    );
    return res.data.data;
  },

  async list(params?: {
    q?: string;
    page?: number;
    per_page?: number;
    assistant_user_id?: number;
    supervisor_user_id?: number;
    dig?: string;
  }): Promise<CompanyAccessCredentialListResponse> {
    const res = await client.get<CompanyAccessCredentialListResponse>('/finance/company-credentials/', { params });
    return res.data;
  },

  async get(companyId: number): Promise<CompanyAccessCredentialRow> {
    const res = await client.get<{ data: CompanyAccessCredentialRow }>(`/finance/company-credentials/${companyId}`);
    return res.data.data;
  },

  async update(companyId: number, body: CompanyAccessCredentialUpdateInput): Promise<CompanyAccessCredentialRow> {
    const res = await client.put<{ data: CompanyAccessCredentialRow }>(
      `/finance/company-credentials/${companyId}`,
      body,
    );
    return res.data.data;
  },

  async downloadImportTemplate(): Promise<void> {
    const res = await client.get<Blob>('/finance/company-credentials/import/template', { responseType: 'blob' });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_claves_acceso_empresas.xlsx';
    a.click();
    window.URL.revokeObjectURL(url);
  },

  async importValidate(file: File): Promise<CredentialImportValidateResult> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await client.post<CredentialImportValidateResult>(
      '/finance/company-credentials/import?dry_run=1',
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data;
  },

  async importCommit(file: File): Promise<CredentialImportCommitResult> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await client.post<CredentialImportCommitResult>('/finance/company-credentials/import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },
};
