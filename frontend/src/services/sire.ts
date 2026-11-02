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

export interface SireOption {
  value: string;
  label: string;
}

export interface SireField {
  key: string;
  label: string;
  options?: SireOption[];
  default?: string;
  required?: boolean;
  placeholder?: string;
}

export interface SireReportDef {
  key: string;
  label: string;
  group: string;
  description: string;
  /** ticket: SUNAT responde un número de ticket y el archivo llega después; file: se descarga en el acto. */
  kind: 'ticket' | 'file';
  libros: SireLibro[];
  file_types?: Partial<Record<SireLibro, SireOption[]>>;
  fields?: SireField[];
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

export interface SireTicketFile {
  codTipoAchivoReporte?: string | null;
  codTipoArchivoReporte?: string | null;
  nomArchivoReporte: string;
  nomArchivoContenido?: string;
}

export interface SireTicketRecord {
  numTicket: string;
  perTributario: string;
  codProceso?: string;
  desProceso?: string;
  codEstadoProceso?: string;
  desEstadoProceso?: string;
  fecCargaImportacion?: string;
  fecInicioProceso?: string;
  nomArchivoImportacion?: string;
  showReportesDescarga?: number;
  detalleTicket?: Record<string, unknown>;
  archivoReporte?: SireTicketFile[];
}

export interface SireTicketsResponse {
  paginacion?: { page: number; perPage: number; totalRegistros: number };
  registros?: SireTicketRecord[];
}

export interface SireTablePage {
  name: string;
  columns: string[];
  rows: string[][];
  total: number;
  filtered: number;
  page: number;
  per_page: number;
}

export interface SirePreview {
  tables: { name: string; total: number }[];
  table?: SireTablePage;
  table_index?: number;
}

/** Estados de un ticket (Anexo III del manual). */
export const SIRE_TICKET_STATES: Record<string, string> = {
  '01': 'Cargado (solicitado)',
  '02': 'Validando archivo (en proceso)',
  '03': 'Procesado con errores',
  '04': 'Procesado sin errores (concluido)',
  '05': 'En proceso',
  '06': 'Terminado',
};

/** Ticket que ya no cambia: terminado, concluido o con errores. */
export function sireTicketFinished(code?: string): boolean {
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

function filenameFrom(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* sigue con filename= */
    }
  }
  const m = /filename="?([^";]+)"?/i.exec(disposition);
  return m ? m[1] : fallback;
}

async function saveBlob(path: string, params: Record<string, unknown>, fallbackName: string): Promise<void> {
  try {
    const res = await client.get<Blob>(path, { params, responseType: 'blob', ...LONG });
    const name = filenameFrom(res.headers['content-disposition'] as string | undefined, fallbackName);
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    throw await toBlobError(err, 'No se pudo descargar el archivo.');
  }
}

async function getData<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  try {
    const res = await client.get<{ data: T }>(path, { params, ...LONG });
    return res.data.data;
  } catch (err) {
    throw toError(err, 'No se pudo consultar el SIRE. Intente de nuevo.');
  }
}

export const sireService = {
  async catalog(libro: SireLibro): Promise<SireReportDef[]> {
    return getData<SireReportDef[]>('/tools/sire/catalog', { libro });
  },

  /** Comprueba las credenciales de API de la empresa (token + consulta de períodos). */
  async test(companyId: number): Promise<void> {
    try {
      await client.post(`${base(companyId)}/test`, undefined, LONG);
    } catch (err) {
      throw toError(err, 'No se pudo probar la conexión con SUNAT.');
    }
  },

  async periods(companyId: number, libro: SireLibro): Promise<SirePeriodYear[]> {
    const data = await getData<SirePeriodYear[] | null>(`${base(companyId)}/periods`, { libro });
    return Array.isArray(data) ? data : [];
  },

  tickets(
    companyId: number,
    p: { libro: SireLibro; per_ini: string; per_fin: string; page?: number; per_page?: number; ticket?: string },
  ): Promise<SireTicketsResponse> {
    return getData<SireTicketsResponse>(`${base(companyId)}/tickets`, p);
  },

  async requestReport(
    companyId: number,
    body: { libro: SireLibro; report: string; period: string; params?: Record<string, string> },
  ): Promise<string> {
    try {
      const res = await client.post<{ data: { ticket: string } }>(`${base(companyId)}/reports/request`, body, LONG);
      return res.data.data.ticket;
    } catch (err) {
      throw toError(err, 'No se pudo solicitar el reporte.');
    }
  },

  downloadDirect(
    companyId: number,
    p: { libro: SireLibro; report: string; period: string; params?: Record<string, string> },
  ): Promise<void> {
    return saveBlob(`${base(companyId)}/reports/direct`, { libro: p.libro, report: p.report, period: p.period, ...(p.params ?? {}) }, `SIRE_${p.report}_${p.period}`);
  },

  summaryPreview(
    companyId: number,
    p: { libro: SireLibro; period: string; tipo: string; page?: number; per_page?: number; q?: string },
  ): Promise<SirePreview> {
    return getData<SirePreview>(`${base(companyId)}/summary`, { ...p, format: '1', mode: 'preview' });
  },

  downloadSummary(companyId: number, p: { libro: SireLibro; period: string; tipo: string }): Promise<void> {
    return saveBlob(`${base(companyId)}/summary`, { ...p, format: '1', mode: 'download' }, `SIRE_${p.libro}_resumen${p.tipo}_${p.period}.csv`);
  },

  inconsistencies(companyId: number, p: { libro: SireLibro; period: string; tipo: string }): Promise<unknown> {
    return getData<unknown>(`${base(companyId)}/inconsistencies`, p);
  },

  preliminares(companyId: number, p: { per_ini: string; per_fin: string; page?: number; per_page?: number }): Promise<unknown> {
    return getData<unknown>(`${base(companyId)}/preliminares`, p);
  },

  fv0621(companyId: number, period: string): Promise<unknown> {
    return getData<unknown>(`${base(companyId)}/fv0621`, { period });
  },

  ajustes(companyId: number, p: { period: string; page?: number; per_page?: number }): Promise<unknown> {
    return getData<unknown>(`${base(companyId)}/ajustes`, p);
  },

  downloadConstancia(companyId: number, p: { libro: SireLibro; name: string }): Promise<void> {
    return saveBlob(`${base(companyId)}/constancia`, p, 'constancia.pdf');
  },

  ticketFilePreview(
    companyId: number,
    f: TicketFileRef,
    view: { table?: number; page?: number; per_page?: number; q?: string },
  ): Promise<SirePreview> {
    return getData<SirePreview>(`${base(companyId)}/tickets/file`, { ...ticketFileParams(f), ...view, mode: 'preview' });
  },

  downloadTicketFile(companyId: number, f: TicketFileRef): Promise<void> {
    return saveBlob(`${base(companyId)}/tickets/file`, { ...ticketFileParams(f), mode: 'download' }, f.name);
  },
};

/** Datos con los que SUNAT identifica un archivo generado por un ticket (salen del listado de tickets). */
export interface TicketFileRef {
  libro: SireLibro;
  name: string;
  type?: string | null;
  period: string;
  proceso?: string;
  ticket: string;
}

function ticketFileParams(f: TicketFileRef): Record<string, string> {
  return {
    libro: f.libro,
    name: f.name,
    type: f.type ?? '',
    period: f.period,
    proceso: f.proceso ?? '',
    ticket: f.ticket,
  };
}

/** Archivos de un ticket listos para ver/descargar. */
export function sireTicketFileRefs(libro: SireLibro, rec: SireTicketRecord): TicketFileRef[] {
  return (rec.archivoReporte ?? [])
    .filter((a) => a.nomArchivoReporte)
    .map((a) => ({
      libro,
      name: a.nomArchivoReporte,
      type: a.codTipoAchivoReporte ?? a.codTipoArchivoReporte ?? null,
      period: rec.perTributario,
      proceso: rec.codProceso,
      ticket: rec.numTicket,
    }));
}

/** Formato AAAAMM → "09/2026". */
export function formatSirePeriod(p: string | undefined): string {
  return p && /^\d{6}$/.test(p) ? `${p.slice(4)}/${p.slice(0, 4)}` : p ?? '';
}
