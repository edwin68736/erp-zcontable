import client from '../api/client';
import type { SupervisorDeclaration } from './supervisors';

/**
 * Módulos de "informe en PDF" (Informe detracciones, Siscont balances): el asistente carga UN solo PDF
 * por empresa y período con su fecha de cumplimiento; el supervisor lo aprueba u observa. Mismo
 * backend y mismas formas para ambos — solo cambia el slug de la URL.
 */
export type PdfReportSlug = 'informe-detracciones' | 'siscont-balances';

/** Cumplimiento de la fecha vs. la regla del calendario de actividades; 'no_rule' si el período no
 * tiene la actividad configurada. */
export type PdfReportTimeliness = 'on_time' | 'late' | 'pending' | 'missing' | 'exempt' | 'no_rule';

export interface PdfReportListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id?: number;
  declaration_id?: number;
  /** pendiente | por_revisar | observado | entregado */
  status: string;
  /** Fecha límite del calendario para el grupo de RUC de la empresa (AAAA-MM-DD). */
  due_date?: string;
  /** Fecha de cumplimiento registrada al cargar el PDF (AAAA-MM-DD). */
  fecha_entrega?: string;
  timeliness: PdfReportTimeliness;
  suspendida: boolean;
  attachment_count: number;
  file_name?: string;
  file_url?: string;
  last_stored_at?: string;
  /** Motivo de la observación vigente (solo con estado "observado"). */
  observacion?: string;
}

export interface PdfReportDetail {
  period_ym: string;
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id: number;
  control_suspendida: boolean;
  declaration: SupervisorDeclaration;
  fecha_entrega?: string;
  timeliness: PdfReportTimeliness;
  calendar_due_date?: string;
}

export interface PdfReportListResponse {
  data: PdfReportListRow[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
}

export interface PdfReportFilters {
  period_ym: string;
  q?: string;
  status?: string;
  dig?: string;
  assistant_user_id?: number;
}

export const pdfReportService = {
  async list(slug: PdfReportSlug, params: PdfReportFilters & { page?: number; per_page?: number }) {
    const res = await client.get<PdfReportListResponse>(`/supervisors/activity-modules/${slug}`, { params });
    return res.data;
  },

  async getDetail(slug: PdfReportSlug, companyId: number, periodYm: string): Promise<PdfReportDetail> {
    const res = await client.get<{ data: PdfReportDetail }>(
      `/supervisors/activity-modules/${slug}/companies/${companyId}`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  /** Carga el PDF (reemplaza al anterior) con su fecha de cumplimiento (AAAA-MM-DD; vacía = hoy). */
  async submit(
    slug: PdfReportSlug,
    companyId: number,
    periodYm: string,
    file: File,
    fechaEntrega: string,
  ): Promise<PdfReportDetail> {
    const fd = new FormData();
    fd.append('file', file);
    if (fechaEntrega) fd.append('fecha_entrega', fechaEntrega);
    const res = await client.post<{ data: PdfReportDetail }>(
      `/supervisors/activity-modules/${slug}/companies/${companyId}/submit`,
      fd,
      { params: { period_ym: periodYm }, headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  /** Todas las empresas que matchean los filtros (sin paginar) — para el reporte Excel. */
  async fetchExportData(slug: PdfReportSlug, params: PdfReportFilters): Promise<PdfReportListRow[]> {
    const res = await client.get<{ data: PdfReportListRow[] }>(`/supervisors/activity-modules/${slug}/export`, {
      params,
    });
    return res.data.data;
  },
};
