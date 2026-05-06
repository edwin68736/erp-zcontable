import {
  TUKIFAC_DOC_SERIES_SESSION_KEY,
  TUKIFAC_SALE_NOTE_SERIES_SESSION_KEY,
} from '../constants/tukifacSeriesSessionKeys';
import { tukifacSeriesService, type TukifacSeriesItem } from './tukifacSeries';

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

/** Carga ambas listas si faltan en sessionStorage (una sola petición concurrente). */
export async function ensureTukifacSeriesCached(): Promise<void> {
  const hasDoc = sessionHasSeriesKey(TUKIFAC_DOC_SERIES_SESSION_KEY);
  const hasSn = sessionHasSeriesKey(TUKIFAC_SALE_NOTE_SERIES_SESSION_KEY);
  if (hasDoc && hasSn) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const needDoc = !hasDoc;
      const needSn = !hasSn;
      const [doc, sn] = await Promise.all([
        needDoc ? tukifacSeriesService.listDocumentSeries() : Promise.resolve(null),
        needSn ? tukifacSeriesService.listSaleNoteSeries() : Promise.resolve(null),
      ]);
      if (needDoc && doc !== null) writeJson(TUKIFAC_DOC_SERIES_SESSION_KEY, doc);
      if (needSn && sn !== null) writeJson(TUKIFAC_SALE_NOTE_SERIES_SESSION_KEY, sn);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function getCachedDocumentSeries(): TukifacSeriesItem[] {
  return readJson(TUKIFAC_DOC_SERIES_SESSION_KEY) ?? [];
}

export function getCachedSaleNoteSeries(): TukifacSeriesItem[] {
  return readJson(TUKIFAC_SALE_NOTE_SERIES_SESSION_KEY) ?? [];
}

export function pickDefaultSeries(rows: TukifacSeriesItem[]): TukifacSeriesItem | null {
  if (!rows.length) return null;
  const def = rows.find((r) => r.is_default);
  return def ?? rows[0] ?? null;
}
