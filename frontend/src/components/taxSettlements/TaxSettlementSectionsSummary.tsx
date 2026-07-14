import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { formatCompanyIgvRateLabel } from '../../utils/companyIgv';
import {
  formatLiquidationRentaRegimeLabel,
  formatRentaRateLabel,
  getRentaMensualRatePct,
} from '../../utils/companyTaxRegime';
import {
  computeTaxSettlementSections,
  formatTaxMoney,
  formatTaxTotalMoney,
  getItanAppliedDetractionAmount,
  getItanPayableBeforeDetraction,
  getPdt617AppliedDetractionAmount,
  getPdt617GrossBeforeDetraction,
  getBolsasPlasticasAppliedDetractionAmount,
  getBolsasPlasticasPayableBeforeDetraction,
  getPdt710AppliedDetractionAmount,
  getPdt710PayableBeforeDetraction,
  isNonZeroTaxAmount,
  parseTaxSectionsJson,
  type TaxSettlementSectionsPayload,
} from '../../utils/taxSettlementSections';
import Pdt621ReadOnlySection from './Pdt621ReadOnlySection';
import Pdt601ReadOnlySection from './Pdt601ReadOnlySection';
import DetraccionReadOnlyBar from './DetraccionReadOnlyBar';

type Props = {
  pdt621Json?: string | null;
  sections?: TaxSettlementSectionsPayload | null;
  className?: string;
  /** embedded = dentro del panel Finanzas; sin título duplicado */
  variant?: 'default' | 'embedded';
  /** Secciones PDT/ITAN desplegables (Finanzas). */
  collapsible?: boolean;
};

function SectionBlock({
  title,
  subtitle,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
          <h4 className="text-xs font-semibold text-slate-800">{title}</h4>
          {subtitle ? <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p> : null}
        </div>
        <div className="p-3 space-y-3 text-sm">{children}</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3 text-left hover:bg-slate-100/80 transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-800">{title}</span>
          {subtitle ? <span className="block text-[11px] text-slate-500 mt-0.5">{subtitle}</span> : null}
        </span>
        <i
          className={`fas fa-chevron-down text-[10px] text-slate-400 mt-1 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? <div className="p-3 space-y-3 text-sm">{children}</div> : null}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-3 ${bold ? 'font-semibold text-slate-900 pt-1 border-t border-slate-100' : 'text-slate-700'}`}
    >
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums shrink-0 text-right">{value}</span>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm text-slate-800 mt-0.5 leading-snug">{value}</p>
    </div>
  );
}

export function TaxSettlementSectionsSummary({
  pdt621Json,
  sections: sectionsProp,
  className = '',
  variant = 'default',
  collapsible = false,
}: Props) {
  const sections = useMemo(() => {
    if (sectionsProp) return computeTaxSettlementSections(sectionsProp);
    return parseTaxSectionsJson(pdt621Json);
  }, [pdt621Json, sectionsProp]);
  if (!sections) return null;

  const hasAny =
    sections.pdt621?.enabled ||
    sections.pdt601?.enabled ||
    sections.itan?.enabled ||
    sections.pdt617?.enabled ||
    sections.bolsas_plasticas?.enabled ||
    sections.pdt710?.enabled;
  if (!hasAny) return null;

  const numeroTrabajadores = sections.numero_trabajadores ?? 0;
  const p621 = sections.pdt621;
  const igvRatesLabel =
    p621?.enabled && p621.igv_aplicable_ventas?.length
      ? p621.igv_aplicable_ventas.map((r) => formatCompanyIgvRateLabel(r)).join(' · ')
      : null;
  const rentaRegimen = p621?.renta_regimen;
  const rentaRatePct =
    p621?.enabled && rentaRegimen
      ? getRentaMensualRatePct(rentaRegimen, p621.renta_coeficiente_pct ?? 0)
      : null;
  const itan = sections.itan;
  const itanPayableBefore = itan ? getItanPayableBeforeDetraction(itan) : 0;
  const itanDetractionApplied = itan ? getItanAppliedDetractionAmount(itan) : 0;
  const showItanDetraction = Boolean(itan?.enabled);
  const p617 = sections.pdt617;
  const p617PayableBefore = p617 ? getPdt617GrossBeforeDetraction(p617) : 0;
  const p617DetractionApplied = p617 ? getPdt617AppliedDetractionAmount(p617) : 0;
  const bolsas = sections.bolsas_plasticas;
  const bolsasPayableBefore = bolsas ? getBolsasPlasticasPayableBeforeDetraction(bolsas) : 0;
  const bolsasDetractionApplied = bolsas ? getBolsasPlasticasAppliedDetractionAmount(bolsas) : 0;
  const p710 = sections.pdt710;
  const p710PayableBefore = p710 ? getPdt710PayableBeforeDetraction(p710) : 0;
  const p710DetractionApplied = p710 ? getPdt710AppliedDetractionAmount(p710) : 0;

  return (
    <div className={`space-y-4 ${className}`}>
      {variant === 'default' ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Detalle fiscal (supervisor)</h3>
        </div>
      ) : null}

      {numeroTrabajadores > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            N° de trabajadores
          </span>
          <span className="text-sm font-semibold text-slate-800 tabular-nums">{numeroTrabajadores}</span>
        </div>
      ) : null}

      {sections.pdt621?.enabled ? (
        <SectionBlock
          title="PDT 621 — IGV y Renta"
          subtitle="Impuesto mensual, créditos, percepciones, retenciones y renta."
          collapsible={collapsible}
          defaultOpen={false}
        >
          {igvRatesLabel || rentaRegimen ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {igvRatesLabel ? (
                <MetaChip label="IGV aplicable (ventas y NC)" value={igvRatesLabel} />
              ) : null}
              {rentaRegimen && rentaRatePct != null ? (
                <MetaChip
                  label="Régimen renta mensual"
                  value={`${formatLiquidationRentaRegimeLabel(rentaRegimen)} · ${formatRentaRateLabel(rentaRatePct)}`}
                />
              ) : null}
            </div>
          ) : null}

          <Pdt621ReadOnlySection p621={sections.pdt621!} rentaRatePct={rentaRatePct} />
        </SectionBlock>
      ) : null}

      {sections.pdt601?.enabled ? (
        <SectionBlock title="PDT 601 — Planilla electrónica" collapsible={collapsible} defaultOpen={false}>
          <Pdt601ReadOnlySection p601={sections.pdt601} />
        </SectionBlock>
      ) : null}

      {sections.itan?.enabled ? (
        <SectionBlock
          title={`ITAN ${sections.itan.year} — Cuota ${sections.itan.cuota_nro}`}
          collapsible={collapsible}
          defaultOpen={false}
        >
          <Row label="Impuesto" value={formatTaxTotalMoney(sections.itan.impuesto)} />
          {showItanDetraction ? (
            <DetraccionReadOnlyBar
              payment={sections.itan.detraction_payment}
              appliedAmount={itanDetractionApplied}
              payableBefore={itanPayableBefore}
              totalLabel="ITAN pendiente"
              netAfterDetraction={sections.itan.impuesto_a_pagar}
            />
          ) : (
            <Row label="ITAN pendiente" value={formatTaxTotalMoney(sections.itan.impuesto_a_pagar)} bold />
          )}
        </SectionBlock>
      ) : null}

      {p617?.enabled ? (
        <SectionBlock title="PDT 617 — Otras retenciones" collapsible={collapsible} defaultOpen={false}>
          <Row label="Retenciones de IGV (base)" value={formatTaxMoney(p617.retencion_igv_base)} />
          <Row label="Retenciones de IGV (impuesto)" value={formatTaxMoney(p617.retencion_igv_impuesto)} />
          <Row label="Retenciones de renta (base)" value={formatTaxMoney(p617.retencion_renta_base)} />
          <Row label="Retenciones de renta (impuesto)" value={formatTaxMoney(p617.retencion_renta_impuesto)} />
          {p617PayableBefore > 0 ? (
            <DetraccionReadOnlyBar
              payment={p617.detraction_payment}
              appliedAmount={p617DetractionApplied}
              payableBefore={p617PayableBefore}
              totalLabel="Impuesto a pagar"
              netAfterDetraction={p617.impuesto_a_pagar}
            />
          ) : (
            <Row label="Impuesto a pagar" value={formatTaxTotalMoney(p617.impuesto_a_pagar)} bold />
          )}
        </SectionBlock>
      ) : null}

      {bolsas?.enabled ? (
        <SectionBlock title="Impuesto consumo bolsas plásticas" collapsible={collapsible} defaultOpen={false}>
          <Row label="Impuesto consumo bolsas plásticas" value={formatTaxMoney(bolsas.impuesto)} />
          {isNonZeroTaxAmount(bolsas.saldo_favor_anterior) ? (
            <Row label="Saldo a favor periodo anterior" value={formatTaxMoney(bolsas.saldo_favor_anterior)} />
          ) : null}
          {bolsasPayableBefore > 0 ? (
            <DetraccionReadOnlyBar
              payment={bolsas.detraction_payment}
              appliedAmount={bolsasDetractionApplied}
              payableBefore={bolsasPayableBefore}
              totalLabel="Impuesto a pagar"
              netAfterDetraction={bolsas.impuesto_a_pagar}
            />
          ) : (
            <Row label="Impuesto a pagar" value={formatTaxTotalMoney(bolsas.impuesto_a_pagar)} bold />
          )}
        </SectionBlock>
      ) : null}

      {p710?.enabled ? (
        <SectionBlock
          title={`PDT 710 — Renta anual ${p710.year}`}
          collapsible={collapsible}
          defaultOpen={false}
        >
          <Row label="Renta anual resultante" value={formatTaxMoney(p710.renta_anual_resultante)} />
          {isNonZeroTaxAmount(p710.saldo_favor_anterior) ? (
            <Row label="Saldo a favor periodo anterior" value={formatTaxMoney(p710.saldo_favor_anterior)} />
          ) : null}
          {p710PayableBefore > 0 ? (
            <DetraccionReadOnlyBar
              payment={p710.detraction_payment}
              appliedAmount={p710DetractionApplied}
              payableBefore={p710PayableBefore}
              totalLabel="Impuesto a pagar"
              netAfterDetraction={p710.impuesto_a_pagar}
            />
          ) : (
            <Row label="Impuesto a pagar" value={formatTaxTotalMoney(p710.impuesto_a_pagar)} bold />
          )}
        </SectionBlock>
      ) : null}

      <div className="rounded-lg border-2 border-primary-200 bg-primary-50/70 px-4 py-3 flex flex-wrap justify-between items-center gap-3">
        <span className="text-sm font-semibold text-primary-900">Total impuestos a pagar</span>
        <span className="text-xl font-bold text-primary-900 tabular-nums">
          {formatTaxTotalMoney(sections.grand_total_impuesto_a_pagar)}
        </span>
      </div>
    </div>
  );
}

export function hasTaxSectionsData(pdt621Json?: string | null): boolean {
  const s = parseTaxSectionsJson(pdt621Json) as TaxSettlementSectionsPayload | null;
  if (!s) return false;
  return Boolean(
    s.pdt621?.enabled ||
      s.pdt601?.enabled ||
      s.itan?.enabled ||
      s.pdt617?.enabled ||
      s.bolsas_plasticas?.enabled ||
      s.pdt710?.enabled,
  );
}

export default TaxSettlementSectionsSummary;
