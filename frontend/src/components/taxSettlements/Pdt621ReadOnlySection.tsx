import {
  formatImpuestoPeriodo,
  formatPdt621IgvBalanceAmount,
  getPdt621PercepcionesRetencionesFieldLabel,
  getPdt621AppliedDetractionAmount,
  getPdt621AppliedDetractionAmountRenta,
  getPdt621IgvBalanceLabel,
  getPdt621IgvNetAfterDetraction,
  getPdt621IgvPayableBeforeDetraction,
  getPdt621IgvSaldoFavorLabel,
  getPdt621RentaNetAfterDetraction,
  getPdt621RentaPayableBeforeDetraction,
  formatTaxMoney,
  formatTaxTotalMoney,
  formatTaxRowMoney,
  listPdt621IgvDisplayRows,
  type TaxSectionPdt621,
} from '../../utils/taxSettlementSections';
import { formatRentaRateLabel } from '../../utils/companyTaxRegime';
import DetraccionReadOnlyBar from './DetraccionReadOnlyBar';
import {
  PDT621_IGV_HEADER_CELL,
  PDT621_IGV_TABLE_GAP,
  PDT621_IGV_TABLE_GRID,
  PDT621_IGV_TABLE_ROW,
  PDT621_READONLY_AMOUNT,
  PDT621_ROW_GRID,
  PDT621_SECTION_TITLE,
  PDT621_SUMMARY_LABEL,
  PDT621_SUMMARY_LABEL_EMPHASIS,
} from './pdt621Layout';

type Props = {
  p621: TaxSectionPdt621;
  rentaRatePct?: number | null;
  showFooter?: boolean;
};

function ReadOnlyAmount({ value, className = '' }: { value: string; className?: string }) {
  return <div className={`${PDT621_READONLY_AMOUNT} ${className}`.trim()}>{value}</div>;
}

function ReadOnlySummaryRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className={`${PDT621_IGV_TABLE_ROW} min-h-0 py-0.5`}>
      <span
        className={`col-span-3 ${emphasized ? PDT621_SUMMARY_LABEL_EMPHASIS : PDT621_SUMMARY_LABEL} text-right self-center pr-1`}
      >
        {label}
      </span>
      <ReadOnlyAmount value={value} className="min-w-0 self-center" />
      <span aria-hidden className="hidden sm:block" />
    </div>
  );
}

function ReadOnlyIgvTableRow({
  title,
  base,
  noGravadas,
  impuesto,
  total,
  withNoGravadas,
}: {
  title: string;
  base: string;
  noGravadas: string;
  impuesto: string;
  total: string;
  withNoGravadas: boolean;
}) {
  return (
    <>
      <div className="sm:hidden space-y-2 pb-2 last:pb-0">
        <p className="text-xs font-semibold text-slate-700">{title}</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1">Base imponible</p>
            <ReadOnlyAmount value={base} />
          </div>
          {withNoGravadas ? (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1">No gravadas</p>
              <ReadOnlyAmount value={noGravadas} />
            </div>
          ) : null}
          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1">Impuesto</p>
            <ReadOnlyAmount value={impuesto} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1">Total</p>
            <ReadOnlyAmount value={total} />
          </div>
        </div>
      </div>
      <div className={`hidden sm:grid ${PDT621_IGV_TABLE_ROW}`}>
        <p className="text-xs font-medium text-slate-700 leading-snug pr-1 self-center">{title}</p>
        <ReadOnlyAmount value={base} className="min-w-0 self-center" />
        {withNoGravadas ? <ReadOnlyAmount value={noGravadas} className="min-w-0 self-center" /> : null}
        <ReadOnlyAmount value={impuesto} className="min-w-0 self-center" />
        <ReadOnlyAmount value={total} className="min-w-0 self-center" />
      </div>
    </>
  );
}

function MobileReadOnlyRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className={`grid grid-cols-1 ${PDT621_ROW_GRID} gap-y-0.5`}>
      <span className={`${emphasized ? PDT621_SUMMARY_LABEL_EMPHASIS : PDT621_SUMMARY_LABEL} leading-snug`}>
        {label}
      </span>
      <ReadOnlyAmount value={value} />
    </div>
  );
}

function ReadOnlyFooterRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${PDT621_IGV_TABLE_ROW} min-h-0 py-1 mt-1 pt-2 border-t border-slate-100`}>
      <span className={`col-span-3 ${PDT621_SUMMARY_LABEL} text-right self-center pr-1 leading-snug`}>{label}</span>
      <div className={`${PDT621_READONLY_AMOUNT} font-bold text-sm min-w-0 self-center`}>{value}</div>
      <span aria-hidden className="hidden sm:block" />
    </div>
  );
}

function MobileReadOnlyFooterRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={`grid grid-cols-1 ${PDT621_ROW_GRID} gap-y-0.5 pt-2 mt-1 border-t border-slate-100`}>
      <span className={`${PDT621_SUMMARY_LABEL} leading-snug`}>{label}</span>
      <div className={`${PDT621_READONLY_AMOUNT} font-bold text-sm`}>{value}</div>
    </div>
  );
}

export function Pdt621ReadOnlySection({ p621, rentaRatePct, showFooter = true }: Props) {
  const rentaRateLabel = rentaRatePct != null ? formatRentaRateLabel(rentaRatePct) : null;
  const igvRows = listPdt621IgvDisplayRows(p621);
  const igvBalance = getPdt621IgvBalanceLabel(p621);
  const igvSaldoFavor = getPdt621IgvSaldoFavorLabel(p621);
  const detractionAppliedIgv = getPdt621AppliedDetractionAmount(p621);
  const detractionAppliedRenta = getPdt621AppliedDetractionAmountRenta(p621);
  const igvPayableBefore = getPdt621IgvPayableBeforeDetraction(p621);
  const rentaPayableBefore = getPdt621RentaPayableBeforeDetraction(p621);
  const igvNetAfterDetraction = getPdt621IgvNetAfterDetraction(p621);
  const rentaNetAfterDetraction = getPdt621RentaNetAfterDetraction(p621);
  const igvFinalAmount = detractionAppliedIgv > 0 ? igvNetAfterDetraction : igvBalance.amount;
  const showIgvDetraction = igvPayableBefore > 0;
  const showRentaDetraction = rentaPayableBefore > 0;

  const summaryRows = [
    {
      label: 'Impuesto del periodo',
      value: formatImpuestoPeriodo(p621.impuesto_periodo),
      emphasized: false,
    },
    {
      label: 'Crédito periodo anterior',
      value: formatTaxMoney(p621.credito_periodo_anterior),
      emphasized: false,
    },
    { label: igvSaldoFavor.label, value: formatPdt621IgvBalanceAmount(igvSaldoFavor), emphasized: true },
    {
      label: getPdt621PercepcionesRetencionesFieldLabel('Percepciones del periodo', p621.saldo_favor),
      value: formatTaxMoney(p621.percepciones_periodo),
      emphasized: false,
    },
    {
      label: getPdt621PercepcionesRetencionesFieldLabel('Percepciones periodos anteriores', p621.saldo_favor),
      value: formatTaxMoney(p621.percepciones_anteriores),
      emphasized: false,
    },
    {
      label: getPdt621PercepcionesRetencionesFieldLabel('Retenciones del periodo', p621.saldo_favor),
      value: formatTaxMoney(p621.retenciones_periodo),
      emphasized: false,
    },
    {
      label: getPdt621PercepcionesRetencionesFieldLabel('Retenciones periodos anteriores', p621.saldo_favor),
      value: formatTaxMoney(p621.retenciones_anteriores),
      emphasized: false,
    },
    {
      label: igvBalance.label,
      value: formatPdt621IgvBalanceAmount({ label: igvBalance.label, amount: igvFinalAmount }),
      emphasized: true,
    },
  ] as const;

  const rentaRows = [
    {
      label: 'Ingresos netos (base)',
      value: formatTaxRowMoney(p621.renta_ventas_base),
      emphasized: false,
    },
    {
      label: `Impuesto renta${rentaRateLabel ? ` (${rentaRateLabel})` : ''}`,
      value: formatTaxRowMoney(p621.renta_ventas_impuesto),
      emphasized: false,
    },
    {
      label: 'Saldo a favor ITAN',
      value: formatTaxMoney(p621.renta_saldo_favor_itan),
      emphasized: false,
    },
    {
      label: 'Impuesto a pagar (renta)',
      value: formatTaxTotalMoney(p621.renta_impuesto_a_pagar),
      emphasized: true,
    },
  ] as const;

  return (
    <div>
      <h4 className={PDT621_SECTION_TITLE}>1. IGV mensual</h4>
      <div className="overflow-x-auto -mx-1 px-1">
        <div className={`hidden sm:grid ${PDT621_IGV_TABLE_GRID} ${PDT621_IGV_TABLE_GAP} min-w-[38rem]`}>
          <div className={`${PDT621_IGV_TABLE_ROW} border-b border-slate-200 pb-1 mb-0.5 min-h-0 py-0`}>
            <span className={`${PDT621_IGV_HEADER_CELL} text-left self-end pb-1`}>Concepto</span>
            <span className={`${PDT621_IGV_HEADER_CELL} text-center self-end pb-1`}>Base imponible</span>
            <span className={`${PDT621_IGV_HEADER_CELL} text-center self-end pb-1`}>No gravadas</span>
            <span className={`${PDT621_IGV_HEADER_CELL} text-center self-end pb-1`}>Impuesto</span>
            <span className={`${PDT621_IGV_HEADER_CELL} text-center self-end pb-1`}>Total</span>
          </div>
          {igvRows.map(({ label, row, withNoGravadas }) => (
            <ReadOnlyIgvTableRow
              key={label}
              title={label}
              base={formatTaxMoney(row.base)}
              noGravadas={formatTaxMoney(row.no_gravadas ?? 0)}
              impuesto={formatTaxMoney(row.impuesto)}
              total={formatTaxMoney(row.total)}
              withNoGravadas={withNoGravadas}
            />
          ))}
          {summaryRows.map((item) => (
            <ReadOnlySummaryRow
              key={item.label}
              label={item.label}
              value={item.value}
              emphasized={item.emphasized}
            />
          ))}
        </div>

        <div className="sm:hidden space-y-2">
          {igvRows.map(({ label, row, withNoGravadas }) => (
            <ReadOnlyIgvTableRow
              key={`m-${label}`}
              title={label}
              base={formatTaxMoney(row.base)}
              noGravadas={formatTaxMoney(row.no_gravadas ?? 0)}
              impuesto={formatTaxMoney(row.impuesto)}
              total={formatTaxMoney(row.total)}
              withNoGravadas={withNoGravadas}
            />
          ))}
        </div>
      </div>

      <div className="pt-3 space-y-1.5 sm:hidden">
        {summaryRows.map((item) => (
          <MobileReadOnlyRow
            key={`m-${item.label}`}
            label={item.label}
            value={item.value}
            emphasized={item.emphasized}
          />
        ))}
      </div>

      {showIgvDetraction ? (
        <DetraccionReadOnlyBar
          payment={p621.detraction_payment_igv}
          appliedAmount={detractionAppliedIgv}
          payableBefore={igvPayableBefore}
          totalLabel={igvBalance.label}
          netAfterDetraction={igvNetAfterDetraction}
        />
      ) : null}

      {showFooter && igvPayableBefore > 0 ? (
        <>
          <div className="hidden sm:block overflow-x-auto -mx-1 px-1 mt-1">
            <div className={`grid ${PDT621_IGV_TABLE_GRID} ${PDT621_IGV_TABLE_GAP} min-w-[38rem]`}>
              <ReadOnlyFooterRow
                label="IGV pendiente"
                value={formatTaxTotalMoney(igvNetAfterDetraction)}
              />
            </div>
          </div>
          <div className="sm:hidden">
            <MobileReadOnlyFooterRow
              label="IGV pendiente"
              value={formatTaxTotalMoney(igvNetAfterDetraction)}
            />
          </div>
        </>
      ) : null}

      <div className="mt-1.5 pt-1 border-t border-slate-200">
        <h4 className={PDT621_SECTION_TITLE}>2. Renta mensual</h4>
        <div className="hidden sm:block overflow-x-auto -mx-1 px-1">
          <div className={`grid ${PDT621_IGV_TABLE_GRID} ${PDT621_IGV_TABLE_GAP} min-w-[38rem]`}>
            <div className={`${PDT621_IGV_TABLE_ROW} min-h-0 py-0 mb-0.5`}>
              <span className="col-span-3" aria-hidden />
              <span className={`${PDT621_IGV_HEADER_CELL} text-center self-end pb-0.5`}>Impuesto</span>
              <span aria-hidden />
            </div>
            {rentaRows.map((item) => (
              <ReadOnlySummaryRow
                key={item.label}
                label={item.label}
                value={item.value}
                emphasized={item.emphasized}
              />
            ))}
          </div>
        </div>
        {showRentaDetraction ? (
          <div className="hidden sm:block">
            <DetraccionReadOnlyBar
              payment={p621.detraction_payment_renta}
              appliedAmount={detractionAppliedRenta}
              payableBefore={rentaPayableBefore}
              totalLabel="Impuesto a pagar (renta)"
              netAfterDetraction={rentaNetAfterDetraction}
            />
          </div>
        ) : null}
        {showFooter && rentaPayableBefore > 0 ? (
          <div className="hidden sm:block overflow-x-auto -mx-1 px-1 mt-1">
            <div className={`grid ${PDT621_IGV_TABLE_GRID} ${PDT621_IGV_TABLE_GAP} min-w-[38rem]`}>
              <ReadOnlyFooterRow
                label="Renta pendiente"
                value={formatTaxTotalMoney(rentaNetAfterDetraction)}
              />
            </div>
          </div>
        ) : null}
        <div className="sm:hidden space-y-1">
          <p className={`${PDT621_IGV_HEADER_CELL} mb-1`}>Impuesto</p>
          {rentaRows.map((item) => (
            <MobileReadOnlyRow
              key={`m-${item.label}`}
              label={item.label}
              value={item.value}
              emphasized={item.emphasized}
            />
          ))}
          {showRentaDetraction ? (
            <DetraccionReadOnlyBar
              payment={p621.detraction_payment_renta}
              appliedAmount={detractionAppliedRenta}
              payableBefore={rentaPayableBefore}
              totalLabel="Impuesto a pagar (renta)"
              netAfterDetraction={rentaNetAfterDetraction}
            />
          ) : null}
          {showFooter && rentaPayableBefore > 0 ? (
            <MobileReadOnlyFooterRow
              label="Renta pendiente"
              value={formatTaxTotalMoney(rentaNetAfterDetraction)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Pdt621ReadOnlySection;
