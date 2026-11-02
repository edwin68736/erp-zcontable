import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { SIRE_LIBROS, formatSirePeriod, sireService, type SireApiError, type SireLibro, type SirePeriodYear } from '../../../services/sire';
import SireOtherPanel from './SireOtherPanel';
import SireReportsPanel from './SireReportsPanel';
import { SireErrorBox, Spinner } from './SireShared';
import { SELECT_CLS, sireMissing } from './sireUi';
import SireSummaryPanel from './SireSummaryPanel';
import SireTicketsPanel from './SireTicketsPanel';

type Tab = 'resumen' | 'reportes' | 'tickets' | 'otros';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'resumen', label: 'Resumen', icon: 'fas fa-chart-pie' },
  { id: 'reportes', label: 'Propuesta y reportes', icon: 'fas fa-file-arrow-down' },
  { id: 'tickets', label: 'Tickets', icon: 'fas fa-ticket' },
  { id: 'otros', label: 'Otras consultas', icon: 'fas fa-ellipsis' },
];

/** Último período del listado (los años/meses vienen ordenados de forma distinta según el libro). */
function latestPeriod(years: SirePeriodYear[]): string {
  const all = years.flatMap((y) => (y.lisPeriodos ?? []).map((p) => p.perTributario)).filter(Boolean);
  const sorted = all.sort();
  return sorted[sorted.length - 1] ?? '';
}

/**
 * Herramientas → SIRE → una empresa: elige libro (ventas/compras) y período, y ofrece todo lo que SUNAT entrega por
 * API: resumen e inconsistencias, propuesta y reportes (por ticket), historial de tickets y otras consultas.
 */
const SireCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [libro, setLibro] = useState<SireLibro>('ventas');
  const [tab, setTab] = useState<Tab>('resumen');
  const [years, setYears] = useState<SirePeriodYear[]>([]);
  const [period, setPeriod] = useState('');
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState<SireApiError | null>(null);
  const [testState, setTestState] = useState<'idle' | 'running' | 'ok' | SireApiError>('idle');

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

  const loadPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    setPeriodsError(null);
    try {
      const ys = await sireService.periods(companyId, libro);
      setYears(ys);
      setPeriod((cur) => (cur && ys.some((y) => y.lisPeriodos?.some((p) => p.perTributario === cur)) ? cur : latestPeriod(ys)));
    } catch (e) {
      setYears([]);
      setPeriod('');
      setPeriodsError(e as SireApiError);
    } finally {
      setPeriodsLoading(false);
    }
  }, [companyId, libro]);

  useEffect(() => {
    if (!company || missing) return;
    void loadPeriods();
  }, [company, missing, loadPeriods]);

  const year = period.slice(0, 4);
  const monthsOfYear = useMemo(() => years.find((y) => y.numEjercicio === year)?.lisPeriodos ?? [], [years, year]);

  const runTest = async () => {
    setTestState('running');
    try {
      await sireService.test(companyId);
      setTestState('ok');
    } catch (e) {
      setTestState(e as SireApiError);
    }
  };

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
          (botón Editar de la empresa) para poder consultar el SIRE.
        </div>
      ) : null}

      {company && !missing ? (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Libro">
              {SIRE_LIBROS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLibro(l.value)}
                  aria-pressed={libro === l.value}
                  className={`px-4 py-2 text-sm font-semibold ${libro === l.value ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <label className="text-xs text-slate-600">
              <span className="mb-0.5 block">Año</span>
              <select
                value={year}
                disabled={periodsLoading || years.length === 0}
                onChange={(e) => {
                  const ys = years.find((y) => y.numEjercicio === e.target.value);
                  const sortedP = (ys?.lisPeriodos ?? []).map((p) => p.perTributario).sort();
                  const last = sortedP[sortedP.length - 1];
                  if (last) setPeriod(last);
                }}
                className={SELECT_CLS}
              >
                {years.map((y) => (
                  <option key={y.numEjercicio} value={y.numEjercicio}>
                    {y.numEjercicio}
                    {y.desEstado ? ` — ${y.desEstado}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              <span className="mb-0.5 block">Período</span>
              <select value={period} disabled={periodsLoading || monthsOfYear.length === 0} onChange={(e) => setPeriod(e.target.value)} className={SELECT_CLS}>
                {[...monthsOfYear]
                  .sort((a, b) => a.perTributario.localeCompare(b.perTributario))
                  .map((p) => (
                    <option key={p.perTributario} value={p.perTributario}>
                      {formatSirePeriod(p.perTributario)}
                      {p.desEstado ? ` — ${p.desEstado}` : ''}
                    </option>
                  ))}
              </select>
            </label>

            <Button variant="secondary" onClick={() => void runTest()} disabled={testState === 'running'} className="ml-auto">
              <i className={`fas ${testState === 'running' ? 'fa-spinner fa-spin' : 'fa-plug'} mr-1.5`} aria-hidden />
              Probar conexión
            </Button>
          </div>

          {testState === 'ok' ? (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">Conexión correcta: SUNAT aceptó las credenciales de API de esta empresa.</p>
          ) : typeof testState === 'object' ? (
            <SireErrorBox error={testState} />
          ) : null}

          {periodsLoading ? <Spinner label="Consultando períodos en SUNAT…" /> : null}
          {periodsError ? <SireErrorBox error={periodsError} onRetry={() => void loadPeriods()} /> : null}

          {period && !periodsError ? (
            <>
              <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                      tab === t.id ? 'border-blue-900 text-blue-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <i className={`${t.icon} mr-1.5`} aria-hidden />
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'resumen' ? <SireSummaryPanel companyId={companyId} libro={libro} period={period} /> : null}
              {tab === 'reportes' ? <SireReportsPanel companyId={companyId} libro={libro} period={period} /> : null}
              {tab === 'tickets' ? <SireTicketsPanel companyId={companyId} libro={libro} period={period} /> : null}
              {tab === 'otros' ? <SireOtherPanel companyId={companyId} libro={libro} period={period} /> : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

export default SireCompany;
