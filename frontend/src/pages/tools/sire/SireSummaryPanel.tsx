import { useCallback, useState } from 'react';
import Button from '../../../components/ui/Button';
import { sireService, type SireApiError, type SireLibro } from '../../../services/sire';
import { Card, JsonKeyValues, SireErrorBox, SireTableModal, Spinner } from './SireShared';
import { SELECT_CLS } from './sireUi';

const SUMMARY_TYPES = [
  { value: '1', label: 'Resumen de la propuesta' },
  { value: '2', label: 'Resumen del preliminar' },
  { value: '3', label: 'Resumen de no incluidos / excluidos' },
  { value: '4', label: 'Resumen del registro generado' },
  { value: '5', label: 'Resumen del preliminar registrado' },
  { value: '6', label: 'Resumen de ajustes posteriores' },
  { value: '7', label: 'Resumen de no domiciliados' },
];

const INCONSISTENCY_TYPES = SUMMARY_TYPES.slice(0, 6);

interface Props {
  companyId: number;
  libro: SireLibro;
  period: string;
}

/** Resumen de comprobantes (tabla descargable) e inconsistencias del período. */
const SireSummaryPanel = ({ companyId, libro, period }: Props) => {
  const [tipo, setTipo] = useState('1');
  const [open, setOpen] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlError, setDlError] = useState<SireApiError | null>(null);

  const [itipo, setItipo] = useState('1');
  const [incons, setIncons] = useState<unknown>(undefined);
  const [iLoading, setILoading] = useState(false);
  const [iError, setIError] = useState<SireApiError | null>(null);

  const loadSummary = useCallback(
    (view: { table: number; page: number; per_page: number; q: string }) =>
      sireService.summaryPreview(companyId, { libro, period, tipo, page: view.page, per_page: view.per_page, q: view.q }).then((d) => d),
    [companyId, libro, period, tipo],
  );

  const download = async () => {
    setDlBusy(true);
    setDlError(null);
    try {
      await sireService.downloadSummary(companyId, { libro, period, tipo });
    } catch (e) {
      setDlError(e as SireApiError);
    } finally {
      setDlBusy(false);
    }
  };

  const consultInconsistencies = async () => {
    setILoading(true);
    setIError(null);
    setIncons(undefined);
    try {
      setIncons(await sireService.inconsistencies(companyId, { libro, period, tipo: itipo }));
    } catch (e) {
      setIError(e as SireApiError);
    } finally {
      setILoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Resumen de comprobantes" subtitle="Cantidad e importes por tipo de comprobante, según la etapa del registro.">
        <div className="flex flex-wrap items-center gap-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={SELECT_CLS} aria-label="Tipo de resumen">
            {SUMMARY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <Button onClick={() => setOpen(true)}>
            <i className="fas fa-table mr-1.5" aria-hidden />
            Ver
          </Button>
          <Button variant="secondary" disabled={dlBusy} onClick={() => void download()}>
            <i className={`fas ${dlBusy ? 'fa-spinner fa-spin' : 'fa-download'} mr-1.5`} aria-hidden />
            Descargar CSV
          </Button>
        </div>
        {dlError ? (
          <div className="mt-3">
            <SireErrorBox error={dlError} />
          </div>
        ) : null}
        {open ? (
          <SireTableModal title={`${SUMMARY_TYPES.find((t) => t.value === tipo)?.label ?? 'Resumen'} · ${period}`} load={loadSummary} onClose={() => setOpen(false)} />
        ) : null}
      </Card>

      <Card title="Inconsistencias" subtitle="Porcentaje y total de comprobantes y montos con inconsistencias detectadas por SUNAT.">
        <div className="flex flex-wrap items-center gap-2">
          <select value={itipo} onChange={(e) => setItipo(e.target.value)} className={SELECT_CLS} aria-label="Etapa">
            {INCONSISTENCY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label.replace('Resumen de ', '').replace('Resumen del ', '')}
              </option>
            ))}
          </select>
          <Button onClick={() => void consultInconsistencies()} disabled={iLoading}>
            Consultar
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {iLoading ? <Spinner /> : null}
          {iError ? <SireErrorBox error={iError} onRetry={() => void consultInconsistencies()} /> : null}
          {incons !== undefined && !iLoading && !iError ? <JsonKeyValues value={incons} /> : null}
        </div>
      </Card>
    </div>
  );
};

export default SireSummaryPanel;
