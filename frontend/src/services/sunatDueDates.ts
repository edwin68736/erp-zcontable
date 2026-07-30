import client from '../api/client';

/** Fila del cronograma: mes calendario (1-12) + 10 fechas de vencimiento (AAAA-MM-DD, dígito 0-9). */
export interface SunatDueDateRow {
  month: number;
  dates: [string, string, string, string, string, string, string, string, string, string];
  updated_at?: string;
}

export interface SunatDueDateUpdateInput {
  month: number;
  dates: SunatDueDateRow['dates'];
}

export const sunatDueDatesService = {
  async list(): Promise<SunatDueDateRow[]> {
    const res = await client.get<{ data: SunatDueDateRow[] }>('/finance/sunat-due-dates');
    return res.data.data ?? [];
  },

  /** Edita las fechas de los meses indicados. Nunca crea filas nuevas (las 12 ya existen). */
  async update(rows: SunatDueDateUpdateInput[]): Promise<SunatDueDateRow[]> {
    const res = await client.put<{ data: SunatDueDateRow[] }>('/finance/sunat-due-dates', { rows });
    return res.data.data ?? [];
  },
};
