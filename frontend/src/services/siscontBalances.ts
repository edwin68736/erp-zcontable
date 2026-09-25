import client from '../api/client';

// Por ahora solo las columnas comunes a todos los módulos de actividad (código, dígito, razón
// social, RUC, asistente). Este módulo sumará las suyas más adelante.
export interface SiscontBalancesListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
}

export interface SiscontBalancesListResponse {
  data: SiscontBalancesListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export const siscontBalancesService = {
  async list(params: {
    period_ym: string;
    q?: string;
    page?: number;
    per_page?: number;
  }): Promise<SiscontBalancesListResponse> {
    const res = await client.get<SiscontBalancesListResponse>(
      '/supervisors/activity-modules/siscont-balances',
      { params },
    );
    return res.data;
  },
};
