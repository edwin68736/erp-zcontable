import { createPortal } from 'react-dom';
import type { Company } from '../../types/dashboard';
import { formatCompanyIgvRateLabel, type CompanyIgvRate } from '../../utils/companyIgv';
import {
  formatLiquidationRentaRegimeLabel,
  formatRentaRateLabel,
  getRentaMensualRatePct,
  type CompanyTaxRegime,
  type LiquidationRentaRegime,
} from '../../utils/companyTaxRegime';
import { type TaxSettlementSectionsPayload } from '../../utils/taxSettlementSections';
import { TaxSettlementSectionsSummary } from '../taxSettlements/TaxSettlementSectionsSummary';

type Props = {
  open: boolean;
  saving: boolean;
  isEdit: boolean;
  company: Company;
  issueDate: string;
  liquidationPeriod: string;
  periodLabel: string;
  igvAplicableVentas: CompanyIgvRate[];
  rentaRegimen: LiquidationRentaRegime;
  rentaCoeficientePct: number;
  companyTaxRegime: CompanyTaxRegime;
  taxSections: TaxSettlementSectionsPayload;
  onClose: () => void;
  onSave: () => void;
};

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-800 text-right font-medium">{value}</span>
    </div>
  );
}

const SupervisorLiquidacionPreviewModal = ({
  open,
  saving,
  isEdit,
  company,
  issueDate,
  liquidationPeriod,
  periodLabel,
  igvAplicableVentas,
  rentaRegimen,
  rentaCoeficientePct,
  companyTaxRegime,
  taxSections,
  onClose,
  onSave,
}: Props) => {
  if (!open) return null;

  const rentaRate = getRentaMensualRatePct(rentaRegimen, rentaCoeficientePct, companyTaxRegime);
  const hasSections = Boolean(
    taxSections.pdt621?.enabled || taxSections.pdt601?.enabled || taxSections.itan?.enabled,
  );

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => !saving && onClose()}
        aria-label="Cerrar vista previa"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sup-liq-preview-title"
        className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200"
      >
        <div className="px-5 py-4 border-b border-slate-100 shrink-0">
          <h2 id="sup-liq-preview-title" className="text-lg font-semibold text-slate-900">
            Vista previa de la liquidación
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Así se guardará la información en borrador. Revise los datos antes de confirmar.
          </p>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4 flex-1 min-h-0">
          <div className="rounded-lg border border-slate-200 p-3 space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Empresa</p>
            <PreviewRow label="Razón social" value={company.business_name} />
            <PreviewRow label="RUC" value={company.ruc || '—'} />
            <PreviewRow label="Código" value={company.code || '—'} />
          </div>

          <div className="rounded-lg border border-slate-200 p-3 space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Liquidación</p>
            <PreviewRow label="Fecha de emisión" value={issueDate} />
            <PreviewRow label="Periodo" value={`${periodLabel} (${liquidationPeriod})`} />
            <PreviewRow
              label="IGV ventas / NC"
              value={igvAplicableVentas.map((r) => formatCompanyIgvRateLabel(r)).join(', ') || '—'}
            />
            <PreviewRow label="Régimen renta" value={formatLiquidationRentaRegimeLabel(rentaRegimen)} />
            <PreviewRow label="Tasa renta" value={formatRentaRateLabel(rentaRate)} />
            {rentaRegimen === 'coeficiente' ? (
              <PreviewRow label="Coeficiente" value={`${rentaCoeficientePct} %`} />
            ) : null}
          </div>

          {hasSections ? (
            <TaxSettlementSectionsSummary sections={taxSections} />
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No hay secciones fiscales activas. Active al menos PDT 621, 601 o ITAN para registrar montos.
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 bg-slate-50/80 border-t border-slate-100 rounded-b-2xl shrink-0">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <i className="fas fa-spinner fa-spin text-xs" aria-hidden /> : null}
            {isEdit ? 'Guardar cambios' : 'Guardar liquidación'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SupervisorLiquidacionPreviewModal;
