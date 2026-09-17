import client from '../api/client';
import type { SupervisorDeclaration } from './supervisors';

export type DetraccionesTimelinessCode =
  | 'on_time'
  | 'late'
  | 'pending'
  | 'missing'
  | 'exempt'
  | 'no_rule';

export interface DetraccionesTimeliness {
  timeliness: DetraccionesTimelinessCode;
  due_at?: string;
  uploaded_at?: string;
}

export interface DetraccionesListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id?: number;
  declaration_id?: number;
  status: string;
  attachment_count: number;
  last_stored_at?: string;
  file_name?: string;
  file_url?: string;
  timeliness: DetraccionesTimeliness;
  // suspendida: global por período (docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.7) — solo
  // se marca/desmarca desde este módulo (Control de Detracciones), PDT 601/621/Buzón SOL solo la leen.
  suspendida: boolean;
}

export interface DetraccionesDetail {
  period_ym: string;
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id: number;
  declaration: SupervisorDeclaration;
  timeliness: DetraccionesTimeliness;
  // suspendida: ver comentario en DetraccionesListRow — acá SÍ es editable (checkbox "Marcar como
  // suspendida", único lugar del sistema que la modifica).
  suspendida: boolean;
}

export interface DetraccionesListResponse {
  data: DetraccionesListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

// Modal de arrastre de suspensión entre períodos (docs/diseno-limpieza-control-detail-2026-09-16.md
// §5.9.9) — "suspendida" es por período (§5.9.7), así que un control nuevo siempre nace en false;
// esto avisa si el período anterior tenía empresas suspendidas que nadie decidió reactivar todavía.
export interface SuspensionCarryOverRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
}

export interface SuspensionCarryOverStatus {
  pending: boolean;
  companies: SuspensionCarryOverRow[];
}

export const detraccionesService = {
  async list(params: {
    period_ym: string;
    q?: string;
    status?: string;
    page?: number;
    per_page?: number;
  }): Promise<DetraccionesListResponse> {
    const res = await client.get<DetraccionesListResponse>('/supervisors/activity-modules/detracciones', { params });
    return res.data;
  },

  async getDetail(companyId: number, periodYm: string): Promise<DetraccionesDetail> {
    const res = await client.get<{ data: DetraccionesDetail }>(
      `/supervisors/activity-modules/detracciones/companies/${companyId}`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  async uploadPdf(companyId: number, periodYm: string, file: File): Promise<DetraccionesDetail> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await client.post<{ data: DetraccionesDetail }>(
      `/supervisors/activity-modules/detracciones/companies/${companyId}/upload`,
      fd,
      { params: { period_ym: periodYm }, headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  async verify(declarationId: number): Promise<SupervisorDeclaration> {
    const res = await client.post<{ data: SupervisorDeclaration }>(
      `/supervisors/activity-modules/detracciones/declarations/${declarationId}/verify`,
    );
    return res.data.data;
  },

  async setSupervisorStatus(declarationId: number, status: 'sin_clave' | 'no_corresponde'): Promise<SupervisorDeclaration> {
    const res = await client.put<{ data: SupervisorDeclaration }>(
      `/supervisors/activity-modules/detracciones/declarations/${declarationId}/status`,
      { status },
    );
    return res.data.data;
  },

  // setSuspendida único punto de escritura de "suspendida" en todo el sistema (§5.9.7) — PDT 601/621
  // y Buzón SOL solo la leen desde su propio detalle/listado, nunca la modifican.
  async setSuspendida(companyId: number, periodYm: string, suspendida: boolean): Promise<DetraccionesDetail> {
    const res = await client.put<{ data: DetraccionesDetail }>(
      `/supervisors/activity-modules/detracciones/companies/${companyId}/suspendida`,
      { suspendida },
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  /** @deprecated usar verify */
  async validate(declarationId: number): Promise<SupervisorDeclaration> {
    return this.verify(declarationId);
  },

  // Modal de arrastre de suspensión (§5.9.9) — getSuspensionCarryOverStatus se llama al abrir
  // Control de Detracciones para un período; si pending=true, mostrar el modal con `companies`.
  async getSuspensionCarryOverStatus(periodYm: string): Promise<SuspensionCarryOverStatus> {
    const res = await client.get<{ data: SuspensionCarryOverStatus }>(
      '/supervisors/activity-modules/detracciones/suspension-carry-over',
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  // applySuspensionCarryOver aplica la decisión — `keepSuspendedCompanyIds` son las empresas que se
  // dejaron tildadas (se mantienen suspendidas); las demás candidatas quedan reactivadas. Si otro
  // usuario ya resolvió el arrastre para este período, el backend rechaza con error — el caller debe
  // recargar el estado (getSuspensionCarryOverStatus) en vez de reintentar (§5.9.9.4).
  async applySuspensionCarryOver(periodYm: string, keepSuspendedCompanyIds: number[]): Promise<void> {
    await client.post(
      '/supervisors/activity-modules/detracciones/suspension-carry-over/apply',
      { keep_suspended_company_ids: keepSuspendedCompanyIds },
      { params: { period_ym: periodYm } },
    );
  },
};
