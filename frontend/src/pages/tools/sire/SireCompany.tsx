import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { SIRE_LIBROS, sirePropuestaFileName, sireService, type SireApiError, type SireDownloadStep, type SireLibro } from '../../../services/sire';
import { SireErrorBox } from './SireShared';
import { INPUT_CLS, sireMissing } from './sireUi';

type Progress = { state: 'idle' } | { state: 'running'; step: SireDownloadStep } | { state: 'done' } | { state: 'error'; error: SireApiError };

const STEP_LABEL: Record<SireDownloadStep, string> = {
  solicitando: 'Solicitando la propuesta a SUNAT…',
  esperando: 'SUNAT está preparando el archivo…',
  generando: 'Generando el Excel…',
};

/** Mes anterior en formato AAAA-MM (es el período que normalmente se descarga). */
function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Herramientas → SIRE → una empresa: elegir el período y descargar en Excel la propuesta de ventas (RVIE) y de
 * compras (RCE) que tiene SUNAT.
 */
const SireCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [month, setMonth] = useState(previousMonth());
  const [progress, setProgress] = useState<Record<SireLibro, Progress>>({ ventas: { state: 'idle' }, compras: { state: 'idle' } });

  useEffect(() => {
    if (!Number.isFinite(companyId) || companyId <= 0) return;
    let alive = true;
    companyAccessCredentialsService
      .get(companyId)
      .then((r) => {
        if (alive) setCompany(r);
      })
      .catch(() => {
        if (alive) setCompanyError('No se pudo cargar la empresa (¿no está en su alcance?).');
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  const missing = company ? sireMissing(company) : '';
  const period = month.replace('-', '');
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const busy = progress.ventas.state === 'running' || progress.compras.state === 'running';

  const download = async (libro: SireLibro) => {
    if (!company) return;
    setProgress((p) => ({ ...p, [libro]: { state: 'running', step: 'solicitando' } }));
    try {
      await sireService.downloadPropuestaExcel(companyId, { libro, period, ruc: company.ruc }, (step) =>
        setProgress((p) => ({ ...p, [libro]: { state: 'running', step } })),
      );
      setProgress((p) => ({ ...p, [libro]: { state: 'done' } }));
    } catch (e) {
      setProgress((p) => ({ ...p, [libro]: { state: 'error', error: e as SireApiError } }));
    }
  };

  const fileHint = useMemo(() => (company && validMonth ? sirePropuestaFileName(company.ruc, period, 'ventas') : ''), [company, validMonth, period]);

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;
  }

  return (
    <div className="space-y-5 pt-2">
      <div>
        <Link to="/tools/sire" className="text-xs font-semibold text-primary-700 hover:underline">
          <i className="fas fa-arrow-left mr-1" aria-hidden />
          Volver a la lista
        </Link>
        <PageHeading className="mt-1">{company?.business_name || 'SIRE'}</PageHeading>
        <p className="mt-1 text-sm font-medium text-slate-500">
          {company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}
        </p>
      </div>

      {companyError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{companyError}</p> : null}

      {company && missing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Falta cargar: <strong>{missing}</strong>. Complételo en{' '}
          <Link to="/finance/claves-sol" className="font-semibold underline">
            Claves SOL
          </Link>{' '}
          (botón Editar de la empresa) para poder descargar del SIRE.
        </div>
      ) : null}

      {company && !missing ? (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="text-xs text-slate-600">
              <span className="mb-0.5 block">Período</span>
              <input type="month" value={month} max={currentMonth()} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLS} />
            </label>
            <Button
              className="ml-auto"
              disabled={busy || !validMonth}
              onClick={() => {
                void download('ventas');
                void download('compras');
              }}
            >
              <i className="fas fa-file-excel mr-1.5" aria-hidden />
              Descargar ventas y compras
            </Button>
          </div>
          {fileHint ? (
            <p className="-mt-3 text-xs text-slate-500">
              Cada descarga es un Excel con la propuesta de comprobantes que tiene SUNAT para el período, por ejemplo <span className="font-mono">{fileHint}</span>.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {SIRE_LIBROS.map((l) => {
              const pr = progress[l.value];
              return (
                <section key={l.value} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">{l.label}</h3>
                    <p className="text-xs text-slate-500">Propuesta de comprobantes del período, en Excel.</p>
                  </div>
                  <Button className="self-start" disabled={busy || !validMonth} onClick={() => void download(l.value)}>
                    <i className={`fas ${pr.state === 'running' ? 'fa-spinner fa-spin' : 'fa-download'} mr-1.5`} aria-hidden />
                    Descargar {l.short.toLowerCase()}
                  </Button>
                  {pr.state === 'running' ? (
                    <p className="text-sm text-slate-500" role="status">
                      {STEP_LABEL[pr.step]}
                    </p>
                  ) : null}
                  {pr.state === 'done' ? <p className="text-sm text-green-700">Excel descargado.</p> : null}
                  {pr.state === 'error' ? (
                    pr.error.code === 'sin_datos' ? (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{pr.error.message}</p>
                    ) : (
                      <SireErrorBox error={pr.error} onRetry={() => void download(l.value)} />
                    )
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
};

export default SireCompany;
