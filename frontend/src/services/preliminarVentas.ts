import client from '../api/client';
import type { SupervisorDeclaration } from './supervisors';

export interface PreliminarVentasListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  status: string;
  suspendida: boolean;
}

export interface PreliminarVentasListResponse {
  data: PreliminarVentasListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

/** Lo único que registra el asistente — Ventas (Base Imponible + No Gravadas por concepto) y,
 * opcionalmente, un importe aproximado de Compras. Todo lo demás se calcula (ver Summary). */
export interface PreliminarVentasRecordInput {
  facturas_base: number;
  facturas_no_gravadas: number;
  boletas_base: number;
  boletas_no_gravadas: number;
  notas_credito_base: number;
  notas_credito_no_gravadas: number;
  compras_base: number;
}

export interface PreliminarVentasSummaryRow {
  label: string;
  base: number;
  no_gravadas: number;
  igv: number;
  total: number;
}

export interface PreliminarVentasSummary {
  rows: PreliminarVentasSummaryRow[];
  igv_rate_pct: number;
  igv_resultante: number;
  credito_periodo_anterior: number;
  igv_a_pagar: number;
  /** Ausente cuando igv_a_pagar <= 0 (crédito a favor o neutral) — el PDF/la UI lo dejan en blanco. */
  monto_aproximado_igv?: number;
  compras_igv: number;
  compras_total: number;
  renta_base: number;
  renta_rate_pct: number;
  monto_aproximado_renta: number;
}

export interface PreliminarVentasDetail {
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
  record: PreliminarVentasRecordInput;
  summary: PreliminarVentasSummary;
  document_number: string;
}

export const preliminarVentasService = {
  async list(params: {
    period_ym: string;
    q?: string;
    status?: string;
    page?: number;
    per_page?: number;
  }): Promise<PreliminarVentasListResponse> {
    const res = await client.get<PreliminarVentasListResponse>(
      '/supervisors/activity-modules/preliminar-ventas',
      { params },
    );
    return res.data;
  },

  async getDetail(companyId: number, periodYm: string): Promise<PreliminarVentasDetail> {
    const res = await client.get<{ data: PreliminarVentasDetail }>(
      `/supervisors/activity-modules/preliminar-ventas/companies/${companyId}`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  async saveRecord(
    companyId: number,
    periodYm: string,
    body: PreliminarVentasRecordInput,
  ): Promise<PreliminarVentasDetail> {
    const res = await client.put<{ data: PreliminarVentasDetail }>(
      `/supervisors/activity-modules/preliminar-ventas/companies/${companyId}`,
      body,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },
};
