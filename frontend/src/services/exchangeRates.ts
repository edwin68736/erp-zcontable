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

/** Un día del historial del tipo de cambio de mercado (cierre). */
export interface MarketPoint {
  /** AAAA-MM-DD */
  date: string;
  value: number;
}

/** Tipo de cambio «paralelo» (de mercado, el que muestra Google): cotización de ahora e historial diario. */
export interface MarketRates {
  spot?: { rate: number; updated_at: string; source: string };
  series: MarketPoint[];
  series_source?: string;
  warnings?: string[];
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

  /** Tipo de cambio de mercado (USD → PEN): cotización de ahora e historial para el gráfico. Solo informativo. */
  async market(): Promise<MarketRates> {
    const res = await client.get<{ data: MarketRates }>('/exchange-rates/market', { timeout: 30000 });
    return res.data.data;
  },
};
