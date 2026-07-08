import { useMemo, useState } from 'react';
import {
  computeTaxSettlementSections,
  defaultTaxSections,
  formatImpuestoPeriodo,
  formatTaxAmountInput,
  formatTaxMoney,
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
} from '../../utils/taxSettlementSections';
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

  const inputValue = focused ? (draft ?? formatTaxAmountInput(value)) : formatTaxAmountInput(value);
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
            setDraft(formatTaxAmountInput(value));
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

const SupervisorTaxSectionsForm = ({
  value,
  onChange,
  currentYear = new Date().getFullYear(),
  companyIgvRate,
  companyTaxRegime,
  igvAplicableVentas,
  rentaRegimen,
}: Props) => {
  const computed = useMemo(() => computeTaxSettlementSections(value), [value]);

  const p621Raw = computed.pdt621 ?? defaultTaxSections(currentYear).pdt621!;
  const p621 = useMemo(() => normalizePdt621IgvVentas(p621Raw, companyIgvRate), [p621Raw, companyIgvRate]);
  const rentaRatePct = getRentaMensualRatePct(rentaRegimen, p621.renta_coeficiente_pct, companyTaxRegime);
  const p601 = computed.pdt601 ?? defaultTaxSections(currentYear).pdt601!;
  const itan = computed.itan ?? defaultTaxSections(currentYear).itan!;

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
              <IGVImpuestoSummaryRow label="Saldo a favor" value={p621.saldo_favor} readOnly emphasized />
              <IGVImpuestoSummaryRow
                label="Percepciones del periodo"
                value={p621.percepciones_periodo}
                onChange={(n) => patch621({ percepciones_periodo: n })}
              />
              <IGVImpuestoSummaryRow
                label="Percepciones periodos anteriores"
                value={p621.percepciones_anteriores}
                onChange={(n) => patch621({ percepciones_anteriores: n })}
              />
              <IGVImpuestoSummaryRow
                label="Retenciones del periodo"
                value={p621.retenciones_periodo}
                onChange={(n) => patch621({ retenciones_periodo: n })}
              />
              <IGVImpuestoSummaryRow
                label="Retenciones periodos anteriores"
                value={p621.retenciones_anteriores}
                onChange={(n) => patch621({ retenciones_anteriores: n })}
              />
              <IGVImpuestoSummaryRow
                label="Saldo a favor (final)"
                value={p621.saldo_favor_final}
                readOnly
                emphasized
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
              <PdtFormRow label="Saldo a favor" emphasized>
                <AmountField label="Saldo a favor" value={p621.saldo_favor} readOnly hideLabel />
              </PdtFormRow>
            </div>

            <div className="space-y-1 pt-1">
              <PdtFormRow label="Percepciones del periodo">
                <AmountField
                  label="Percepciones del periodo"
                  value={p621.percepciones_periodo}
                  onChange={(n) => patch621({ percepciones_periodo: n })}
                  hideLabel
                />
              </PdtFormRow>
              <PdtFormRow label="Percepciones periodos anteriores">
                <AmountField
                  label="Percepciones periodos anteriores"
                  value={p621.percepciones_anteriores}
                  onChange={(n) => patch621({ percepciones_anteriores: n })}
                  hideLabel
                />
              </PdtFormRow>
              <PdtFormRow label="Retenciones del periodo">
                <AmountField
                  label="Retenciones del periodo"
                  value={p621.retenciones_periodo}
                  onChange={(n) => patch621({ retenciones_periodo: n })}
                  hideLabel
                />
              </PdtFormRow>
              <PdtFormRow label="Retenciones periodos anteriores">
                <AmountField
                  label="Retenciones periodos anteriores"
                  value={p621.retenciones_anteriores}
                  onChange={(n) => patch621({ retenciones_anteriores: n })}
                  hideLabel
                />
              </PdtFormRow>
            </div>

            <div className="pt-1">
              <PdtFormRow label="Saldo a favor (final)" emphasized>
                <AmountField label="Saldo a favor (final)" value={p621.saldo_favor_final} readOnly hideLabel />
              </PdtFormRow>
            </div>
          </div>

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
              />
            </PdtFormRow>
          </div>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100">
          <div className="text-right">
            <p className="text-xs text-slate-500">Impuesto a pagar — PDT 621</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{formatTaxMoney(p621.impuesto_a_pagar)}</p>
          </div>
        </div>
      </SectionToggle>

      <SectionToggle
        id="sec-pdt601"
        title="PDT 601 — Planilla electrónica"
        subtitle="ESSALUD, ONP, AFP y renta de 4ta y 5ta categoría."
        enabled={p601.enabled}
        onToggle={(enabled) => patch601({ enabled })}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <AmountField label="ESSALUD" value={p601.essalud} onChange={(n) => patch601({ essalud: n })} />
          <AmountField label="ONP" value={p601.onp} onChange={(n) => patch601({ onp: n })} />
          <AmountField label="AFP" value={p601.afp} onChange={(n) => patch601({ afp: n })} />
          <AmountField label="Rta 4ta categoría" value={p601.rta_4ta} onChange={(n) => patch601({ rta_4ta: n })} />
          <AmountField label="Rta 5ta categoría" value={p601.rta_5ta} onChange={(n) => patch601({ rta_5ta: n })} />
        </div>
        <div className="flex justify-end pt-2 border-t border-slate-100">
          <div className="text-right">
            <p className="text-xs text-slate-500">Impuesto a pagar — PDT 601</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{formatTaxMoney(p601.impuesto_a_pagar)}</p>
          </div>
        </div>
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
          <AmountField label="Impuesto a pagar" value={itan.impuesto_a_pagar} readOnly />
        </div>
        <div className="flex justify-end pt-2 border-t border-slate-100">
          <div className="text-right">
            <p className="text-xs text-slate-500">Impuesto a pagar — ITAN</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{formatTaxMoney(itan.impuesto_a_pagar)}</p>
          </div>
        </div>
      </SectionToggle>

      <div className="rounded-xl border-2 border-primary-200 bg-primary-50/80 px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-primary-900">Total impuestos a pagar</p>
          <p className="text-xs text-primary-800/80 mt-0.5">Suma de las secciones activas.</p>
        </div>
        <p className="text-2xl font-bold text-primary-900 tabular-nums">{formatTaxMoney(computed.grand_total_impuesto_a_pagar)}</p>
      </div>
    </div>
  );
};

export default SupervisorTaxSectionsForm;
