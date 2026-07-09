import client from '../api/client';

export interface FiscalSeriesItem {
  id: number;
  name: string;
  sunat_code: string;
  series: string;
  current_number: number;
  next_number: string;
  active: boolean;
  description?: string;
}

export type FiscalSeriesInput = {
  name: string;
  sunat_code: string;
  series: string;
  current_number?: number;
  active?: boolean;
  description?: string;
};

export const fiscalDocumentSeriesService = {
  async list(params?: { active_only?: boolean; sunat_code?: string }): Promise<FiscalSeriesItem[]> {
    const res = await client.get<{ data: FiscalSeriesItem[] }>('/fiscal-document-series', { params });
    return res.data?.data ?? [];
  },

  async get(id: number): Promise<FiscalSeriesItem> {
    const res = await client.get<{ data: FiscalSeriesItem }>(`/fiscal-document-series/${id}`);
    return res.data.data;
  },

  async create(body: FiscalSeriesInput): Promise<FiscalSeriesItem> {
    const res = await client.post<{ data: FiscalSeriesItem }>('/fiscal-document-series', body);
    return res.data.data;
  },

  async update(id: number, body: Partial<FiscalSeriesInput>): Promise<FiscalSeriesItem> {
    const res = await client.put<{ data: FiscalSeriesItem }>(`/fiscal-document-series/${id}`, body);
    return res.data.data;
  },
};

/** Código SUNAT según tipo de emisión en UI. */
export function sunatCodeForKind(kind: 'boleta' | 'factura' | 'sale_note'): string {
  if (kind === 'factura') return '01';
  if (kind === 'boleta') return '03';
  return '00';
}
