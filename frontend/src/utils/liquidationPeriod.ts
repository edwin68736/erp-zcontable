const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

export function previousMonthYMFromDate(d: Date): string {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`;
}

/** Periodo de liquidación habitual: mes calendario anterior al día de hoy. */
export function defaultLiquidationPeriodYM(): string {
  return previousMonthYMFromDate(new Date());
}

export function isValidLiquidationPeriodYM(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value.trim());
}

export function periodLabelFromYM(ym: string): string {
  if (!isValidLiquidationPeriodYM(ym)) return '';
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  if (!Number.isFinite(y) || m < 1 || m > 12) return '';
  return `${MONTH_NAMES_ES[m - 1]} ${y}`;
}

export function settlementStatusLabel(status: string): string {
  const m: Record<string, string> = {
    borrador: 'Borrador',
    emitida: 'Emitida',
    cerrada: 'Cerrada',
    anulada: 'Anulada',
  };
  return m[status] ?? status;
}

export function settlementStatusBadgeClass(status: string): string {
  switch (status) {
    case 'borrador':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'emitida':
      return 'bg-emerald-50 text-emerald-900 border-emerald-200';
    case 'cerrada':
      return 'bg-slate-100 text-slate-800 border-slate-200';
    case 'anulada':
      return 'bg-red-50 text-red-800 border-red-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}
