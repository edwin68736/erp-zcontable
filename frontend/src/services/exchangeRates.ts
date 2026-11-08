import client from '../api/client';

/** Tipo de cambio de un día, tal como lo publica SUNAT (cierre de la SBS del día hábil anterior). */
export interface ExchangeRateDay {
  currency: string;
  /** AAAA-MM-DD */
  date: string;
  compra: number;
  venta: number;
  /** Día hábil cuyo cierre rige en `date`. */
  fecha_sunat?: string;
  fetched_at?: string;
}

export interface ExchangeMonth {
  year: number;
  month: number;
  currency: string;
  days: ExchangeRateDay[];
  /** Fechas del mes (hasta mañana) que todavía no tienen valor. */
  missing: string[];
  /** Días traídos de ApiPeru.dev en esta consulta. */
  fetched: number;
  warning?: string;
  warning_code?: 'sin_token' | 'token_invalido' | 'limite' | 'parcial' | 'sin_conexion' | 'sin_publicar';
}

export const exchangeRatesService = {
  /**
   * Tipo de cambio de un mes. Con `fetch` el servidor trae antes (de ApiPeru.dev) los días que falten y los guarda:
   * un mes nuevo puede tardar unos segundos, después sale de nuestra base.
   */
  async month(year: number, month: number, fetch = true): Promise<ExchangeMonth> {
    const res = await client.get<{ data: ExchangeMonth }>('/exchange-rates/month', {
      params: { year, month, currency: 'USD', fetch: fetch ? 1 : 0 },
      timeout: 90000,
    });
    return res.data.data;
  },
};
