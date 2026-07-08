import {
  formatCompanyIgvRateLabel,
  LIQUIDATION_IGV_RATES,
  toggleLiquidationIgvRate,
  type CompanyIgvRate,
} from '../../utils/companyIgv';

type Props = {
  rates: CompanyIgvRate[];
  companyIgvRate: CompanyIgvRate;
  onChange: (next: CompanyIgvRate[]) => void;
  showHelp?: boolean;
};

function IgvRateCheckboxes({
  rates,
  companyIgvRate,
  onChange,
  idPrefix,
}: {
  rates: CompanyIgvRate[];
  companyIgvRate: CompanyIgvRate;
  onChange: (next: CompanyIgvRate[]) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {LIQUIDATION_IGV_RATES.map((rate) => {
        const id = `${idPrefix}-${rate}`;
        const checked = rates.includes(rate);
        const isCompanyRate = rate === companyIgvRate;
        return (
          <label key={rate} htmlFor={id} className="inline-flex items-center gap-2 cursor-pointer text-sm text-slate-800">
            <input
              id={id}
              type="checkbox"
              checked={checked}
              onChange={(e) => onChange(toggleLiquidationIgvRate(rates, rate, e.target.checked))}
              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span>
              {formatCompanyIgvRateLabel(rate)}
              {isCompanyRate ? <span className="ml-1 text-xs text-slate-500">(empresa)</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

const LiquidacionIgvAplicableToggle = ({ rates, companyIgvRate, onChange, showHelp = false }: Props) => {
  if (!showHelp) {
    return <IgvRateCheckboxes rates={rates} companyIgvRate={companyIgvRate} onChange={onChange} idPrefix="igv-aplicable" />;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-700">IGV aplicable — ventas y notas de crédito</p>
      <p className="text-[11px] text-slate-500 leading-snug">
        Seleccione una o ambas tasas. Por defecto se marca el IGV de la empresa (
        {formatCompanyIgvRateLabel(companyIgvRate)}). Las compras se registran aparte al 10.5 % o 18 %.
      </p>
      <IgvRateCheckboxes rates={rates} companyIgvRate={companyIgvRate} onChange={onChange} idPrefix="igv-ventas" />
    </div>
  );
};

export default LiquidacionIgvAplicableToggle;
