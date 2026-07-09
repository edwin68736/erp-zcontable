import { FISCAL_SERIES_SESSION_KEY } from '../constants/tukifacSeriesSessionKeys';
import { fiscalDocumentSeriesService } from './fiscalDocumentSeries';
import type { TukifacSeriesItem } from './tukifacSeries';

function sessionHasSeriesKey(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function readJson(key: string): TukifacSeriesItem[] | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TukifacSeriesItem[]) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, data: TukifacSeriesItem[]): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    return;
  }
}

let inflight: Promise<void> | null = null;

function mapRows(rows: Awaited<ReturnType<typeof fiscalDocumentSeriesService.list>>): TukifacSeriesItem[] {
  return rows.map((row) => ({
    id: row.id,
    document_type_id: row.sunat_code,
    number: row.series,
    is_default: row.series.endsWith('01'),
    establishment_id: 1,
    next_number: row.next_number,
    name: row.name,
  }));
}

/** Carga series locales activas en sessionStorage (una sola petición concurrente). */
export async function ensureTukifacSeriesCached(): Promise<void> {
  if (sessionHasSeriesKey(FISCAL_SERIES_SESSION_KEY)) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const rows = await fiscalDocumentSeriesService.list({ active_only: true });
      writeJson(FISCAL_SERIES_SESSION_KEY, mapRows(rows));
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function getCachedDocumentSeries(): TukifacSeriesItem[] {
  const all = readJson(FISCAL_SERIES_SESSION_KEY) ?? [];
  return all.filter((r) => r.document_type_id === '01' || r.document_type_id === '03');
}

export function getCachedSaleNoteSeries(): TukifacSeriesItem[] {
  const all = readJson(FISCAL_SERIES_SESSION_KEY) ?? [];
  return all.filter((r) => r.document_type_id === '00');
}

export function pickDefaultSeries(rows: TukifacSeriesItem[]): TukifacSeriesItem | null {
  if (!rows.length) return null;
  const def = rows.find((r) => r.is_default);
  return def ?? rows[0] ?? null;
}
