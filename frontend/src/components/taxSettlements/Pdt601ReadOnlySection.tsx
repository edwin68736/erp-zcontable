import {
  formatTaxMoney,
  listPdt601DisplayRows,
  type TaxSectionPdt601,
} from '../../utils/taxSettlementSections';
import {
  PDT621_IGV_HEADER_CELL,
  PDT621_IGV_TABLE_GAP,
  PDT621_IGV_TABLE_GRID,
  PDT621_IGV_TABLE_ROW,
  PDT621_READONLY_AMOUNT,
  PDT621_ROW_GRID,
  PDT621_SUMMARY_LABEL,
} from './pdt621Layout';

type Props = {
  p601: TaxSectionPdt601;
  showFooter?: boolean;
};

function ReadOnlyAmount({ value, className = '' }: { value: string; className?: string }) {
  return <div className={`${PDT621_READONLY_AMOUNT} ${className}`.trim()}>{value}</div>;
}

function ReadOnlyListRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${PDT621_IGV_TABLE_ROW} min-h-0 py-0.5`}>
      <span className={`col-span-3 ${PDT621_SUMMARY_LABEL} text-right self-center pr-1 leading-snug`}>{label}</span>
      <ReadOnlyAmount value={value} className="min-w-0 self-center" />
      <span aria-hidden className="hidden sm:block" />
    </div>
  );
}

function MobileReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={`grid grid-cols-1 ${PDT621_ROW_GRID} gap-y-0.5`}>
      <span className={`${PDT621_SUMMARY_LABEL} leading-snug`}>{label}</span>
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

export function Pdt601ReadOnlySection({ p601, showFooter = true }: Props) {
  const rows = listPdt601DisplayRows(p601);

  return (
    <div>
      <div className="overflow-x-auto -mx-1 px-1">
        <div className={`hidden sm:grid ${PDT621_IGV_TABLE_GRID} ${PDT621_IGV_TABLE_GAP} min-w-[38rem]`}>
          <div className={`${PDT621_IGV_TABLE_ROW} min-h-0 py-0 mb-0.5`}>
            <span className="col-span-3" aria-hidden />
            <span className={`${PDT621_IGV_HEADER_CELL} text-center self-end pb-0.5`}>Impuesto</span>
            <span aria-hidden />
          </div>
          {rows.map((item) => (
            <ReadOnlyListRow key={item.label} label={item.label} value={formatTaxMoney(item.value)} />
          ))}
          {showFooter ? (
            <ReadOnlyFooterRow
              label="Impuesto a pagar — PDT 601"
              value={formatTaxMoney(p601.impuesto_a_pagar)}
            />
          ) : null}
        </div>
      </div>

      <div className="sm:hidden space-y-1.5">
        <p className={`${PDT621_IGV_HEADER_CELL} mb-0.5`}>Impuesto</p>
        {rows.map((item) => (
          <MobileReadOnlyRow key={`m-${item.label}`} label={item.label} value={formatTaxMoney(item.value)} />
        ))}
        {showFooter ? (
          <MobileReadOnlyFooterRow
            label="Impuesto a pagar — PDT 601"
            value={formatTaxMoney(p601.impuesto_a_pagar)}
          />
        ) : null}
      </div>
    </div>
  );
}

export default Pdt601ReadOnlySection;
