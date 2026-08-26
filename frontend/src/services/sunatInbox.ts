import client from '../api/client';

export type MailboxType = 'sunat' | 'sunafil';

export interface SunatInboxMailboxSide {
  status: string;
  attachment_id?: number;
  file_name?: string;
  file_url?: string;
  uploaded_at?: string;
  verified_at?: string;
  timeliness?: {
    timeliness: string;
    due_at?: string;
    uploaded_at?: string;
  };
}

export interface SunatInboxCaptureSlot {
  id?: number;
  slot_index: number;
  sunat: SunatInboxMailboxSide;
  sunafil: SunatInboxMailboxSide;
}

export interface SunatInboxWeekOption {
  week_start: string;
  week_index: number;
  label: string;
  date_range?: string;
}

export interface SunatInboxListMeta {
  captures_per_week: number;
  week_start: string;
  weeks: SunatInboxWeekOption[];
}

export interface SunatInboxListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  supervisor_username: string;
  control_id?: number;
  declaration_id?: number;
  summary_status: string;
  slots: SunatInboxCaptureSlot[];
}

export interface SunatInboxDetail {
  period_ym: string;
  week_start: string;
  captures_per_week: number;
  weeks: SunatInboxWeekOption[];
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id: number;
  declaration_id: number;
  slots: SunatInboxCaptureSlot[];
  summary_status: string;
}

export interface SunatInboxListResponse {
  meta: SunatInboxListMeta;
  data: SunatInboxListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

/** Fila por empresa para el reporte Excel: capturas de TODAS las semanas del período (no solo una). */
export interface SunatInboxExportRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  supervisor_username: string;
  weeks: Record<string, SunatInboxCaptureSlot[]>;
}

export interface SunatInboxExportResponse {
  meta: SunatInboxListMeta;
  data: SunatInboxExportRow[];
}

/** Vista "Mes completo" en pantalla: mismas filas que el reporte Excel, pero paginadas. */
export interface SunatInboxMonthListResponse {
  meta: SunatInboxListMeta;
  data: SunatInboxExportRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export type SunatInboxScope = 'week' | 'month';

export const sunatInboxService = {
  async list(params: {
    period_ym: string;
    week_start?: string;
    q?: string;
    status?: string;
    page?: number;
    per_page?: number;
  }): Promise<SunatInboxListResponse> {
    const res = await client.get<SunatInboxListResponse>('/supervisors/activity-modules/sunat-inbox', { params });
    return res.data;
  },

  async getDetail(companyId: number, periodYm: string, weekStart?: string): Promise<SunatInboxDetail> {
    const res = await client.get<{ data: SunatInboxDetail }>(
      `/supervisors/activity-modules/sunat-inbox/companies/${companyId}`,
      { params: { period_ym: periodYm, week_start: weekStart } },
    );
    return res.data.data;
  },

  async uploadCapture(
    companyId: number,
    slotIndex: number,
    file: File,
    mailboxType: MailboxType,
    periodYm: string,
    weekStart: string,
  ): Promise<SunatInboxCaptureSlot> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mailbox_type', mailboxType);
    const res = await client.post<{ data: SunatInboxCaptureSlot }>(
      `/supervisors/activity-modules/sunat-inbox/companies/${companyId}/slots/${slotIndex}/upload`,
      fd,
      {
        params: { period_ym: periodYm, week_start: weekStart },
        headers: { 'Content-Type': 'multipart/form-data' },
      },
    );
    return res.data.data;
  },

  async verifyCapture(slotId: number, mailboxType: MailboxType): Promise<SunatInboxCaptureSlot> {
    const res = await client.post<{ data: SunatInboxCaptureSlot }>(
      `/supervisors/activity-modules/sunat-inbox/slots/${slotId}/verify`,
      { mailbox_type: mailboxType },
    );
    return res.data.data;
  },

  /**
   * Todas las empresas que matchean los filtros (q, status), con sus capturas — para el reporte
   * Excel. scope="week" exporta solo week_start (igual que la tabla en modo semana); scope="month"
   * (o si se omite) exporta todas las semanas del período. Una sola llamada al backend (antes se
   * hacía una llamada paginada por cada semana del período, repitiendo trabajo de BD).
   */
  async fetchExportData(params: {
    period_ym: string;
    week_start?: string;
    q?: string;
    status?: string;
    scope?: SunatInboxScope;
  }): Promise<SunatInboxExportResponse> {
    const res = await client.get<SunatInboxExportResponse>('/supervisors/activity-modules/sunat-inbox/export', {
      params,
    });
    return res.data;
  },

  /** Vista "Mes completo": cada fila trae las capturas de TODAS las semanas del período, paginada. */
  async listMonth(params: {
    period_ym: string;
    q?: string;
    status?: string;
    page?: number;
    per_page?: number;
  }): Promise<SunatInboxMonthListResponse> {
    const res = await client.get<SunatInboxMonthListResponse>('/supervisors/activity-modules/sunat-inbox/month', {
      params,
    });
    return res.data;
  },
};
