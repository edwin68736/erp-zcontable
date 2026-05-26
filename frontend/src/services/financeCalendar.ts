import client from '../api/client';

export interface FinanceCalendarMonth {
  id: number;
  period_ym: string;
  notes?: string;
  is_closed?: boolean;
  closed_at?: string;
}

export interface FinanceCalendarMark {
  id: number;
  calendar_id: number;
  mark_date: string;
  kind: string;
  label: string;
}

export interface FinanceCalendarActivity {
  id: number;
  calendar_id: number;
  name: string;
  description?: string;
  start_day: number;
  end_day: number;
  due_day: number;
  activity_kind: string;
  priority: string;
  status: string;
  start_date?: string;
  end_date?: string;
  due_date?: string;
  traffic_light?: string;
}

export interface FinanceCalendarDetail {
  id: number;
  period_ym: string;
  notes?: string;
  is_closed?: boolean;
  closed_at?: string;
  marks?: FinanceCalendarMark[];
  activities?: FinanceCalendarActivity[];
}

export interface CalendarComplianceCompany {
  company_id: number;
  company_name: string;
  company_ruc: string;
  control_id?: number;
  status: string;
  traffic_light: string;
  detail?: string;
}

export interface CalendarComplianceSummary {
  activity_id: number;
  activity_name: string;
  due_date: string;
  traffic_light: string;
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  companies: CalendarComplianceCompany[];
}

export interface DuplicateCalendarOptions {
  copy_activities?: boolean;
  copy_marks?: boolean;
  copy_notes?: boolean;
}

function unwrap<T>(res: { data: { data: T } }): T {
  return res.data.data;
}

export const financeCalendarService = {
  async list(): Promise<FinanceCalendarMonth[]> {
    const res = await client.get<{ data: FinanceCalendarMonth[] }>('/finance/calendar/');
    return res.data.data ?? [];
  },

  async get(periodYm: string): Promise<FinanceCalendarDetail> {
    const res = await client.get<{ data: FinanceCalendarDetail }>(`/finance/calendar/${periodYm}`);
    return unwrap(res);
  },

  async create(periodYm: string, notes = ''): Promise<FinanceCalendarMonth> {
    const res = await client.post<{ data: FinanceCalendarMonth }>('/finance/calendar/', { period_ym: periodYm, notes });
    return unwrap(res);
  },

  async updateNotes(id: number, notes: string): Promise<FinanceCalendarMonth> {
    const res = await client.put<{ data: FinanceCalendarMonth }>(`/finance/calendar/months/${id}`, { notes });
    return unwrap(res);
  },

  async close(id: number): Promise<FinanceCalendarMonth> {
    const res = await client.put<{ data: FinanceCalendarMonth }>(`/finance/calendar/months/${id}/close`);
    return unwrap(res);
  },

  async reopen(id: number): Promise<FinanceCalendarMonth> {
    const res = await client.put<{ data: FinanceCalendarMonth }>(`/finance/calendar/months/${id}/reopen`);
    return unwrap(res);
  },

  async remove(id: number): Promise<void> {
    await client.delete(`/finance/calendar/months/${id}`);
  },

  async duplicate(fromPeriodYm: string, toPeriodYm: string, opts: DuplicateCalendarOptions = {}) {
    const res = await client.post<{ data: FinanceCalendarMonth }>('/finance/calendar/duplicate', {
      from_period_ym: fromPeriodYm,
      to_period_ym: toPeriodYm,
      copy_activities: opts.copy_activities ?? true,
      copy_marks: opts.copy_marks ?? true,
      copy_notes: opts.copy_notes ?? true,
    });
    return unwrap(res);
  },

  async addMark(calendarId: number, mark_date: string, kind: string, label: string) {
    const res = await client.post<{ data: FinanceCalendarMark }>(`/finance/calendar/months/${calendarId}/marks`, {
      mark_date,
      kind,
      label,
    });
    return unwrap(res);
  },

  async removeMark(id: number): Promise<void> {
    await client.delete(`/finance/calendar/marks/${id}`);
  },

  async addActivity(
    calendarId: number,
    body: {
      name: string;
      description?: string;
      start_day: number;
      end_day: number;
      due_day: number;
      activity_kind: string;
      priority: string;
      status?: string;
    },
  ) {
    const res = await client.post<{ data: FinanceCalendarActivity }>(
      `/finance/calendar/months/${calendarId}/activities`,
      body,
    );
    return unwrap(res);
  },

  async updateActivity(
    id: number,
    body: Partial<{
      name: string;
      description: string;
      start_day: number;
      end_day: number;
      due_day: number;
      activity_kind: string;
      priority: string;
      status: string;
    }>,
  ) {
    const res = await client.put<{ data: FinanceCalendarActivity }>(`/finance/calendar/activities/${id}`, body);
    return unwrap(res);
  },

  async removeActivity(id: number): Promise<void> {
    await client.delete(`/finance/calendar/activities/${id}`);
  },

  async compliance(activityId: number, periodYm?: string): Promise<CalendarComplianceSummary> {
    const res = await client.get<{ data: CalendarComplianceSummary }>(
      `/finance/calendar/activities/${activityId}/compliance`,
      { params: periodYm ? { period_ym: periodYm } : undefined },
    );
    return unwrap(res);
  },
};
