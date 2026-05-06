import client from '../api/client';

export interface TukifacSeriesItem {
  id: number;
  document_type_id: string;
  number: string;
  is_default: boolean;
  establishment_id: number;
}

export const tukifacSeriesService = {
  /** Series factura (01) y boleta (03); el backend ya filtra por SUNAT. */
  async listDocumentSeries(): Promise<TukifacSeriesItem[]> {
    const res = await client.get<TukifacSeriesItem[]>('/document/series');
    return Array.isArray(res.data) ? res.data : [];
  },

  async listSaleNoteSeries(): Promise<TukifacSeriesItem[]> {
    const res = await client.get<TukifacSeriesItem[]>('/sale-note/series');
    return Array.isArray(res.data) ? res.data : [];
  },
};
