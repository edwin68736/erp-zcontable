import TaxSettlementSectionsSummary, { hasTaxSectionsData } from './TaxSettlementSectionsSummary';

type Props = {
  pdt621Json?: string | null;
  className?: string;
};

/** Bloque de solo lectura con la información fiscal registrada por el supervisor. */
export function SupervisorFiscalDataPanel({ pdt621Json, className = '' }: Props) {
  if (!hasTaxSectionsData(pdt621Json)) return null;

  return (
    <section
      className={`w-full min-w-0 rounded-xl border border-sky-200 bg-sky-50/40 shadow-sm overflow-hidden ${className}`}
      aria-labelledby="supervisor-fiscal-panel-title"
    >
      <div className="px-4 py-3 border-b border-sky-100 bg-sky-50/90 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="supervisor-fiscal-panel-title" className="text-sm font-semibold text-sky-950">
            Información fiscal del supervisor
          </h3>
          <p className="text-xs text-sky-900/80 mt-0.5 max-w-2xl leading-relaxed">
            Datos registrados por el área de supervisores. Solo consulta: en Finanzas se completan deudas, líneas y
            emisión.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-md border border-sky-200 bg-white text-[11px] font-semibold uppercase tracking-wide text-sky-800">
          <i className="fas fa-lock text-[10px]" aria-hidden />
          Solo lectura
        </span>
      </div>
      <div className="p-4 sm:p-5 bg-white">
        <TaxSettlementSectionsSummary pdt621Json={pdt621Json} variant="embedded" collapsible />
      </div>
    </section>
  );
}

export default SupervisorFiscalDataPanel;
