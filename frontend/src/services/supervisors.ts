import client from '../api/client';

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface SupervisorPeriod {
  id: number;
  period_ym: string;
  status: string;
  notes?: string;
  closed_at?: string;
  closed_by_user_id?: number;
}

export interface SupervisorCompanyRef {
  id: number;
  business_name?: string;
  ruc?: string;
}

export interface SupervisorUserRef {
  id: number;
  full_name?: string;
  username?: string;
}

export interface SupervisorMonthlyControl {
  id: number;
  company_id: number;
  period_ym: string;
  tax_regime?: string;
  responsible_user_id?: number;
  supervisor_user_id?: number;
  due_date?: string;
  general_status: string;
  risk_level: string;
  observations?: string;
  info_received_at?: string;
  company?: SupervisorCompanyRef;
  responsible?: SupervisorUserRef;
  supervisor?: SupervisorUserRef;
}

export interface SupervisorDeclaration {
  id: number;
  monthly_control_id: number;
  declaration_type: string;
  status: string;
  progress_pct?: number;
  priority?: string;
  due_date?: string;
  responsible_user_id?: number;
  approver_user_id?: number;
  notes?: string;
  responsible?: SupervisorUserRef;
  approver?: SupervisorUserRef;
}

export interface SupervisorTaxLiquidation {
  id: number;
  monthly_control_id: number;
  igv: number;
  renta_mensual: number;
  otros_tributos: number;
  total_pagar: number;
  calculated_at?: string;
  responsible_user_id?: number;
  approver_user_id?: number;
  validation_status: string;
  notes?: string;
  responsible?: SupervisorUserRef;
  approver?: SupervisorUserRef;
}

export interface SupervisorNPS {
  id: number;
  monthly_control_id: number;
  tributo: string;
  importe: number;
  codigo_nps?: string;
  generated_at?: string;
  payment_due_date?: string;
  payment_status: string;
  notes?: string;
}

export interface SupervisorAlert {
  kind: string;
  message: string;
  company_id?: number;
  control_id?: number;
  period_ym?: string;
}

export interface SupervisorDashboardData {
  total_active_companies: number;
  companies_al_dia: number;
  companies_pendiente: number;
  companies_vencido: number;
  companies_without_control: number;
  controls_al_dia: number;
  controls_pendiente: number;
  controls_vencido: number;
  controls_observado: number;
  declarations_observed: number;
  nps_pending: number;
  payments_pending: number;
  monthly_compliance_pct: number;
  by_status: Record<string, number>;
  alerts?: SupervisorAlert[];
  productivity?: SupervisorProductivityRow[];
}

export interface SupervisorBootstrapResult {
  created: number;
  skipped: number;
}

export interface SupervisorReportRow {
  company_name: string;
  company_ruc: string;
  period_ym: string;
  general_status: string;
  risk_level: string;
  compliance_pct: number;
  total_pagar: number;
  nps_pending: number;
  payments_pending: number;
}

function unwrap<T>(res: { data: { data: T } }): T {
  return res.data.data;
}

/** Evita `data: null` del API cuando el slice Go es nil. */
function asList<T>(data: unknown): T[] {
  return Array.isArray(data) ? data : [];
}

export type SupervisorReportKind =
  | 'monthly'
  | 'overdue'
  | 'pending_declarations'
  | 'nps_pending'
  | 'payments_pending'
  | 'productivity'
  | 'observations';

export const supervisorsService = {
  async listPeriods(page = 1, perPage = 20): Promise<{ items: SupervisorPeriod[]; pagination: PaginationMeta }> {
    const res = await client.get<{ data: SupervisorPeriod[]; pagination: PaginationMeta }>('/supervisors/periods', {
      params: { page, per_page: perPage },
    });
    return { items: res.data.data, pagination: res.data.pagination };
  },

  async createPeriod(
    periodYm: string,
    notes = '',
    bootstrapControls = false,
  ): Promise<{ period: SupervisorPeriod; bootstrap?: SupervisorBootstrapResult }> {
    const res = await client.post<{ data: SupervisorPeriod; bootstrap?: SupervisorBootstrapResult }>(
      '/supervisors/periods',
      { period_ym: periodYm, notes, bootstrap_controls: bootstrapControls },
    );
    return { period: res.data.data, bootstrap: res.data.bootstrap };
  },

  async bootstrapPeriodControls(periodId: number): Promise<SupervisorBootstrapResult> {
    const res = await client.post<{ data: SupervisorBootstrapResult }>(
      `/supervisors/periods/${periodId}/bootstrap-controls`,
    );
    return unwrap(res);
  },

  async updatePeriod(id: number, notes: string): Promise<SupervisorPeriod> {
    const res = await client.put<{ data: SupervisorPeriod }>(`/supervisors/periods/${id}`, { notes });
    return unwrap(res);
  },

  async deletePeriod(id: number): Promise<void> {
    await client.delete(`/supervisors/periods/${id}`);
  },

  async closePeriod(id: number): Promise<SupervisorPeriod> {
    const res = await client.post<{ data: SupervisorPeriod }>(`/supervisors/periods/${id}/close`);
    return unwrap(res);
  },

  async listControls(params: {
    period_ym?: string;
    company_id?: string;
    general_status?: string;
    q?: string;
    page?: number;
    per_page?: number;
  }): Promise<{ items: SupervisorMonthlyControl[]; pagination: PaginationMeta }> {
    const res = await client.get<{ data: SupervisorMonthlyControl[]; pagination: PaginationMeta }>(
      '/supervisors/controls',
      { params },
    );
    return { items: res.data.data, pagination: res.data.pagination };
  },

  async getControl(id: number): Promise<SupervisorMonthlyControl> {
    const res = await client.get<{ data: SupervisorMonthlyControl }>(`/supervisors/controls/${id}`);
    return unwrap(res);
  },

  async createControl(body: Record<string, unknown>): Promise<SupervisorMonthlyControl> {
    const res = await client.post<{ data: SupervisorMonthlyControl }>('/supervisors/controls', body);
    return unwrap(res);
  },

  async updateControl(id: number, body: Record<string, unknown>): Promise<SupervisorMonthlyControl> {
    const res = await client.put<{ data: SupervisorMonthlyControl }>(`/supervisors/controls/${id}`, body);
    return unwrap(res);
  },

  async registerInfoReceived(controlId: number): Promise<SupervisorMonthlyControl> {
    const res = await client.post<{ data: SupervisorMonthlyControl }>(
      `/supervisors/controls/${controlId}/info-received`,
    );
    return unwrap(res);
  },

  async deleteControl(id: number): Promise<void> {
    await client.delete(`/supervisors/controls/${id}`);
  },

  async listDeclarations(controlId: number): Promise<SupervisorDeclaration[]> {
    const res = await client.get<{ data: SupervisorDeclaration[] }>(
      `/supervisors/controls/${controlId}/declarations`,
    );
    return res.data.data;
  },

  async updateDeclaration(
    id: number,
    body: {
      status?: string;
      notes?: string;
      responsible_user_id?: number | null;
      approver_user_id?: number | null;
      progress_pct?: number;
      priority?: string;
      due_date?: string | null;
    },
  ): Promise<SupervisorDeclaration> {
    const res = await client.put<{ data: SupervisorDeclaration }>(`/supervisors/declarations/${id}`, body);
    return unwrap(res);
  },

  async approveDeclaration(id: number): Promise<SupervisorDeclaration> {
    const res = await client.post<{ data: SupervisorDeclaration }>(`/supervisors/declarations/${id}/approve`);
    return unwrap(res);
  },

  async observeDeclaration(id: number, notes: string): Promise<SupervisorDeclaration> {
    const res = await client.post<{ data: SupervisorDeclaration }>(`/supervisors/declarations/${id}/observe`, {
      notes,
    });
    return unwrap(res);
  },

  async getLiquidation(controlId: number): Promise<SupervisorTaxLiquidation> {
    const res = await client.get<{ data: SupervisorTaxLiquidation }>(
      `/supervisors/controls/${controlId}/liquidation`,
    );
    return unwrap(res);
  },

  async updateLiquidation(
    controlId: number,
    body: {
      igv: number;
      renta_mensual: number;
      otros_tributos: number;
      notes?: string;
      responsible_user_id?: number | null;
      approver_user_id?: number | null;
      validation_status?: string;
    },
  ): Promise<SupervisorTaxLiquidation> {
    const res = await client.put<{ data: SupervisorTaxLiquidation }>(
      `/supervisors/controls/${controlId}/liquidation`,
      body,
    );
    return unwrap(res);
  },

  async approveLiquidation(controlId: number): Promise<SupervisorTaxLiquidation> {
    const res = await client.post<{ data: SupervisorTaxLiquidation }>(
      `/supervisors/controls/${controlId}/liquidation/approve`,
    );
    return unwrap(res);
  },

  async observeLiquidation(controlId: number, notes: string): Promise<SupervisorTaxLiquidation> {
    const res = await client.post<{ data: SupervisorTaxLiquidation }>(
      `/supervisors/controls/${controlId}/liquidation/observe`,
      { notes },
    );
    return unwrap(res);
  },

  async listNPS(controlId: number): Promise<SupervisorNPS[]> {
    const res = await client.get<{ data: SupervisorNPS[] }>(`/supervisors/controls/${controlId}/nps`);
    return res.data.data;
  },

  async createNPS(body: Record<string, unknown>): Promise<SupervisorNPS> {
    const res = await client.post<{ data: SupervisorNPS }>('/supervisors/nps', body);
    return unwrap(res);
  },

  async updateNPS(id: number, body: Record<string, unknown>): Promise<SupervisorNPS> {
    const res = await client.put<{ data: SupervisorNPS }>(`/supervisors/nps/${id}`, body);
    return unwrap(res);
  },

  async generateNPS(id: number): Promise<SupervisorNPS> {
    const res = await client.post<{ data: SupervisorNPS }>(`/supervisors/nps/${id}/generate`);
    return unwrap(res);
  },

  async deleteNPS(id: number): Promise<void> {
    await client.delete(`/supervisors/nps/${id}`);
  },

  async reportMonthly(params: {
    period_ym: string;
    kind?: SupervisorReportKind;
    q?: string;
    page?: number;
    per_page?: number;
  }): Promise<{
    items: SupervisorReportRow[] | SupervisorProductivityRow[] | SupervisorObservationReportRow[];
    pagination?: PaginationMeta;
  }> {
    const res = await client.get<{ data: unknown; pagination?: PaginationMeta }>('/supervisors/reports/monthly', {
      params,
    });
    const kind = params.kind ?? 'monthly';
    if (kind === 'productivity') {
      return { items: asList<SupervisorProductivityRow>(res.data.data) };
    }
    if (kind === 'observations') {
      return {
        items: asList<SupervisorObservationReportRow>(res.data.data),
        pagination: res.data.pagination,
      };
    }
    return {
      items: asList<SupervisorReportRow>(res.data.data),
      pagination: res.data.pagination,
    };
  },

  async listHistory(entityType: string, entityId: number) {
    const res = await client.get<{ data: SupervisorChangeLog[] }>('/supervisors/history', {
      params: { entity_type: entityType, entity_id: entityId },
    });
    return res.data.data;
  },

  async listObservations(controlId?: number, declarationId?: number) {
    const res = await client.get<{ data: SupervisorObservation[] }>('/supervisors/observations', {
      params: { control_id: controlId || undefined, declaration_id: declarationId || undefined },
    });
    return res.data.data;
  },

  async createObservation(body: { monthly_control_id?: number; declaration_id?: number; body: string }) {
    const res = await client.post<{ data: SupervisorObservation }>('/supervisors/observations', body);
    return res.data.data;
  },

  async listAttachments(controlId?: number, declarationId?: number) {
    const res = await client.get<{ data: SupervisorAttachment[] }>('/supervisors/attachments', {
      params: { control_id: controlId || undefined, declaration_id: declarationId || undefined },
    });
    return res.data.data;
  },

  async uploadAttachment(controlId: number, declarationId: number, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    if (controlId > 0) fd.append('control_id', String(controlId));
    if (declarationId > 0) fd.append('declaration_id', String(declarationId));
    const res = await client.post<{ data: SupervisorAttachment }>('/supervisors/attachments/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data;
  },

  async listNotifications(unreadOnly = false) {
    const res = await client.get<{ data: SupervisorNotification[] }>('/supervisors/notifications', {
      params: { unread: unreadOnly ? '1' : '0' },
    });
    return res.data.data;
  },

  async markNotificationRead(id: number) {
    await client.post(`/supervisors/notifications/${id}/read`);
  },

  async registerNPSPayment(id: number) {
    const res = await client.post<{ data: SupervisorNPS }>(`/supervisors/nps/${id}/register-payment`);
    return res.data.data;
  },

  async dashboard(params: {
    period_ym?: string;
    general_status?: string;
    risk_level?: string;
    company_id?: number;
    responsible_user_id?: number;
    supervisor_user_id?: number;
  }): Promise<SupervisorDashboardData> {
    const res = await client.get<{ data: SupervisorDashboardData }>('/supervisors/dashboard', { params });
    return res.data.data;
  },
};

export interface SupervisorChangeLog {
  id: number;
  entity_type: string;
  field_name: string;
  old_value?: string;
  new_value?: string;
  user_id: number;
  created_at: string;
  user?: { name?: string; username?: string };
}

export interface SupervisorObservation {
  id: number;
  body: string;
  created_at: string;
  user?: { name?: string; username?: string };
}

export interface SupervisorAttachment {
  id: number;
  file_name: string;
  file_url: string;
  declaration_id?: number;
  created_at: string;
}

export interface SupervisorNotification {
  id: number;
  kind: string;
  title: string;
  message: string;
  period_ym?: string;
  monthly_control_id?: number;
  read_at?: string;
  created_at: string;
}

export interface SupervisorProductivityRow {
  user_id: number;
  user_name: string;
  total: number;
  al_dia: number;
  compliance_pct: number;
}

export interface SupervisorObservationReportRow {
  id: number;
  company_name: string;
  company_ruc: string;
  body: string;
  author_name: string;
  created_at: string;
  monthly_control_id?: number;
}
