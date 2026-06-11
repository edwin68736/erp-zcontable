import type { Document } from '../types/dashboard';

export type CollectionSituation =
  | 'all'
  | 'por_cobrar'
  | 'pagadas'
  | 'vencidas'
  | 'anuladas';

export const COLLECTION_SITUATION_OPTIONS: { value: CollectionSituation | ''; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'por_cobrar', label: 'Por cobrar' },
  { value: 'pagadas', label: 'Pagadas' },
  { value: 'vencidas', label: 'Vencidas' },
  { value: 'anuladas', label: 'Anuladas' },
];

/** Convierte params legacy (status/overdue) a situación comercial. */
export function legacyStatusToSituation(status: string, overdue: boolean): CollectionSituation | '' {
  if (overdue || status === 'vencido') return 'vencidas';
  if (status === 'all') return 'all';
  if (status === 'pagado') return 'pagadas';
  if (status === 'anulado') return 'anuladas';
  if (status === 'pendiente' || status === 'parcial') return 'por_cobrar';
  return '';
}

export function documentPaidAmount(doc: Document): number {
  if (typeof doc.paid_amount === 'number' && Number.isFinite(doc.paid_amount)) {
    return doc.paid_amount;
  }
  return 0;
}

export function documentBalanceAmount(doc: Document): number {
  if (typeof doc.balance_amount === 'number' && Number.isFinite(doc.balance_amount)) {
    return doc.balance_amount;
  }
  const paid = documentPaidAmount(doc);
  const bal = (doc.total_amount ?? 0) - paid;
  return bal > 0.005 ? bal : 0;
}

export function documentIsOverdue(doc: Document): boolean {
  if (typeof doc.is_overdue === 'boolean') return doc.is_overdue;
  if (doc.status === 'pagado' || doc.status === 'anulado') return false;
  const due = doc.due_date ? new Date(doc.due_date) : null;
  if (!due || !Number.isFinite(due.getTime())) return false;
  return due.getTime() < Date.now() && documentBalanceAmount(doc) > 0.005;
}

export type DebtBadgeInfo = {
  label: string;
  className: string;
  subLabel?: string;
};

/** Badge visible en tabla de deudas. */
export function debtCollectionBadge(doc: Document): DebtBadgeInfo {
  const balance = documentBalanceAmount(doc);
  const overdue = documentIsOverdue(doc);
  const st = (doc.status ?? '').toLowerCase();

  if (st === 'anulado') {
    return { label: 'Anulado', className: 'bg-slate-100 text-slate-700 border-slate-200' };
  }
  if (st === 'pagado' || balance <= 0.005) {
    return { label: 'Pagado', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  }
  if (overdue) {
    const sub = st === 'parcial' ? 'Pago parcial' : undefined;
    return {
      label: 'Vencido',
      className: 'bg-red-50 text-red-800 border-red-200',
      subLabel: sub,
    };
  }
  if (st === 'parcial') {
    return { label: 'Pago parcial', className: 'bg-sky-50 text-sky-800 border-sky-200' };
  }
  return { label: 'Pendiente', className: 'bg-amber-50 text-amber-900 border-amber-200' };
}

export function formatMoneyPen(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `S/ ${v.toFixed(2)}`;
}

/** Quita marcas internas de migración legacy en descripciones (consolidación DEU-LIQ). */
export function stripLegacyMigrationNotes(text: string): string {
  const stripped = text.replace(/\s*\[legacy_(?:promoted|merged|archived)[^\]]*\]/gi, '').trim();
  const parts = stripped
    .split(/\s*[,;]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return stripped;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique.length === 1 ? unique[0] : unique.join(', ');
}

/** Periodo MM/YYYY desde has_period o legacy YYYY-MM. */
export function formatDocumentPeriod(doc: Document): string {
  if (doc.has_period && doc.period_month != null && doc.period_year != null) {
    const mo = String(doc.period_month).padStart(2, '0');
    return `${mo}/${doc.period_year}`;
  }
  const raw = ((doc.accounting_period ?? '').trim() || (doc.service_month ?? '').trim());
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return `${raw.slice(5, 7)}/${raw.slice(0, 4)}`;
  }
  return raw || '—';
}

/** Deuda con saldo pendiente y no anulada. */
export function documentCanReceivePayment(doc: Document): boolean {
  if (doc.status === 'anulado' || doc.status === 'pagado') return false;
  return documentBalanceAmount(doc) > 0.005;
}
