import client from '../api/client';
import { defaultWeekStartForPeriod } from '../utils/mailboxWeek';

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

  /** Todas las empresas del período, por cada semana laborable (para exportación Excel). */
  async fetchAllWeeksData(params: {
    period_ym: string;
    q?: string;
    status?: string;
  }): Promise<{
    captures_per_week: number;
    weeks: SunatInboxWeekOption[];
    weeksData: Record<string, SunatInboxListRow[]>;
  }> {
    const probe = await this.list({
      period_ym: params.period_ym,
      week_start: defaultWeekStartForPeriod(params.period_ym),
      per_page: 1,
      page: 1,
    });
    const weeks = probe.meta?.weeks ?? [];
    const capturesPerWeek = probe.meta?.captures_per_week ?? 2;
    const weeksData: Record<string, SunatInboxListRow[]> = {};

    for (const week of weeks) {
      const rows: SunatInboxListRow[] = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const res = await this.list({
          period_ym: params.period_ym,
          week_start: week.week_start,
          q: params.q,
          status: params.status,
          page,
          per_page: 200,
        });
        rows.push(...(res.data ?? []));
        totalPages = res.pagination?.total_pages ?? 1;
        page += 1;
      }
      weeksData[week.week_start] = rows;
    }

    return { captures_per_week: capturesPerWeek, weeks, weeksData };
  },
};
