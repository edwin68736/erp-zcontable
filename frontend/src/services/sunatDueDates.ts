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

/** Acceso a un calendario de vencimientos (12 filas fijas): se lee y se editan sus fechas; nunca se crean filas. */
function dueDatesApi(path: string) {
  return {
    async list(): Promise<SunatDueDateRow[]> {
      const res = await client.get<{ data: SunatDueDateRow[] }>(path);
      return res.data.data ?? [];
    },

    /** Edita las fechas de los meses indicados. Nunca crea filas nuevas (las 12 ya existen). */
    async update(rows: SunatDueDateUpdateInput[]): Promise<SunatDueDateRow[]> {
      const res = await client.put<{ data: SunatDueDateRow[] }>(path, { rows });
      return res.data.data ?? [];
    },
  };
}

/** Vencimientos del ESTUDIO: las fechas internas con las que trabaja el estudio (las usan, por ejemplo, las declaraciones PDT 621). */
export const sunatDueDatesService = dueDatesApi('/finance/sunat-due-dates');

/** Vencimientos OFICIALES de SUNAT («Cronograma de Obligaciones Tributarias Mensuales»). */
export const sunatOfficialDueDatesService = dueDatesApi('/finance/sunat-official-due-dates');

export type DueDatesApi = ReturnType<typeof dueDatesApi>;
