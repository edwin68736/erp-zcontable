import client from '../api/client';

/** Estado + fecha límite (del calendario) de UNA entrega — el listado trae las 2. */
export interface PreliminarVentasSlotStatus {
  status: string;
  due_date?: string;
}

export interface PreliminarVentasListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  suspendida: boolean;
  slot1: PreliminarVentasSlotStatus;
  slot2: PreliminarVentasSlotStatus;
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

/** Lo único que registra el asistente para UNA entrega — Ventas (Base Imponible + No Gravadas por
 * concepto, separadas por tasa IGV 18%/10.5% — igv_aplicable_18/105 dice cuál(es) está(n) activa(s)
 * para esta entrega), opcionalmente un importe aproximado de Compras, y opcionalmente un valor
 * propio de crédito del período anterior (si no se manda, se usa el arrastre automático). Todo lo
 * demás se calcula (ver Summary). */
export interface PreliminarVentasRecordInput {
  igv_aplicable_18: boolean;
  igv_aplicable_105: boolean;
  facturas_base_18: number;
  facturas_no_gravadas_18: number;
  facturas_base_105: number;
  facturas_no_gravadas_105: number;
  boletas_base_18: number;
  boletas_no_gravadas_18: number;
  boletas_base_105: number;
  boletas_no_gravadas_105: number;
  notas_credito_base_18: number;
  notas_credito_no_gravadas_18: number;
  notas_credito_base_105: number;
  notas_credito_no_gravadas_105: number;
  /** % del I.G.V. a pagar que se busca compensar con compras (0–100, por defecto 95). */
  reduccion_igv_pct: number;
  credito_periodo_anterior_override?: number | null;
  /** Montos aproximados simples (sin arrastre automático) que también restan del I.G.V. resultante. */
  retencion_monto: number;
  percepcion_monto: number;
}

export interface PreliminarVentasSummaryRow {
  label: string;
  base: number;
  no_gravadas: number;
  igv: number;
  total: number;
}

export interface PreliminarVentasSummary {
  /** Filas de detalle (Facturas/Boletas/Notas de crédito) — una terna por cada tasa activa; SIN la
   * fila de total, que viene aparte en total_row (el largo de rows ya no es fijo: 3 o 6). */
  rows: PreliminarVentasSummaryRow[];
  total_row: PreliminarVentasSummaryRow;
  /** Tasa(s) efectivamente usadas en este cálculo, p.ej. [18] o [18, 10.5]. */
  igv_rates_aplicables: number[];
  igv_resultante: number;
  /** Lo que sugiere el arrastre automático (I.G.V. A PAGAR negativo de la entrega anterior) —
   * se muestra siempre, se haya usado o no. */
  credito_periodo_anterior_auto: number;
  /** El efectivamente usado en el cálculo (el override del usuario si lo hay, si no el automático). */
  credito_periodo_anterior: number;
  igv_a_pagar: number;
  /** Lo que quedaría por pagar de I.G.V. si se traen las compras de compras_base. Ausente cuando
   * igv_a_pagar <= 0 (saldo a favor o neutral) — el PDF/la UI lo dejan en blanco. */
  monto_aproximado_igv?: number;
  /** Importe CALCULADO a traer en facturas de compra (0 si no hay I.G.V. a pagar). */
  compras_base: number;
  compras_igv: number;
  compras_total: number;
  renta_base: number;
  renta_rate_pct: number;
  monto_aproximado_renta: number;
}

export interface PreliminarVentasSlotDetail {
  period_ym: string;
  slot_index: number;
  due_date?: string;
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
  control_id: number;
  control_suspendida: boolean;
  /** Tasa IGV configurada de la empresa (companies.igv_rate) — para marcar "(empresa)" en el
   * selector de tasas del formulario. */
  company_igv_rate: number;
  status: string;
  sent_at?: string;
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

  async getSlotDetail(companyId: number, periodYm: string, slotIndex: number): Promise<PreliminarVentasSlotDetail> {
    const res = await client.get<{ data: PreliminarVentasSlotDetail }>(
      `/supervisors/activity-modules/preliminar-ventas/companies/${companyId}/slots/${slotIndex}`,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  async saveSlotRecord(
    companyId: number,
    periodYm: string,
    slotIndex: number,
    body: PreliminarVentasRecordInput,
  ): Promise<PreliminarVentasSlotDetail> {
    const res = await client.put<{ data: PreliminarVentasSlotDetail }>(
      `/supervisors/activity-modules/preliminar-ventas/companies/${companyId}/slots/${slotIndex}`,
      body,
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },

  async markSlotSent(companyId: number, periodYm: string, slotIndex: number): Promise<PreliminarVentasSlotDetail> {
    const res = await client.post<{ data: PreliminarVentasSlotDetail }>(
      `/supervisors/activity-modules/preliminar-ventas/companies/${companyId}/slots/${slotIndex}/sent`,
      {},
      { params: { period_ym: periodYm } },
    );
    return res.data.data;
  },
};
