/**
 * Series locales (antes Tukifac remoto). Mantiene nombre de archivo por compatibilidad de imports.
 */
import {
  fiscalDocumentSeriesService,
  sunatCodeForKind,
  type FiscalSeriesItem,
} from './fiscalDocumentSeries';

export type TukifacSeriesItem = {
  id: number;
  document_type_id: string;
  number: string;
  is_default: boolean;
  establishment_id: number;
  next_number?: string;
  name?: string;
};

function mapRow(row: FiscalSeriesItem): TukifacSeriesItem {
  return {
    id: row.id,
    document_type_id: row.sunat_code,
    number: row.series,
    is_default: row.series.endsWith('01'),
    establishment_id: 1,
    next_number: row.next_number,
    name: row.name,
  };
}

export const tukifacSeriesService = {
  async listDocumentSeries(): Promise<TukifacSeriesItem[]> {
    const rows = await fiscalDocumentSeriesService.list({ active_only: true });
    return rows.filter((r) => r.sunat_code === '01' || r.sunat_code === '03').map(mapRow);
  },

  async listSaleNoteSeries(): Promise<TukifacSeriesItem[]> {
    const rows = await fiscalDocumentSeriesService.list({ active_only: true, sunat_code: '00' });
    return rows.map(mapRow);
  },

  async listForKind(kind: 'boleta' | 'factura' | 'sale_note'): Promise<TukifacSeriesItem[]> {
    const code = sunatCodeForKind(kind);
    const rows = await fiscalDocumentSeriesService.list({ active_only: true, sunat_code: code });
    return rows.map(mapRow);
  },
};
