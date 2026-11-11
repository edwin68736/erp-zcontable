import { formatAmount } from './format';

/** Deudas de una liquidación que siguen con saldo (lo que el cierre dejará libre). */
export function pendingDebtsAtClose(debts: ReadonlyArray<{ balance_amount: number | string }>): { count: number; total: number } {
  let count = 0;
  let total = 0;
  for (const d of debts) {
    const b = Number(d.balance_amount) || 0;
    if (b > 0.009) {
      count += 1;
      total += b;
    }
  }
  return { count, total: Math.round(total * 100) / 100 };
}

/**
 * Texto de confirmación al cerrar una liquidación. Cerrar NO significa que esté pagada: guarda la foto de las deudas y
 * libera las que siguen con saldo, que luego se llevan a la siguiente liquidación o se pagan por separado. Por eso el aviso
 * dice cuántas deudas y cuántos soles quedan libres. `pending` null = todavía no se conocen (se está cargando).
 */
export function closeSettlementMessage(label: string, pending: { count: number; total: number } | null): string {
  const base = `¿Cerrar la liquidación «${label}»? Quedará como registro histórico y se conservará el estado de cada deuda al momento del cierre.`;
  if (pending == null) return `${base} Las deudas con saldo pendiente quedarán libres.`;
  if (pending.count === 0) return `${base} No tiene deudas con saldo pendiente.`;
  const deudas = pending.count === 1 ? '1 deuda' : `${pending.count} deudas`;
  return (
    `${base} ${deudas} con saldo pendiente (S/ ${formatAmount(pending.total)}) quedará${pending.count === 1 ? '' : 'n'} libre${pending.count === 1 ? '' : 's'}: ` +
    'podrán incorporarse a la siguiente liquidación o pagarse por separado. Cerrar no marca nada como pagado.'
  );
}
