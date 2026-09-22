import {
  formatTaxMoney,
  formatTaxTotalMoney,
  type Pdt621DetractionPayment,
} from '../../utils/taxSettlementSections';

type Props = {
  payment?: Pdt621DetractionPayment;
  appliedAmount: number;
  payableBefore: number;
  totalLabel: string;
  netAfterDetraction: number;
  extraNote?: string;
  /** Monto que no aplica detracción (p. ej. AFP en planilla). */
  additionalPayableAmount?: number;
};

export function DetraccionReadOnlyBar({
  payment,
  appliedAmount,
  payableBefore,
  totalLabel,
  netAfterDetraction,
  extraNote,
  additionalPayableAmount = 0,
}: Props) {
  const enabled = Boolean(payment?.enabled) && appliedAmount > 0;
  const pendingDetractable = Math.max(payableBefore - appliedAmount, 0);
  const totalPending = pendingDetractable + Math.max(additionalPayableAmount, 0);
  const modeLabel = payment?.mode === 'total' ? 'total' : 'parcial';

  const statusLine = enabled
    ? `Aplicado con detracción/efectivo: ${formatTaxMoney(appliedAmount)} (${modeLabel}).`
    : 'Sin aplicación de detracción/efectivo.';

  const pendingLine =
    enabled && totalPending > 0
      ? `Impuesto pendiente luego de detracción/efectivo: ${formatTaxTotalMoney(totalPending)}`
      : enabled
        ? 'Sin impuesto pendiente (cubierto con detracción/efectivo).'
        : null;

  return (
    <div className="mt-3 pt-3 border-t border-primary-100 bg-primary-50/40 rounded-lg px-3 py-2.5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-semibold text-slate-800">Pago con detracción/efectivo</p>
        <p className="text-2xs text-slate-600">{statusLine}</p>
        {pendingLine ? <p className="text-2xs text-primary-900">{pendingLine}</p> : null}
        {extraNote ? <p className="text-2xs text-slate-500">{extraNote}</p> : null}
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-slate-500">{totalLabel}</p>
        <p className="text-base font-bold text-slate-900 tabular-nums">{formatTaxTotalMoney(netAfterDetraction)}</p>
      </div>
    </div>
  );
}

export default DetraccionReadOnlyBar;
