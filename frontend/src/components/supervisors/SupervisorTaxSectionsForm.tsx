import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  computeTaxSettlementSections,
  defaultTaxSections,
  formatImpuestoPeriodo,
  formatTaxAmountInput,
  formatTaxAmountInputEdit,
  formatPdt621IgvBalanceAmount,
  getPdt621PercepcionesRetencionesFieldLabel,
  getPdt621AppliedDetractionAmount,
  getPdt621AppliedDetractionAmountRenta,
  getPdt601AppliedDetractionAmount,
  getPdt601DetractableBeforeDetraction,
  getItanAppliedDetractionAmount,
  getItanPayableBeforeDetraction,
  getPdt621IgvBalanceLabel,
  getPdt621IgvPayableBeforeDetraction,
  getPdt621IgvSaldoFavorLabel,
  getPdt621RentaPayableBeforeDetraction,
  formatTaxMoney,
  formatTaxTotalMoney,
  formatTaxRowMoney,
  getPdt621NotasCreditoRow,
  getPdt621VentasRow,
  normalizePdt621IgvVentas,
  parseTaxAmount,
  patchPdt621NotasCreditoRow,
  patchPdt621VentasRow,
  sanitizeTaxAmountInput,
  type TaxIGVRow,
  type TaxSectionItan,
  type TaxSectionPdt601,
  type TaxSectionPdt621,
  type TaxSettlementSectionsPayload,
  type Pdt621DetractionMode,
} from '../../utils/taxSettlementSections';

const DETRACTION_PAYMENT_BUTTON_LABEL = 'Pago detracción/efectivo';
const DETRACTION_PAYMENT_APPLIED_PREFIX = 'Aplicado con detracción/efectivo';
import {
  formatRentaRateLabel,
  getRentaMensualRatePct,
  type CompanyTaxRegime,
  type LiquidationRentaRegime,
} from '../../utils/companyTaxRegime';
import {
  computeIgvFromBase,
  formatCompanyIgvRateLabel,
  type CompanyIgvRate,
} from '../../utils/companyIgv';

import {
  PDT621_IGV_HEADER_CELL,
  PDT621_IGV_TABLE_GAP,
  PDT621_IGV_TABLE_GRID,
  PDT621_IGV_TABLE_ROW,
  PDT621_ROW_GRID,
  PDT621_SECTION_TITLE,
  PDT621_SUMMARY_LABEL,
  PDT621_SUMMARY_LABEL_EMPHASIS,
} from '../taxSettlements/pdt621Layout';

type Props = {
  value: TaxSettlementSectionsPayload;
  onChange: (next: TaxSettlementSectionsPayload) => void;
  currentYear?: number;
  companyIgvRate: CompanyIgvRate;
  companyTaxRegime: CompanyTaxRegime;
  igvAplicableVentas: CompanyIgvRate[];
  rentaRegimen: LiquidationRentaRegime;
};

function AmountField({
  label,
  value,
  onChange,
  readOnly,
  className = '',
  formatValue,
  useRowMoneyFormat = false,
  hideLabel = false,
  compact = false,
}: {
  label: string;
  value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
  className?: string;
  formatValue?: (n: number) => string;
  useRowMoneyFormat?: boolean;
  hideLabel?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const readDisplay = formatValue
    ? formatValue(value)
    : useRowMoneyFormat
      ? formatTaxRowMoney(value)
      : formatTaxMoney(value);

  const inputValue = focused
    ? (draft ?? formatTaxAmountInputEdit(value))
    : formatTaxAmountInput(value);
  const fieldPadding = compact ? 'px-2 py-1' : 'px-2.5 py-2';

  return (
    <div className={className}>
      <label
        className={
          hideLabel
            ? 'sr-only'
            : `block ${compact ? 'text-xs' : 'text-[11px]'} font-medium text-slate-500 mb-1`
        }
      >
        {label}
      </label>
      {readOnly ? (
        <div className={`${fieldPadding} rounded-lg border border-slate-200 bg-slate-50 text-sm tabular-nums text-slate-800`}>
          {readDisplay}
        </div>
      ) : (
        <input
          type="text"
          inputMode="decimal"
          value={inputValue}
          onFocus={() => {
            setFocused(true);
            setDraft(formatTaxAmountInputEdit(value));
          }}
          onChange={(e) => {
            const sanitized = sanitizeTaxAmountInput(e.target.value);
            setDraft(sanitized);
            if (sanitized === '' || sanitized === '.') {
              if (sanitized === '') onChange?.(0);
              return;
            }
            if (sanitized.endsWith('.')) return;
            onChange?.(parseTaxAmount(sanitized));
          }}
          onBlur={() => {
            setFocused(false);
            if (draft !== null) {
              onChange?.(parseTaxAmount(draft));
            }
            setDraft(null);
          }}
          className={`w-full ${fieldPadding} rounded-lg border border-slate-300 text-sm tabular-nums focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none`}
          placeholder="0.00"
        />
      )}
    </div>
  );
}

/** Fila compacta estilo PDT: etiqueta a la izquierda, control a la derecha. Solo layout. */
function PdtFormRow({
  label,
  children,
  emphasized = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasized?: boolean;
}) {
  return (
    <div className={`grid grid-cols-1 ${PDT621_ROW_GRID} gap-y-0.5`}>
      <span className={`${emphasized ? PDT621_SUMMARY_LABEL_EMPHASIS : PDT621_SUMMARY_LABEL} leading-snug`}>
        {label}
      </span>
      <div className="min-w-0 w-full">{children}</div>
    </div>
  );
}

/** Fila resumen IGV alineada bajo la columna Impuesto (solo escritorio). */
function IGVImpuestoSummaryRow({
  label,
  value,
  onChange,
  readOnly,
  formatValue,
  useRowMoneyFormat,
  emphasized = false,
}: {
  label: string;
  value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
  formatValue?: (n: number) => string;
  useRowMoneyFormat?: boolean;
  emphasized?: boolean;
}) {
  return (
    <div className={`${PDT621_IGV_TABLE_ROW} min-h-0 py-0.5`}>
      <span
        className={`col-span-3 ${emphasized ? PDT621_SUMMARY_LABEL_EMPHASIS : PDT621_SUMMARY_LABEL} text-right self-center pr-1`}
      >
        {label}
      </span>
      <AmountField
        label={label}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        formatValue={formatValue}
        useRowMoneyFormat={useRowMoneyFormat}
        hideLabel
        compact
        className="min-w-0 self-center"
      />
      <span aria-hidden className="hidden sm:block" />
    </div>
  );
}

function IGVTableRow({
  title,
  row,
  onChange,
  withNoGravadas,
  igvRate,
}: {
  title: string;
  row: TaxIGVRow;
  onChange: (patch: Partial<TaxIGVRow>) => void;
  withNoGravadas: boolean;
  igvRate: CompanyIgvRate;
}) {
  const applyPatch = (patch: Partial<TaxIGVRow>) => {
    const nextBase = patch.base ?? row.base;
    const next: Partial<TaxIGVRow> = { ...patch };
    if ('base' in patch) {
      next.impuesto = computeIgvFromBase(nextBase, igvRate);
    }
    onChange(next);
  };

  const impuestoLabel = `Impuesto (${formatCompanyIgvRateLabel(igvRate)})`;

  return (
    <>
      <div className="sm:hidden space-y-2 pb-2 last:pb-0">
        <p className="text-xs font-semibold text-slate-700">{title}</p>
        <div className="grid grid-cols-2 gap-2">
          <AmountField label="Base imponible" value={row.base} onChange={(n) => applyPatch({ base: n })} />
          {withNoGravadas ? (
            <AmountField
              label="No gravadas"
              value={row.no_gravadas ?? 0}
              onChange={(n) => applyPatch({ no_gravadas: n })}
            />
          ) : null}
          <AmountField
            label={impuestoLabel}
            value={row.impuesto}
            readOnly
            useRowMoneyFormat
          />
          <AmountField label="Total" value={row.total} readOnly useRowMoneyFormat />
        </div>
      </div>
      <div className={`hidden sm:grid ${PDT621_IGV_TABLE_ROW}`}>
        <p className="text-xs font-medium text-slate-700 leading-snug pr-1 self-center">{title}</p>
        <AmountField
          label="Base imponible"
          value={row.base}
          onChange={(n) => applyPatch({ base: n })}
          hideLabel
          compact
          className="min-w-0 self-center"
        />
        {withNoGravadas ? (
          <AmountField
            label="No gravadas"
            value={row.no_gravadas ?? 0}
            onChange={(n) => applyPatch({ no_gravadas: n })}
            hideLabel
            compact
            className="min-w-0 self-center"
          />
        ) : null}
        <AmountField
          label={impuestoLabel}
          value={row.impuesto}
          readOnly
          useRowMoneyFormat
          hideLabel
          compact
          className="min-w-0 self-center"
        />
        <AmountField label="Total" value={row.total} readOnly useRowMoneyFormat hideLabel compact className="min-w-0 self-center" />
      </div>
    </>
  );
}

function SectionToggle({
  id,
  title,
  subtitle,
  enabled,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <label
        htmlFor={id}
        className="flex items-start gap-3 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100/80 transition-colors"
      >
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-800">{title}</span>
          <span className="block text-xs text-slate-500 mt-0.5">{subtitle}</span>
        </span>
      </label>
      {enabled ? <div className="p-4 space-y-4 border-t border-slate-100">{children}</div> : null}
    </div>
  );
}

function DetraccionActionBar({
  buttonLabel,
  onOpen,
  infoText,
  totalLabel,
  totalAmount,
  disabled = false,
}: {
  buttonLabel: string;
  onOpen: () => void;
  infoText: string;
  totalLabel: string;
  totalAmount: number;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-primary-200 bg-primary-50 text-primary-800 text-xs font-semibold hover:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i className="fas fa-calculator text-[11px]" aria-hidden />
          {buttonLabel}
        </button>
        <p className="mt-1.5 text-[11px] text-slate-500">{infoText}</p>
      </div>
      <div className="text-right">
        <p className="text-xs text-slate-500">{totalLabel}</p>
        <p className="text-base font-bold text-slate-900 tabular-nums">{formatTaxTotalMoney(totalAmount)}</p>
      </div>
    </div>
  );
}

function DetraccionModal({
  open,
  saving,
  sectionLabel,
  originalAmount,
  initialEnabled,
  initialMode,
  initialAmount,
  onClose,
  onApply,
  baseAmountLabel = 'Impuesto actual de la sección',
  additionalPayableAmount = 0,
  additionalPayableLabel,
}: {
  open: boolean;
  saving: boolean;
  sectionLabel: string;
  originalAmount: number;
  initialEnabled: boolean;
  initialMode: Pdt621DetractionMode;
  initialAmount: number;
  onClose: () => void;
  onApply: (next: { enabled: boolean; mode: Pdt621DetractionMode; amount: number }) => void;
  baseAmountLabel?: string;
  additionalPayableAmount?: number;
  additionalPayableLabel?: string;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [mode, setMode] = useState<Pdt621DetractionMode>(initialMode);
  const [amountInput, setAmountInput] = useState(formatTaxAmountInputEdit(initialAmount));

  useEffect(() => {
    if (!open) return;
    setEnabled(initialEnabled);
    setMode(initialMode);
    setAmountInput(formatTaxAmountInputEdit(initialAmount));
  }, [open, initialEnabled, initialMode, initialAmount]);

  if (!open) return null;

  const partialAmount = parseTaxAmount(amountInput);
  const computedApplied = !enabled || originalAmount <= 0
    ? 0
    : mode === 'total'
      ? originalAmount
      : Math.min(Math.max(partialAmount, 0), originalAmount);
  const pendingAfterDetraction = Math.max(originalAmount - computedApplied, 0) + Math.max(additionalPayableAmount, 0);
  const modalFieldName = `detraccion-mode-${sectionLabel.replace(/\s+/g, '-').toLowerCase()}`;

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar modal de pago detracción/efectivo" />
      <div className="relative w-full max-w-xl rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">{DETRACTION_PAYMENT_BUTTON_LABEL} — {sectionLabel}</h3>
          <p className="mt-1 text-sm text-slate-500">Configure si este impuesto se pagará con detracción o efectivo y cuánto se aplicará.</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm space-y-1">
            <div>
              <p className="text-slate-500">{baseAmountLabel}</p>
              <p className="text-slate-900 font-semibold tabular-nums">{formatTaxMoney(originalAmount)}</p>
            </div>
            {additionalPayableAmount > 0 && additionalPayableLabel ? (
              <div>
                <p className="text-slate-500">{additionalPayableLabel}</p>
                <p className="text-slate-900 font-semibold tabular-nums">{formatTaxMoney(additionalPayableAmount)}</p>
              </div>
            ) : null}
          </div>
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              checked={enabled}
              disabled={originalAmount <= 0}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Aplicar pago con detracción/efectivo para {sectionLabel}
          </label>
          {originalAmount <= 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No hay monto aplicable. Ingrese valores en los campos correspondientes.
            </p>
          ) : null}
          <fieldset disabled={!enabled || originalAmount <= 0} className="space-y-3 disabled:opacity-60">
            <legend className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tipo de aplicación</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={modalFieldName}
                checked={mode === 'total'}
                onChange={() => setMode('total')}
              />
              Total del impuesto aplicable
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={modalFieldName}
                checked={mode === 'parcial'}
                onChange={() => setMode('parcial')}
              />
              Parcial del impuesto aplicable
            </label>
            {mode === 'parcial' ? (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Monto con detracción/efectivo</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => setAmountInput(sanitizeTaxAmountInput(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
                  placeholder="0.00"
                />
              </div>
            ) : null}
          </fieldset>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <p className="text-emerald-800">Aplicación estimada con detracción/efectivo: <span className="font-semibold tabular-nums">{formatTaxMoney(computedApplied)}</span></p>
            <p className="text-emerald-900 mt-0.5">Impuesto pendiente luego de detracción/efectivo: <span className="font-semibold tabular-nums">{formatTaxTotalMoney(pendingAfterDetraction)}</span></p>
            {additionalPayableAmount > 0 ? (
              <p className="text-emerald-800/90 mt-1 text-xs">Incluye {additionalPayableLabel ?? 'monto adicional'}: {formatTaxMoney(additionalPayableAmount)}</p>
            ) : null}
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/80 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onApply({ enabled, mode, amount: mode === 'total' ? originalAmount : partialAmount })}
            className="px-4 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SupervisorTaxSectionsForm = ({
  value,
  onChange,
  currentYear = new Date().getFullYear(),
  companyIgvRate,
  companyTaxRegime,
  igvAplicableVentas,
  rentaRegimen,
}: Props) => {
  const [detractionModalOpenIgv, setDetractionModalOpenIgv] = useState(false);
  const [detractionModalOpenRenta, setDetractionModalOpenRenta] = useState(false);
  const [detractionModalOpenP601, setDetractionModalOpenP601] = useState(false);
  const [detractionModalOpenItan, setDetractionModalOpenItan] = useState(false);
  const computed = useMemo(() => computeTaxSettlementSections(value), [value]);

  const p621Raw = computed.pdt621 ?? defaultTaxSections(currentYear).pdt621!;
  const p621 = useMemo(() => normalizePdt621IgvVentas(p621Raw, companyIgvRate), [p621Raw, companyIgvRate]);
  const rentaRatePct = getRentaMensualRatePct(rentaRegimen, p621.renta_coeficiente_pct, companyTaxRegime);
  const p601 = computed.pdt601 ?? defaultTaxSections(currentYear).pdt601!;
  const itan = computed.itan ?? defaultTaxSections(currentYear).itan!;
  const igvBalance = getPdt621IgvBalanceLabel(p621);
  const igvSaldoFavor = getPdt621IgvSaldoFavorLabel(p621);
  const igvPayableBeforeDetraction = getPdt621IgvPayableBeforeDetraction(p621);
  const rentaPayableBeforeDetraction = getPdt621RentaPayableBeforeDetraction(p621);
  const detractionAppliedIgv = getPdt621AppliedDetractionAmount(p621);
  const detractionAppliedRenta = getPdt621AppliedDetractionAmountRenta(p621);
  const igvNetAfterDetraction = Math.max(igvPayableBeforeDetraction - detractionAppliedIgv, 0);
  const rentaNetAfterDetraction = Math.max(rentaPayableBeforeDetraction - detractionAppliedRenta, 0);
  const detractionInfoIgv = p621.detraction_payment_igv ?? {
    enabled: false,
    mode: 'parcial' as Pdt621DetractionMode,
    amount: 0,
    applied_amount: 0,
    original_amount: igvPayableBeforeDetraction,
  };
  const detractionInfoRenta = p621.detraction_payment_renta ?? {
    enabled: false,
    mode: 'parcial' as Pdt621DetractionMode,
    amount: 0,
    applied_amount: 0,
    original_amount: rentaPayableBeforeDetraction,
  };
  const p601PayableBefore = getPdt601DetractableBeforeDetraction(p601);
  const detractionAppliedP601 = getPdt601AppliedDetractionAmount(p601);
  const detractionInfoP601 = p601.detraction_payment ?? {
    enabled: false,
    mode: 'parcial' as Pdt621DetractionMode,
    amount: 0,
    applied_amount: 0,
    original_amount: p601PayableBefore,
  };
  const itanPayableBeforeDetraction = getItanPayableBeforeDetraction(itan);
  const detractionAppliedItan = getItanAppliedDetractionAmount(itan);
  const detractionInfoItan = itan.detraction_payment ?? {
    enabled: false,
    mode: 'parcial' as Pdt621DetractionMode,
    amount: 0,
    applied_amount: 0,
    original_amount: itanPayableBeforeDetraction,
  };
  const showIgvDetraction = p621.saldo_favor_final > 0;
  const showRentaDetraction = rentaPayableBeforeDetraction > 0;
  const showP601Detraction = p601.enabled;
  const showItanDetraction = itan.enabled;
  const p601DetractionInfoText =
    detractionInfoP601.enabled && detractionAppliedP601 > 0
      ? `${DETRACTION_PAYMENT_APPLIED_PREFIX}: ${formatTaxMoney(detractionAppliedP601)} (${detractionInfoP601.mode === 'total' ? 'total' : 'parcial'}).`
      : p601PayableBefore > 0
        ? 'Indique si la planilla se pagará con detracción/efectivo (total o parcial).'
        : 'Ingrese montos de planilla para configurar pago con detracción/efectivo.';

  const patch = (partial: Partial<TaxSettlementSectionsPayload>) => {
    onChange(computeTaxSettlementSections({ ...value, ...partial }));
  };

  const patch621 = (partial: Partial<TaxSectionPdt621>) => {
    patch({ pdt621: { ...p621, ...partial } });
  };

  const patchVentasByRate = (rate: CompanyIgvRate, rowPatch: Partial<TaxIGVRow>) => {
    const current = getPdt621VentasRow(p621, rate);
    const nextBase = rowPatch.base ?? current.base;
    const next: Partial<TaxIGVRow> = { ...rowPatch };
    if ('base' in rowPatch) {
      next.impuesto = computeIgvFromBase(nextBase, rate);
    }
    patch621(patchPdt621VentasRow(p621, rate, next));
  };

  const patchNotasByRate = (rate: CompanyIgvRate, rowPatch: Partial<TaxIGVRow>) => {
    const current = getPdt621NotasCreditoRow(p621, rate);
    const nextBase = rowPatch.base ?? current.base;
    const next: Partial<TaxIGVRow> = { ...rowPatch };
    if ('base' in rowPatch) {
      next.impuesto = computeIgvFromBase(nextBase, rate);
    }
    patch621(patchPdt621NotasCreditoRow(p621, rate, next));
  };

  const patchIGV = (key: 'compras_105' | 'compras_18', rowPatch: Partial<TaxIGVRow>, igvRate: CompanyIgvRate) => {
    const row = p621[key];
    const nextBase = rowPatch.base ?? row.base;
    const next: Partial<TaxIGVRow> = { ...rowPatch };
    if ('base' in rowPatch) {
      next.impuesto = computeIgvFromBase(nextBase, igvRate);
    }
    patch621({ [key]: { ...row, ...next } });
  };

  const patch601 = (partial: Partial<TaxSectionPdt601>) => {
    patch({ pdt601: { ...p601, ...partial } });
  };

  const patchItan = (partial: Partial<TaxSectionItan>) => {
    patch({ itan: { ...itan, ...partial } });
  };

  return (
    <div className="space-y-4">
      <SectionToggle
        id="sec-pdt621"
        title="PDT 621 — IGV y Renta"
        subtitle="IGV mensual, créditos, percepciones y renta mensual."
        enabled={p621.enabled}
        onToggle={(enabled) => patch621({ enabled })}
      >
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
              {igvAplicableVentas.map((rate) => (
                <div key={`ventas-nc-${rate}`} className="contents">
                  <IGVTableRow
                    title={`Ventas netas (${formatCompanyIgvRateLabel(rate)})`}
                    row={getPdt621VentasRow(p621, rate)}
                    onChange={(p) => patchVentasByRate(rate, p)}
                    withNoGravadas
                    igvRate={rate}
                  />
                  <IGVTableRow
                    title={`(−) Notas de crédito (${formatCompanyIgvRateLabel(rate)})`}
                    row={getPdt621NotasCreditoRow(p621, rate)}
                    onChange={(p) => patchNotasByRate(rate, p)}
                    withNoGravadas
                    igvRate={rate}
                  />
                </div>
              ))}
              <IGVTableRow
                title="(−) Compras 10.5 %"
                row={p621.compras_105}
                onChange={(p) => patchIGV('compras_105', p, 10.5)}
                withNoGravadas
                igvRate={10.5}
              />
              <IGVTableRow
                title="(−) Compras 18 %"
                row={p621.compras_18}
                onChange={(p) => patchIGV('compras_18', p, 18)}
                withNoGravadas
                igvRate={18}
              />
              <IGVImpuestoSummaryRow
                label="Impuesto del periodo"
                value={p621.impuesto_periodo}
                readOnly
                formatValue={formatImpuestoPeriodo}
              />
              <IGVImpuestoSummaryRow
                label="Crédito periodo anterior"
                value={p621.credito_periodo_anterior}
                onChange={(n) => patch621({ credito_periodo_anterior: n })}
              />
              <IGVImpuestoSummaryRow
                label={igvSaldoFavor.label}
                value={igvSaldoFavor.amount}
                readOnly
                emphasized
                formatValue={(n) => formatPdt621IgvBalanceAmount({ label: igvSaldoFavor.label, amount: n })}
              />
              <IGVImpuestoSummaryRow
                label={getPdt621PercepcionesRetencionesFieldLabel('Percepciones del periodo', p621.saldo_favor)}
                value={p621.percepciones_periodo}
                onChange={(n) => patch621({ percepciones_periodo: n })}
              />
              <IGVImpuestoSummaryRow
                label={getPdt621PercepcionesRetencionesFieldLabel('Percepciones periodos anteriores', p621.saldo_favor)}
                value={p621.percepciones_anteriores}
                onChange={(n) => patch621({ percepciones_anteriores: n })}
              />
              <IGVImpuestoSummaryRow
                label={getPdt621PercepcionesRetencionesFieldLabel('Retenciones del periodo', p621.saldo_favor)}
                value={p621.retenciones_periodo}
                onChange={(n) => patch621({ retenciones_periodo: n })}
              />
              <IGVImpuestoSummaryRow
                label={getPdt621PercepcionesRetencionesFieldLabel('Retenciones periodos anteriores', p621.saldo_favor)}
                value={p621.retenciones_anteriores}
                onChange={(n) => patch621({ retenciones_anteriores: n })}
              />
              <IGVImpuestoSummaryRow
                label={igvBalance.label}
                value={igvBalance.amount}
                readOnly
                emphasized
                formatValue={(n) => formatPdt621IgvBalanceAmount({ label: igvBalance.label, amount: n })}
              />
            </div>
            <div className="sm:hidden space-y-2">
              {igvAplicableVentas.map((rate) => (
                <div key={`ventas-nc-m-${rate}`} className="space-y-2">
                  <IGVTableRow
                    title={`Ventas netas (${formatCompanyIgvRateLabel(rate)})`}
                    row={getPdt621VentasRow(p621, rate)}
                    onChange={(p) => patchVentasByRate(rate, p)}
                    withNoGravadas
                    igvRate={rate}
                  />
                  <IGVTableRow
                    title={`(−) Notas de crédito (${formatCompanyIgvRateLabel(rate)})`}
                    row={getPdt621NotasCreditoRow(p621, rate)}
                    onChange={(p) => patchNotasByRate(rate, p)}
                    withNoGravadas
                    igvRate={rate}
                  />
                </div>
              ))}
              <IGVTableRow
                title="(−) Compras 10.5 %"
                row={p621.compras_105}
                onChange={(p) => patchIGV('compras_105', p, 10.5)}
                withNoGravadas
                igvRate={10.5}
              />
              <IGVTableRow
                title="(−) Compras 18 %"
                row={p621.compras_18}
                onChange={(p) => patchIGV('compras_18', p, 18)}
                withNoGravadas
                igvRate={18}
              />
            </div>
          </div>
          <div className="pt-3 space-y-1.5 sm:hidden">
            <div className="space-y-1">
              <PdtFormRow label="Impuesto del periodo">
                <AmountField
                  label="Impuesto del periodo"
                  value={p621.impuesto_periodo}
                  readOnly
                  formatValue={formatImpuestoPeriodo}
                  hideLabel
                />
              </PdtFormRow>
              <PdtFormRow label="Crédito periodo anterior">
                <AmountField
                  label="Crédito periodo anterior"
                  value={p621.credito_periodo_anterior}
                  onChange={(n) => patch621({ credito_periodo_anterior: n })}
                  hideLabel
                />
              </PdtFormRow>
              <PdtFormRow label={igvSaldoFavor.label} emphasized>
                <AmountField
                  label={igvSaldoFavor.label}
                  value={igvSaldoFavor.amount}
                  readOnly
                  hideLabel
                  formatValue={(n) => formatPdt621IgvBalanceAmount({ label: igvSaldoFavor.label, amount: n })}
                />
              </PdtFormRow>
            </div>

            <div className="space-y-1 pt-1">
              <PdtFormRow label={getPdt621PercepcionesRetencionesFieldLabel('Percepciones del periodo', p621.saldo_favor)}>
                <AmountField
                  label={getPdt621PercepcionesRetencionesFieldLabel('Percepciones del periodo', p621.saldo_favor)}
                  value={p621.percepciones_periodo}
                  onChange={(n) => patch621({ percepciones_periodo: n })}
                  hideLabel
                />
              </PdtFormRow>
              <PdtFormRow label={getPdt621PercepcionesRetencionesFieldLabel('Percepciones periodos anteriores', p621.saldo_favor)}>
                <AmountField
                  label={getPdt621PercepcionesRetencionesFieldLabel('Percepciones periodos anteriores', p621.saldo_favor)}
                  value={p621.percepciones_anteriores}
                  onChange={(n) => patch621({ percepciones_anteriores: n })}
                  hideLabel
                />
              </PdtFormRow>
              <PdtFormRow label={getPdt621PercepcionesRetencionesFieldLabel('Retenciones del periodo', p621.saldo_favor)}>
                <AmountField
                  label={getPdt621PercepcionesRetencionesFieldLabel('Retenciones del periodo', p621.saldo_favor)}
                  value={p621.retenciones_periodo}
                  onChange={(n) => patch621({ retenciones_periodo: n })}
                  hideLabel
                />
              </PdtFormRow>
              <PdtFormRow label={getPdt621PercepcionesRetencionesFieldLabel('Retenciones periodos anteriores', p621.saldo_favor)}>
                <AmountField
                  label={getPdt621PercepcionesRetencionesFieldLabel('Retenciones periodos anteriores', p621.saldo_favor)}
                  value={p621.retenciones_anteriores}
                  onChange={(n) => patch621({ retenciones_anteriores: n })}
                  hideLabel
                />
              </PdtFormRow>
            </div>

            <div className="pt-1">
              <PdtFormRow label={igvBalance.label} emphasized>
                <AmountField
                  label={igvBalance.label}
                  value={igvBalance.amount}
                  readOnly
                  hideLabel
                  formatValue={(n) => formatPdt621IgvBalanceAmount({ label: igvBalance.label, amount: n })}
                />
              </PdtFormRow>
            </div>
          </div>

          {showIgvDetraction ? (
          <DetraccionActionBar
            buttonLabel={DETRACTION_PAYMENT_BUTTON_LABEL}
            onOpen={() => setDetractionModalOpenIgv(true)}
            infoText={
              detractionInfoIgv.enabled && detractionAppliedIgv > 0
                ? `${DETRACTION_PAYMENT_APPLIED_PREFIX}: ${formatTaxMoney(detractionAppliedIgv)} (${detractionInfoIgv.mode === 'total' ? 'total' : 'parcial'})`
                : 'Sin aplicación de detracción/efectivo.'
            }
            totalLabel={igvBalance.label}
            totalAmount={igvNetAfterDetraction}
          />
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
              <IGVImpuestoSummaryRow
                label="Ingresos netos (base)"
                value={p621.renta_ventas_base}
                readOnly
                useRowMoneyFormat
              />
              <IGVImpuestoSummaryRow
                label={`Impuesto renta (${formatRentaRateLabel(rentaRatePct)})`}
                value={p621.renta_ventas_impuesto}
                readOnly
                useRowMoneyFormat
              />
              <IGVImpuestoSummaryRow
                label="Saldo a favor ITAN"
                value={p621.renta_saldo_favor_itan}
                onChange={(n) => patch621({ renta_saldo_favor_itan: n })}
              />
              <IGVImpuestoSummaryRow
                label="Impuesto a pagar (renta)"
                value={p621.renta_impuesto_a_pagar}
                readOnly
                emphasized
                formatValue={formatTaxTotalMoney}
              />
            </div>
          </div>
          <div className="sm:hidden space-y-1">
            <p className={`${PDT621_IGV_HEADER_CELL} mb-1`}>Impuesto</p>
            <PdtFormRow label="Ingresos netos (base)">
              <AmountField
                label="Ingresos netos (base)"
                value={p621.renta_ventas_base}
                readOnly
                useRowMoneyFormat
                hideLabel
              />
            </PdtFormRow>
            <PdtFormRow label={`Impuesto renta (${formatRentaRateLabel(rentaRatePct)})`}>
              <AmountField
                label={`Impuesto renta (${formatRentaRateLabel(rentaRatePct)})`}
                value={p621.renta_ventas_impuesto}
                readOnly
                useRowMoneyFormat
                hideLabel
              />
            </PdtFormRow>
            <PdtFormRow label="Saldo a favor ITAN">
              <AmountField
                label="Saldo a favor ITAN"
                value={p621.renta_saldo_favor_itan}
                onChange={(n) => patch621({ renta_saldo_favor_itan: n })}
                hideLabel
              />
            </PdtFormRow>
            <PdtFormRow label="Impuesto a pagar (renta)" emphasized>
              <AmountField
                label="Impuesto a pagar (renta)"
                value={p621.renta_impuesto_a_pagar}
                readOnly
                hideLabel
                formatValue={formatTaxTotalMoney}
              />
            </PdtFormRow>
          </div>
          {showRentaDetraction ? (
          <DetraccionActionBar
            buttonLabel={DETRACTION_PAYMENT_BUTTON_LABEL}
            onOpen={() => setDetractionModalOpenRenta(true)}
            infoText={
              detractionInfoRenta.enabled && detractionAppliedRenta > 0
                ? `${DETRACTION_PAYMENT_APPLIED_PREFIX}: ${formatTaxMoney(detractionAppliedRenta)} (${detractionInfoRenta.mode === 'total' ? 'total' : 'parcial'})`
                : 'Sin aplicación de detracción/efectivo.'
            }
            totalLabel="Impuesto a pagar (renta)"
            totalAmount={rentaNetAfterDetraction}
          />
          ) : null}
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100">
          <div className="text-right">
            <p className="text-xs text-slate-500">Impuesto a pagar — PDT 621</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{formatTaxTotalMoney(p621.impuesto_a_pagar)}</p>
          </div>
        </div>
      </SectionToggle>

      <SectionToggle
        id="sec-pdt601"
        title="PDT 601 — Planilla electrónica"
        subtitle="ESSALUD, SIS, ONP, AFP y renta de 4ta y 5ta categoría."
        enabled={p601.enabled}
        onToggle={(enabled) => patch601({ enabled })}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <AmountField label="ESSALUD" value={p601.essalud} onChange={(n) => patch601({ essalud: n })} />
          <AmountField label="SIS" value={p601.sis ?? 0} onChange={(n) => patch601({ sis: n })} />
          <AmountField label="ONP" value={p601.onp} onChange={(n) => patch601({ onp: n })} />
          <AmountField label="AFP" value={p601.afp} onChange={(n) => patch601({ afp: n })} />
          <AmountField label="Rta 4ta categoría" value={p601.rta_4ta} onChange={(n) => patch601({ rta_4ta: n })} />
          <AmountField label="Rta 5ta categoría" value={p601.rta_5ta} onChange={(n) => patch601({ rta_5ta: n })} />
        </div>
        {showP601Detraction ? (
        <DetraccionActionBar
          buttonLabel={DETRACTION_PAYMENT_BUTTON_LABEL}
          onOpen={() => setDetractionModalOpenP601(true)}
          disabled={p601PayableBefore <= 0}
          infoText={p601DetractionInfoText}
          totalLabel="Impuesto a pagar — PDT 601"
          totalAmount={p601.impuesto_a_pagar}
        />
        ) : null}
      </SectionToggle>

      <SectionToggle
        id="sec-itan"
        title={`ITAN ${currentYear}`}
        subtitle="Cuota del Impuesto Temporal a los Activos Netos."
        enabled={itan.enabled}
        onToggle={(enabled) => patchItan({ enabled, year: currentYear })}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Cuota N°</label>
            <input
              type="number"
              min={1}
              max={12}
              value={itan.cuota_nro}
              onChange={(e) => patchItan({ cuota_nro: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 outline-none"
            />
          </div>
          <AmountField label="Impuesto" value={itan.impuesto} onChange={(n) => patchItan({ impuesto: n })} />
          <AmountField label="Impuesto a pagar" value={itan.impuesto_a_pagar} readOnly formatValue={formatTaxTotalMoney} />
        </div>
        {showItanDetraction ? (
        <DetraccionActionBar
          buttonLabel={DETRACTION_PAYMENT_BUTTON_LABEL}
          onOpen={() => setDetractionModalOpenItan(true)}
          disabled={itanPayableBeforeDetraction <= 0}
          infoText={
            detractionInfoItan.enabled && detractionAppliedItan > 0
              ? `${DETRACTION_PAYMENT_APPLIED_PREFIX}: ${formatTaxMoney(detractionAppliedItan)} (${detractionInfoItan.mode === 'total' ? 'total' : 'parcial'})`
              : itanPayableBeforeDetraction > 0
                ? 'Indique si esta cuota ITAN se pagará con detracción/efectivo (total o parcial).'
                : 'Ingrese el impuesto ITAN para configurar pago con detracción/efectivo.'
          }
          totalLabel="Impuesto a pagar — ITAN"
          totalAmount={itan.impuesto_a_pagar}
        />
        ) : null}
      </SectionToggle>

      <div className="rounded-xl border-2 border-primary-200 bg-primary-50/80 px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-primary-900">Total impuestos a pagar</p>
          <p className="text-xs text-primary-800/80 mt-0.5">Suma de las secciones activas.</p>
        </div>
        <p className="text-2xl font-bold text-primary-900 tabular-nums">{formatTaxTotalMoney(computed.grand_total_impuesto_a_pagar)}</p>
      </div>
      <DetraccionModal
        open={detractionModalOpenIgv}
        saving={false}
        sectionLabel="IGV mensual"
        originalAmount={igvPayableBeforeDetraction}
        initialEnabled={detractionInfoIgv.enabled}
        initialMode={detractionInfoIgv.mode}
        initialAmount={detractionInfoIgv.mode === 'total' ? igvPayableBeforeDetraction : detractionInfoIgv.amount}
        onClose={() => setDetractionModalOpenIgv(false)}
        onApply={(next) => {
          patch621({
            detraction_payment_igv: {
              enabled: next.enabled && igvPayableBeforeDetraction > 0,
              mode: next.mode,
              amount: next.mode === 'total' ? igvPayableBeforeDetraction : next.amount,
              applied_amount: 0,
              original_amount: igvPayableBeforeDetraction,
            },
          });
          setDetractionModalOpenIgv(false);
        }}
      />
      <DetraccionModal
        open={detractionModalOpenRenta}
        saving={false}
        sectionLabel="Renta mensual"
        originalAmount={rentaPayableBeforeDetraction}
        initialEnabled={detractionInfoRenta.enabled}
        initialMode={detractionInfoRenta.mode}
        initialAmount={detractionInfoRenta.mode === 'total' ? rentaPayableBeforeDetraction : detractionInfoRenta.amount}
        onClose={() => setDetractionModalOpenRenta(false)}
        onApply={(next) => {
          patch621({
            detraction_payment_renta: {
              enabled: next.enabled && rentaPayableBeforeDetraction > 0,
              mode: next.mode,
              amount: next.mode === 'total' ? rentaPayableBeforeDetraction : next.amount,
              applied_amount: 0,
              original_amount: rentaPayableBeforeDetraction,
            },
          });
          setDetractionModalOpenRenta(false);
        }}
      />
      <DetraccionModal
        open={detractionModalOpenP601}
        saving={false}
        sectionLabel="PDT 601"
        originalAmount={p601PayableBefore}
        baseAmountLabel="Monto aplicable (ESSALUD, SIS, ONP, AFP, Rta 4ta/5ta)"
        initialEnabled={detractionInfoP601.enabled}
        initialMode={detractionInfoP601.mode}
        initialAmount={detractionInfoP601.mode === 'total' ? p601PayableBefore : detractionInfoP601.amount}
        onClose={() => setDetractionModalOpenP601(false)}
        onApply={(next) => {
          patch601({
            detraction_payment: {
              enabled: next.enabled && p601PayableBefore > 0,
              mode: next.mode,
              amount: next.mode === 'total' ? p601PayableBefore : next.amount,
              applied_amount: 0,
              original_amount: p601PayableBefore,
            },
          });
          setDetractionModalOpenP601(false);
        }}
      />
      <DetraccionModal
        open={detractionModalOpenItan}
        saving={false}
        sectionLabel={`ITAN ${currentYear}`}
        originalAmount={itanPayableBeforeDetraction}
        initialEnabled={detractionInfoItan.enabled}
        initialMode={detractionInfoItan.mode}
        initialAmount={detractionInfoItan.mode === 'total' ? itanPayableBeforeDetraction : detractionInfoItan.amount}
        onClose={() => setDetractionModalOpenItan(false)}
        onApply={(next) => {
          patchItan({
            detraction_payment: {
              enabled: next.enabled && itanPayableBeforeDetraction > 0,
              mode: next.mode,
              amount: next.mode === 'total' ? itanPayableBeforeDetraction : next.amount,
              applied_amount: 0,
              original_amount: itanPayableBeforeDetraction,
            },
          });
          setDetractionModalOpenItan(false);
        }}
      />
    </div>
  );
};

export default SupervisorTaxSectionsForm;
