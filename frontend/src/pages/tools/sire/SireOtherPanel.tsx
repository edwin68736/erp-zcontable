import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { sireService, type SireApiError, type SireLibro } from '../../../services/sire';
import { Card, JsonKeyValues, JsonTable, SireErrorBox, Spinner } from './SireShared';
import { INPUT_CLS, pickRecords } from './sireUi';

interface Props {
  companyId: number;
  libro: SireLibro;
  period: string;
}

/** Resultado de una consulta JSON: lista de registros como tabla, o el objeto como campo → valor. */
function JsonResult({ value }: { value: unknown }) {
  const recs = pickRecords(value);
  return recs ? <JsonTable rows={recs} /> : <JsonKeyValues value={value} />;
}

/** Hook mínimo para una consulta puntual con carga/error/resultado. */
function useQuery<T>() {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SireApiError | null>(null);
  const run = async (fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    setValue(undefined);
    try {
      setValue(await fn());
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setLoading(false);
    }
  };
  return { value, loading, error, run };
}

/** Preliminares registrados, FV0621 y ajustes posteriores (compras) y constancias de recepción. */
const SireOtherPanel = ({ companyId, libro, period }: Props) => {
  const year = period.slice(0, 4);
  const [perIni, setPerIni] = useState(`${year}01`);
  const [perFin, setPerFin] = useState(`${year}12`);
  const prelim = useQuery<unknown>();
  const fv = useQuery<unknown>();
  const ajustes = useQuery<unknown>();

  const [constName, setConstName] = useState('');
  const [constBusy, setConstBusy] = useState(false);
  const [constError, setConstError] = useState<SireApiError | null>(null);

  const downloadConstancia = async () => {
    setConstBusy(true);
    setConstError(null);
    try {
      await sireService.downloadConstancia(companyId, { libro, name: constName.trim() });
    } catch (e) {
      setConstError(e as SireApiError);
    } finally {
      setConstBusy(false);
    }
  };

  const rangeOk = /^\d{6}$/.test(perIni) && /^\d{6}$/.test(perFin) && perIni <= perFin;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Preliminares registrados" subtitle="Preliminares que ya se registraron en SUNAT entre dos períodos.">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            <span className="mb-0.5 block">Desde (AAAAMM)</span>
            <input value={perIni} onChange={(e) => setPerIni(e.target.value.replace(/\D/g, '').slice(0, 6))} className={`${INPUT_CLS} w-28`} inputMode="numeric" />
          </label>
          <label className="text-xs text-slate-600">
            <span className="mb-0.5 block">Hasta (AAAAMM)</span>
            <input value={perFin} onChange={(e) => setPerFin(e.target.value.replace(/\D/g, '').slice(0, 6))} className={`${INPUT_CLS} w-28`} inputMode="numeric" />
          </label>
          <Button disabled={!rangeOk || prelim.loading} onClick={() => void prelim.run(() => sireService.preliminares(companyId, { per_ini: perIni, per_fin: perFin, page: 1, per_page: 100 }))}>
            Consultar
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {prelim.loading ? <Spinner /> : null}
          {prelim.error ? <SireErrorBox error={prelim.error} /> : null}
          {prelim.value !== undefined && !prelim.loading ? <JsonResult value={prelim.value} /> : null}
        </div>
      </Card>

      <Card title="Constancia de recepción" subtitle="PDF de la constancia del registro generado. El nombre del archivo figura en el ticket de generación.">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={constName}
            onChange={(e) => setConstName(e.target.value)}
            placeholder="Nombre del archivo, p. ej. LE20123456789…pdf"
            className={`${INPUT_CLS} min-w-[18rem] flex-1`}
          />
          <Button disabled={!constName.trim() || constBusy} onClick={() => void downloadConstancia()}>
            <i className={`fas ${constBusy ? 'fa-spinner fa-spin' : 'fa-file-pdf'} mr-1.5`} aria-hidden />
            Descargar
          </Button>
        </div>
        {constError ? (
          <div className="mt-3">
            <SireErrorBox error={constError} />
          </div>
        ) : null}
      </Card>

      {libro === 'compras' ? (
        <>
          <Card title="FV0621 (crédito fiscal)" subtitle={`Prorrata, reintegro y crédito fiscal especial del período ${period}.`}>
            <Button disabled={fv.loading} onClick={() => void fv.run(() => sireService.fv0621(companyId, period))}>
              Consultar
            </Button>
            <div className="mt-3 space-y-2">
              {fv.loading ? <Spinner /> : null}
              {fv.error ? <SireErrorBox error={fv.error} /> : null}
              {fv.value !== undefined && !fv.loading ? <JsonResult value={fv.value} /> : null}
            </div>
          </Card>
          <Card title="Ajustes posteriores del RCE" subtitle={`Código de ajuste y comprobantes de ajustes posteriores del período ${period}.`}>
            <Button disabled={ajustes.loading} onClick={() => void ajustes.run(() => sireService.ajustes(companyId, { period, page: 1, per_page: 100 }))}>
              Consultar
            </Button>
            <div className="mt-3 space-y-2">
              {ajustes.loading ? <Spinner /> : null}
              {ajustes.error ? <SireErrorBox error={ajustes.error} /> : null}
              {ajustes.value !== undefined && !ajustes.loading ? <JsonResult value={ajustes.value} /> : null}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
};

export default SireOtherPanel;
