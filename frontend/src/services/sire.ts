import client from '../api/client';

/** Libros del SIRE: RVIE (ventas e ingresos) y RCE (compras). */
export type SireLibro = 'ventas' | 'compras';

export const SIRE_LIBROS: { value: SireLibro; label: string; short: string }[] = [
  { value: 'ventas', label: 'Ventas e ingresos (RVIE)', short: 'Ventas' },
  { value: 'compras', label: 'Compras (RCE)', short: 'Compras' },
];

/** Error de la API SIRE: mensaje para el usuario, código estable y detalle técnico (sin claves). */
export interface SireApiError {
  message: string;
  code?: string;
  detail?: string;
}

export interface SirePeriod {
  perTributario: string;
  codEstado?: string;
  desEstado?: string;
}

export interface SirePeriodYear {
  numEjercicio: string;
  desEstado?: string;
  lisPeriodos: SirePeriod[];
}

interface SireTicketFile {
  codTipoAchivoReporte?: string | null;
  codTipoArchivoReporte?: string | null;
  nomArchivoReporte: string;
}

interface SireTicketRecord {
  numTicket: string;
  perTributario: string;
  codProceso?: string;
  desEstadoProceso?: string;
  codEstadoProceso?: string;
  archivoReporte?: SireTicketFile[];
}

interface SireTicketsResponse {
  registros?: SireTicketRecord[];
}

/** Ticket que ya no cambia: terminado, concluido o con errores. */
function ticketFinished(code?: string): boolean {
  return code === '06' || code === '04' || code === '03';
}

function toError(err: unknown, fallback: string): SireApiError {
  const data = (err as { response?: { data?: { error?: string; code?: string; detail?: string } } }).response?.data;
  if (data?.error) return { message: data.error, code: data.code, detail: data.detail };
  const net = err as { code?: string; message?: string };
  if (net.code === 'ECONNABORTED') return { message: 'La consulta tardó demasiado. Intente de nuevo.', code: 'timeout' };
  return { message: fallback, detail: net.message };
}

/** Los errores de una descarga (blob) llegan como JSON dentro del blob: se abre para leer el mensaje. */
async function toBlobError(err: unknown, fallback: string): Promise<SireApiError> {
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (data instanceof Blob) {
    try {
      const j = JSON.parse(await data.text()) as { error?: string; code?: string; detail?: string };
      if (j.error) return { message: j.error, code: j.code, detail: j.detail };
    } catch {
      /* no era JSON */
    }
  }
  return toError(err, fallback);
}

const base = (companyId: number) => `/tools/sire/${companyId}`;
const LONG = { timeout: 120000 };

/** Cada cuánto se pregunta a SUNAT si el archivo ya está listo, y cuánto se espera como máximo. */
const POLL_MS = 4000;
const POLL_MAX_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Nombre del Excel de la propuesta: «<RUC>-<AAAAMM>-SIREV-Propuesta.xlsx» (ventas) o «-SIREC-» (compras). */
export function sirePropuestaFileName(ruc: string, period: string, libro: SireLibro): string {
  return `${ruc}-${period}-${libro === 'ventas' ? 'SIREV' : 'SIREC'}-Propuesta.xlsx`;
}

export type SireDownloadStep = 'solicitando' | 'esperando' | 'generando';

/** Formato AAAAMM → "09/2026". */
export function formatSirePeriod(p: string | undefined): string {
  return p && /^\d{6}$/.test(p) ? `${p.slice(4)}/${p.slice(0, 4)}` : p ?? '';
}

/** Guarda un archivo en el navegador del usuario. */
export function saveBlobAs(blob: Blob, name: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export const sireService = {
  /** Comprueba las credenciales de API de la empresa (token + consulta de períodos). */
  async test(companyId: number): Promise<void> {
    try {
      await client.post(`${base(companyId)}/test`, undefined, LONG);
    } catch (err) {
      throw toError(err, 'No se pudo probar la conexión con SUNAT.');
    }
  },

  /** Períodos que SUNAT tiene habilitados para el libro, agrupados por año. */
  async periods(companyId: number, libro: SireLibro): Promise<SirePeriodYear[]> {
    try {
      const res = await client.get<{ data: SirePeriodYear[] | null }>(`${base(companyId)}/periods`, { params: { libro }, ...LONG });
      return Array.isArray(res.data.data) ? res.data.data : [];
    } catch (err) {
      throw toError(err, 'No se pudieron consultar los períodos en SUNAT.');
    }
  },

  /** Descarga el Excel de la propuesta y lo guarda en el navegador. */
  async downloadPropuestaExcel(
    companyId: number,
    p: { libro: SireLibro; period: string; ruc: string },
    onStep?: (step: SireDownloadStep) => void,
  ): Promise<void> {
    saveBlobAs(await sireService.fetchPropuestaExcel(companyId, p, onStep), sirePropuestaFileName(p.ruc, p.period, p.libro));
  },

  /**
   * Pide a SUNAT la propuesta de comprobantes del libro y período (la prepara por ticket), espera a que esté
   * lista y la convierte a un .xlsx válido en el servidor. Devuelve el archivo sin guardarlo.
   */
  async fetchPropuestaExcel(
    companyId: number,
    p: { libro: SireLibro; period: string; ruc: string },
    onStep?: (step: SireDownloadStep) => void,
  ): Promise<Blob> {
    onStep?.('solicitando');
    let ticket: string;
    try {
      const res = await client.post<{ data: { ticket: string } }>(
        `${base(companyId)}/reports/request`,
        { libro: p.libro, report: 'propuesta', period: p.period, params: {} },
        LONG,
      );
      ticket = res.data.data.ticket;
    } catch (err) {
      throw toError(err, 'No se pudo solicitar la propuesta a SUNAT.');
    }

    onStep?.('esperando');
    const started = Date.now();
    let record: SireTicketRecord | undefined;
    for (;;) {
      await sleep(POLL_MS);
      try {
        const res = await client.get<{ data: SireTicketsResponse }>(`${base(companyId)}/tickets`, {
          params: { libro: p.libro, per_ini: p.period, per_fin: p.period, page: 1, per_page: 5, ticket },
          ...LONG,
        });
        const list = res.data.data?.registros ?? [];
        record = list.find((r) => r.numTicket === ticket) ?? list[0];
      } catch (err) {
        throw toError(err, 'No se pudo consultar el estado del archivo en SUNAT.');
      }
      if (ticketFinished(record?.codEstadoProceso)) break;
      if (Date.now() - started > POLL_MAX_MS) {
        throw { message: 'SUNAT tarda en preparar el archivo. Intente de nuevo en unos minutos.', code: 'timeout' } satisfies SireApiError;
      }
    }

    if (record?.codEstadoProceso === '03') {
      throw { message: 'SUNAT no pudo generar la propuesta de este período (terminó con errores).', code: 'ticket_con_errores' } satisfies SireApiError;
    }
    const file = (record?.archivoReporte ?? []).find((a) => a.nomArchivoReporte);
    if (!file) {
      throw { message: 'SUNAT no tiene comprobantes en la propuesta de este período.', code: 'sin_datos' } satisfies SireApiError;
    }

    onStep?.('generando');
    try {
      const res = await client.get<Blob>(`${base(companyId)}/tickets/file`, {
        params: {
          libro: p.libro,
          name: file.nomArchivoReporte,
          type: file.codTipoAchivoReporte ?? file.codTipoArchivoReporte ?? '',
          period: p.period,
          proceso: record?.codProceso ?? '',
          ticket,
          mode: 'excel',
        },
        responseType: 'blob',
        ...LONG,
      });
      return res.data;
    } catch (err) {
      throw await toBlobError(err, 'No se pudo generar el Excel.');
    }
  },
};
