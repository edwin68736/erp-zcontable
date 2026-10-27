import client from '../api/client';

export const companySuspensionService = {
  /**
   * Marca o quita la suspensión de una empresa en un período, desde cualquier módulo de actividades. La
   * marca es global del control mensual: todos los módulos la leen del mismo lugar.
   */
  async set(companyId: number, periodYm: string, suspendida: boolean): Promise<boolean> {
    const res = await client.put<{ data: { suspendida: boolean } }>(
      `/supervisors/activity-modules/companies/${companyId}/suspendida`,
      { suspendida },
      { params: { period_ym: periodYm } },
    );
    return res.data.data.suspendida;
  },
};
