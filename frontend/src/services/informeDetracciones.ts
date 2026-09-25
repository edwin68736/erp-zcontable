import client from '../api/client';

// Por ahora solo las columnas comunes a todos los módulos de actividad (código, dígito, razón
// social, RUC, asistente). No confundir con detracciones.ts (Control de Detracciones SUNAT): son
// módulos distintos, con endpoint y lógica propios.
export interface InformeDetraccionesListRow {
  company_id: number;
  code: string;
  dig: string;
  business_name: string;
  ruc: string;
  assistant_username: string;
}

export interface InformeDetraccionesListResponse {
  data: InformeDetraccionesListRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export const informeDetraccionesService = {
  async list(params: {
    period_ym: string;
    q?: string;
    page?: number;
    per_page?: number;
  }): Promise<InformeDetraccionesListResponse> {
    const res = await client.get<InformeDetraccionesListResponse>(
      '/supervisors/activity-modules/informe-detracciones',
      { params },
    );
    return res.data;
  },
};
