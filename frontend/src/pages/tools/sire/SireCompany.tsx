import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import {
  SIRE_LIBROS,
  formatSirePeriod,
  saveBlobAs,
  sirePropuestaFileName,
  sireService,
  type SireApiError,
  type SireDownloadStep,
  type SireLibro,
  type SirePeriodYear,
} from '../../../services/sire';
import { mergePeriodExcels, periodsBetween, type PeriodExcel } from './sireExcel';
import { SireErrorBox, Spinner } from './SireShared';
import { SELECT_CLS, sireMissing } from './sireUi';

type Progress = { state: 'idle' } | { state: 'running'; text: string } | { state: 'done'; text: string } | { state: 'error'; error: SireApiError };

type Mode = 'periodo' | 'rango';

const MAX_RANGE = 12;

const STEP_LABEL: Record<SireDownloadStep, string> = {
  solicitando: 'Solicitando la propuesta a SUNAT…',
  esperando: 'SUNAT está preparando el archivo…',
  generando: 'Generando el Excel…',
};

/** Todos los períodos AAAAMM del listado de SUNAT, sin repetir y en orden (el listado viene agrupado por año). */
function allPeriods(years: SirePeriodYear[]): string[] {
  return Array.from(new Set(years.flatMap((y) => (y.lisPeriodos ?? []).map((p) => p.perTributario)).filter(Boolean))).sort();
}

/**
 * Herramientas → SIRE → una empresa: elegir libro (ventas/compras), año y período —o un rango de períodos— y
 * descargar en Excel la propuesta de comprobantes que tiene SUNAT.
 */
const SireCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [libro, setLibro] = useState<SireLibro>('ventas');
  const [mode, setMode] = useState<Mode>('periodo');
  const [years, setYears] = useState<SirePeriodYear[]>([]);
  const [period, setPeriod] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState<SireApiError | null>(null);
  const [testState, setTestState] = useState<'idle' | 'running' | 'ok' | SireApiError>('idle');
  const [progress, setProgress] = useState<Record<SireLibro, Progress>>({ ventas: { state: 'idle' }, compras: { state: 'idle' } });
  const [rangeProgress, setRangeProgress] = useState<Progress>({ state: 'idle' });

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
      const list = allPeriods(ys);
      const last = list[list.length - 1] ?? '';
      setPeriod((cur) => (cur && list.includes(cur) ? cur : last));
      setHasta((cur) => (cur && list.includes(cur) ? cur : last));
      setDesde((cur) => (cur && list.includes(cur) ? cur : (list[Math.max(0, list.length - 3)] ?? '')));
    } catch (e) {
      setYears([]);
      setPeriod('');
      setDesde('');
      setHasta('');
      setPeriodsError(e as SireApiError);
    } finally {
      setPeriodsLoading(false);
    }
  }, [companyId, libro]);

  useEffect(() => {
    if (!company || missing) return;
    void loadPeriods();
  }, [company, missing, loadPeriods]);

  const periodList = useMemo(() => allPeriods(years), [years]);
  const periodMeta = useMemo(() => {
    const m = new Map<string, string>();
    for (const y of years) for (const p of y.lisPeriodos ?? []) m.set(p.perTributario, p.desEstado ?? '');
    return m;
  }, [years]);
  const year = period.slice(0, 4);
  const monthsOfYear = useMemo(() => periodList.filter((p) => p.startsWith(year)), [periodList, year]);

  const rangeOptions = useMemo(() => periodList.map((p) => ({ value: p, label: `${formatSirePeriod(p)}${periodMeta.get(p) ? ` — ${periodMeta.get(p)}` : ''}` })), [periodList, periodMeta]);
  const rangePeriods = useMemo(() => (desde && hasta ? periodsBetween(desde, hasta) : []), [desde, hasta]);
  const rangeError = !desde || !hasta ? '' : rangePeriods.length === 0 ? 'El período «desde» no puede ser posterior a «hasta».' : rangePeriods.length > MAX_RANGE ? `El rango máximo es de ${MAX_RANGE} períodos.` : '';

  const busy = progress.ventas.state === 'running' || progress.compras.state === 'running' || rangeProgress.state === 'running';

  const runOne = async (lb: SireLibro) => {
    if (!company || !period) return;
    setProgress((p) => ({ ...p, [lb]: { state: 'running', text: STEP_LABEL.solicitando } }));
    try {
      await sireService.downloadPropuestaExcel(companyId, { libro: lb, period, ruc: company.ruc }, (step) =>
        setProgress((p) => ({ ...p, [lb]: { state: 'running', text: STEP_LABEL[step] } })),
      );
      setProgress((p) => ({ ...p, [lb]: { state: 'done', text: 'Excel descargado.' } }));
    } catch (e) {
      setProgress((p) => ({ ...p, [lb]: { state: 'error', error: e as SireApiError } }));
    }
  };

  const runRange = async () => {
    if (!company || rangeError || rangePeriods.length === 0) return;
    const parts: PeriodExcel[] = [];
    const skipped: string[] = [];
    try {
      for (const [i, per] of rangePeriods.entries()) {
        const prefix = `Período ${formatSirePeriod(per)} (${i + 1} de ${rangePeriods.length}): `;
        setRangeProgress({ state: 'running', text: prefix + STEP_LABEL.solicitando });
        try {
          const blob = await sireService.fetchPropuestaExcel(companyId, { libro, period: per, ruc: company.ruc }, (step) =>
            setRangeProgress({ state: 'running', text: prefix + STEP_LABEL[step] }),
          );
          parts.push({ period: per, blob });
        } catch (e) {
          if ((e as SireApiError).code === 'sin_datos') skipped.push(formatSirePeriod(per));
          else throw e;
        }
      }
      if (parts.length === 0) throw { message: 'SUNAT no tiene comprobantes en la propuesta de ninguno de esos períodos.', code: 'sin_datos' } satisfies SireApiError;
      setRangeProgress({ state: 'running', text: 'Armando el Excel con una hoja por período…' });
      const merged = await mergePeriodExcels(parts);
      saveBlobAs(merged, sirePropuestaFileName(company.ruc, `${desde}-${hasta}`, libro));
      setRangeProgress({
        state: 'done',
        text: `Excel descargado con ${parts.length} ${parts.length === 1 ? 'hoja' : 'hojas'}.${skipped.length ? ` Sin comprobantes en: ${skipped.join(', ')}.` : ''}`,
      });
    } catch (e) {
      setRangeProgress({ state: 'error', error: e as SireApiError });
    }
  };

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

  const libroLabel = SIRE_LIBROS.find((l) => l.value === libro)?.label ?? '';
  const fileHint = company && period ? sirePropuestaFileName(company.ruc, period, libro) : '';

  const statusBlock = (pr: Progress, retry: () => void) =>
    pr.state === 'running' ? (
      <p className="text-sm text-slate-500" role="status">
        <i className="fas fa-spinner fa-spin mr-1.5" aria-hidden />
        {pr.text}
      </p>
    ) : pr.state === 'done' ? (
      <p className="text-sm text-green-700">{pr.text}</p>
    ) : pr.state === 'error' ? (
      pr.error.code === 'sin_datos' ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{pr.error.message}</p>
      ) : (
        <SireErrorBox error={pr.error} onRetry={retry} />
      )
    ) : null;

  return (
    <div className="space-y-5 pt-2">
      <div>
        <Link to="/tools/sire" className="text-xs font-semibold text-primary-700 hover:underline">
          <i className="fas fa-arrow-left mr-1" aria-hidden />
          Volver a la lista
        </Link>
        <PageHeading className="mt-1">{company?.business_name || 'SIRE'}</PageHeading>
        <p className="mt-1 text-sm font-medium text-slate-500">{company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}</p>
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
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
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
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Qué descargar">
                {(
                  [
                    ['periodo', 'Un período'],
                    ['rango', 'Rango de períodos'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMode(v)}
                    aria-pressed={mode === v}
                    className={`px-4 py-2 text-sm font-semibold ${mode === v ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button variant="secondary" onClick={() => void runTest()} disabled={testState === 'running'} className="ml-auto">
                <i className={`fas ${testState === 'running' ? 'fa-spinner fa-spin' : 'fa-plug'} mr-1.5`} aria-hidden />
                Probar conexión
              </Button>
            </div>

            {mode === 'periodo' ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-slate-600">
                  <span className="mb-0.5 block">Año</span>
                  <select
                    value={year}
                    disabled={periodsLoading || years.length === 0}
                    onChange={(e) => {
                      const last = periodList.filter((p) => p.startsWith(e.target.value)).pop();
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
                    {monthsOfYear.map((p) => (
                      <option key={p} value={p}>
                        {formatSirePeriod(p)}
                        {periodMeta.get(p) ? ` — ${periodMeta.get(p)}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <Button disabled={busy || !period || periodsLoading} onClick={() => void runOne(libro)}>
                  <i className="fas fa-file-excel mr-1.5" aria-hidden />
                  Descargar Excel
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !period || periodsLoading}
                  onClick={() => {
                    void runOne('ventas');
                    void runOne('compras');
                  }}
                >
                  Descargar ventas y compras
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-slate-600">
                  <span className="mb-0.5 block">Desde</span>
                  <select value={desde} disabled={periodsLoading || rangeOptions.length === 0} onChange={(e) => setDesde(e.target.value)} className={SELECT_CLS}>
                    {rangeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  <span className="mb-0.5 block">Hasta</span>
                  <select value={hasta} disabled={periodsLoading || rangeOptions.length === 0} onChange={(e) => setHasta(e.target.value)} className={SELECT_CLS}>
                    {rangeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button disabled={busy || periodsLoading || !!rangeError || rangePeriods.length === 0} onClick={() => void runRange()}>
                  <i className="fas fa-file-excel mr-1.5" aria-hidden />
                  Descargar rango en un Excel
                </Button>
                {rangePeriods.length > 0 && !rangeError ? (
                  <span className="pb-2 text-xs text-slate-500">
                    {rangePeriods.length} {rangePeriods.length === 1 ? 'período' : 'períodos'} · una hoja por período
                  </span>
                ) : null}
              </div>
            )}
            {rangeError && mode === 'rango' ? <p className="text-xs text-amber-700">{rangeError}</p> : null}
            {fileHint && mode === 'periodo' ? (
              <p className="text-xs text-slate-500">
                Excel con la propuesta de comprobantes de {libroLabel} que tiene SUNAT para el período, por ejemplo <span className="font-mono">{fileHint}</span>.
              </p>
            ) : null}
          </div>

          {testState === 'ok' ? (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">Conexión correcta: SUNAT aceptó las credenciales de API de esta empresa.</p>
          ) : typeof testState === 'object' ? (
            <SireErrorBox error={testState} />
          ) : null}
          {periodsLoading ? <Spinner label="Consultando períodos en SUNAT…" /> : null}
          {periodsError ? <SireErrorBox error={periodsError} onRetry={() => void loadPeriods()} /> : null}

          {mode === 'periodo' ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {SIRE_LIBROS.map((l) =>
                progress[l.value].state === 'idle' ? null : (
                  <div key={l.value} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <p className="mb-1 text-xs font-bold uppercase text-slate-500">{l.short}</p>
                    {statusBlock(progress[l.value], () => void runOne(l.value))}
                  </div>
                ),
              )}
            </div>
          ) : rangeProgress.state === 'idle' ? null : (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">{statusBlock(rangeProgress, () => void runRange())}</div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default SireCompany;
