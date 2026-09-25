import client from '../api/client';

// Por ahora solo las columnas comunes a todos los módulos de actividad (código, dígito, razón
// social, RUC, asistente). Este módulo sumará las suyas más adelante.
export interface InformeDeudasListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
}

export interface InformeDeudasListResponse {
  data: InformeDeudasListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export const informeDeudasService = {
  async list(params: {
    period_ym: string;
    q?: string;
    page?: number;
    per_page?: number;
  }): Promise<InformeDeudasListResponse> {
    const res = await client.get<InformeDeudasListResponse>(
      '/supervisors/activity-modules/informe-deudas',
      { params },
    );
    return res.data;
  },
};
