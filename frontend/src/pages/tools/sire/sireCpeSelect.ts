import type { SireCpeKind, SireCpeLine } from '../../../services/sire';
import { cpeLineKey } from '../../../services/sire';
import { parseSunatAmount } from '../../../utils/sunatAmount';

/**
 * Comprobantes por tanda. Debe coincidir con `cpeMaxPerBatch` del servidor (backend/services/sire_cpe.go): una tanda dura unos
 * 10 minutos y SUNAT corta las sesiones largas o muy insistentes, así que se baja de a 250 y se continúa con «los siguientes».
 */
export const CPE_BATCH = 250;

/** Filas por ZIP: con muchos comprobantes se baja por partes para que cada archivo no pese demasiado. */
export const CPE_ZIP_PART = 500;

export type CpeProgress = 'completo' | 'parcial' | 'pendiente' | 'en_proceso' | 'sin_cpe';

const HAS: Record<SireCpeKind, (l: SireCpeLine) => boolean> = {
  pdf: (l) => l.has_pdf,
  xml: (l) => l.has_xml,
  cdr: (l) => l.has_cdr,
};

/**
 * En qué va un comprobante respecto de los formatos elegidos:
 * completo (ya tiene todos los elegidos), parcial (tiene algunos), pendiente (ninguno), en proceso, o sin CPE
 * (SUNAT ya dijo que no tiene archivos: no es electrónico o no existe; no se vuelve a pedir en «los siguientes»).
 */
export function lineProgress(l: SireCpeLine, kinds: SireCpeKind[]): CpeProgress {
  if (l.status === 'en_proceso') return 'en_proceso';
  if (kinds.length === 0) return 'pendiente';
  const have = kinds.filter((k) => HAS[k](l)).length;
  if (have === kinds.length) return 'completo';
  if (l.status === 'sin_cpe' && !l.has_pdf && !l.has_xml && !l.has_cdr) return 'sin_cpe';
  return have > 0 ? 'parcial' : 'pendiente';
}

/** ¿Falta bajarle algo? (se marca y se pide en las tandas). */
export const isPending = (l: SireCpeLine, kinds: SireCpeKind[]): boolean => {
  const p = lineProgress(l, kinds);
  return p === 'pendiente' || p === 'parcial';
};

/** Las claves de los primeros `limit` comprobantes pendientes, en el orden de la tabla. */
export function nextPending(lines: SireCpeLine[], kinds: SireCpeKind[], limit = CPE_BATCH): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (out.length >= limit) break;
    if (isPending(l, kinds)) out.push(cpeLineKey(l));
  }
  return out;
}

export function countPending(lines: SireCpeLine[], kinds: SireCpeKind[]): number {
  return lines.reduce((n, l) => n + (isPending(l, kinds) ? 1 : 0), 0);
}

/** De lo marcado, lo que se manda en esta tanda: los primeros `limit` en el orden de la tabla. */
export function batchOf(lines: SireCpeLine[], picked: Set<string>, limit = CPE_BATCH): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (out.length >= limit) break;
    const k = cpeLineKey(l);
    if (picked.has(k)) out.push(k);
  }
  return out;
}

/** Parte una lista en tandas de `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Texto de la columna «Descargado». */
export function progressLabel(l: SireCpeLine, kinds: SireCpeKind[]): { text: string; tone: 'ok' | 'warn' | 'muted' | 'busy' | 'bad' } {
  switch (lineProgress(l, kinds)) {
    case 'completo':
      return { text: 'Completo', tone: 'ok' };
    case 'parcial': {
      const have = (['pdf', 'xml', 'cdr'] as SireCpeKind[]).filter((k) => HAS[k](l)).map((k) => k.toUpperCase());
      return { text: `Parcial (${have.join(', ')})`, tone: 'warn' };
    }
    case 'en_proceso':
      return { text: 'Descargando…', tone: 'busy' };
    case 'sin_cpe':
      return { text: 'Sin CPE en SUNAT', tone: 'bad' };
    default:
      return {
        text: l.status === 'error' ? 'Con error: reintentar' : 'Pendiente',
        tone: l.status === 'error' ? 'bad' : 'muted',
      };
  }
}

/** «1234.5» o «1,234.50» → «1,234.50»; si no es un número se deja tal cual. */
export function fmtCpeTotal(v: string | undefined): string {
  if (!v) return '—';
  const n = parseSunatAmount(v);
  return n != null
    ? n.toLocaleString('es-PE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : v;
}
