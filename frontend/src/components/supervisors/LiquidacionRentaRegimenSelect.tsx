import {
  formatRentaRateLabel,
  getRentaMensualRatePct,
  LIQUIDATION_RENTA_REGIME_OPTIONS,
  type CompanyTaxRegime,
  type LiquidationRentaRegime,
} from '../../utils/companyTaxRegime';
import {
  formatTaxAmountInput,
  parseTaxAmount,
  sanitizeTaxAmountInput,
} from '../../utils/taxSettlementSections';

type Props = {
  regimen: LiquidationRentaRegime;
  companyTaxRegime: CompanyTaxRegime;
  coeficientePct: number;
  onRegimenChange: (next: LiquidationRentaRegime) => void;
  onCoeficienteChange: (pct: number) => void;
};

const selectClass =
  'w-full max-w-xs px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none bg-white';

const LiquidacionRentaRegimenSelect = ({
  regimen,
  companyTaxRegime,
  coeficientePct,
  onRegimenChange,
  onCoeficienteChange,
}: Props) => {
  const appliedRate = getRentaMensualRatePct(regimen, coeficientePct, companyTaxRegime);
  const isCompanyRegime = regimen !== 'coeficiente' && regimen === companyTaxRegime;

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
        <label htmlFor="liq-renta-regimen" className="sr-only">
          Régimen tributario
        </label>
        <select
          id="liq-renta-regimen"
          value={regimen}
          onChange={(e) => onRegimenChange(e.target.value as LiquidationRentaRegime)}
          className={selectClass}
        >
          {LIQUIDATION_RENTA_REGIME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
              {opt.sunatRate != null ? ` (${opt.sunatRate} %)` : ''}
              {opt.value === companyTaxRegime ? ' · empresa' : ''}
            </option>
          ))}
        </select>
        {regimen === 'coeficiente' ? (
          <div className="flex items-center gap-1.5 w-full max-w-[8.5rem] shrink-0">
            <label htmlFor="liq-renta-coeficiente" className="sr-only">
              Coeficiente
            </label>
            <input
              id="liq-renta-coeficiente"
              type="text"
              inputMode="decimal"
              value={coeficientePct === 0 ? '' : formatTaxAmountInput(coeficientePct)}
              onChange={(e) => onCoeficienteChange(parseTaxAmount(sanitizeTaxAmountInput(e.target.value)))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              placeholder="0.00"
              aria-label="Coeficiente (%)"
            />
            <span className="text-sm text-slate-500 shrink-0">%</span>
          </div>
        ) : null}
      </div>
      <p className="text-[11px] text-slate-500">
        Tasa aplicada: <span className="font-medium text-slate-700">{formatRentaRateLabel(appliedRate)}</span>
        {isCompanyRegime ? <span className="text-slate-400"> · empresa</span> : null}
      </p>
    </div>
  );
};

export default LiquidacionRentaRegimenSelect;
