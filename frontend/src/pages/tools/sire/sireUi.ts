import type { CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';

export const SELECT_CLS = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500';
export const INPUT_CLS = SELECT_CLS;

/** Qué le falta a la empresa para consultar el SIRE ('' si está todo). */
export function sireMissing(row: CompanyAccessCredentialRow): string {
  if (!(row.ruc ?? '').trim()) return 'RUC';
  if (!row.sol_configurado) return 'usuario y clave SOL';
  if (!row.sire_configurado) return 'credenciales de API SIRE (Client ID y Secret)';
  return '';
}

/** Saca de la respuesta de SUNAT la lista de registros (`registros`, `data` o el arreglo directo). */
export function pickRecords(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['registros', 'data', 'lista', 'items']) if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return null;
}
