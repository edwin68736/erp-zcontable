import client from '../api/client';
import type { SuspensionCarryOverRow } from './detracciones';

/** Actividades que admiten «No corresponde» (en PDT 601 se muestra como «Sin planilla»). */
export type NotApplicableActivity =
  | 'pdt_601'
  | 'pdt_621'
  | 'detracciones'
  | 'sunat_inbox'
  | 'informe_detracciones'
  | 'siscont_balances'
  | 'preliminar_ventas';

export interface NotApplicableCarryOver {
  pending: boolean;
  previous_period_ym: string;
  companies: SuspensionCarryOverRow[];
}

export interface NotApplicableCarryOverResult {
  applied: number;
  skipped: string[];
}

const BASE = '/supervisors/activity-modules/not-applicable';

export const notApplicableService = {
  async set(activity: NotApplicableActivity, companyId: number, periodYm: string, notApplicable: boolean): Promise<void> {
    await client.put(BASE, {
      activity,
      company_id: companyId,
      period_ym: periodYm,
      not_applicable: notApplicable,
    });
  },

  async carryOver(activity: NotApplicableActivity, periodYm: string): Promise<NotApplicableCarryOver> {
    const res = await client.get<{ data: NotApplicableCarryOver }>(`${BASE}/carry-over`, {
      params: { activity, period_ym: periodYm },
    });
    return res.data.data;
  },

  async applyCarryOver(
    activity: NotApplicableActivity,
    periodYm: string,
    keepCompanyIds: number[],
    reviewCompanyIds: number[],
  ): Promise<NotApplicableCarryOverResult> {
    const res = await client.post<{ data: NotApplicableCarryOverResult }>(`${BASE}/carry-over`, {
      activity,
      period_ym: periodYm,
      keep_company_ids: keepCompanyIds,
      review_company_ids: reviewCompanyIds,
    });
    return res.data.data;
  },
};
