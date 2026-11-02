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
  type SireDownloadItem,
  type SireLibro,
  type SirePeriodYear,
} from '../../../services/sire';
import { timeAgo } from '../buzon/buzonUi';
import { mergePeriodExcels, periodsBetween } from './sireExcel';
import { Card, SireErrorBox, Spinner } from './SireShared';
import { SELECT_CLS, sireMissing } from './sireUi';

const MAX_RANGE = 12;
const POLL_MS = 3000;

const STEP_LABEL: Record<NonNullable<SireDownloadItem['step']>, string> = {
  solicitando: 'Solicitando a SUNAT…',
  esperando: 'SUNAT está preparando el archivo…',
  generando: 'Generando el Excel…',
};

const TABS: { value: SireLibro; label: string; icon: string }[] = [
  { value: 'compras', label: 'SIRE Compras', icon: 'fas fa-cart-shopping' },
  { value: 'ventas', label: 'SIRE Ventas', icon: 'fas fa-dollar-sign' },
];

/** Selector segmentado del sistema (mismo estilo que el resto de las herramientas). */
const segBtn = (active: boolean) => `px-4 py-2 text-sm font-semibold ${active ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`;

/** Todos los períodos AAAAMM del listado de SUNAT, sin repetir y en orden (el listado viene agrupado por año). */
function allPeriods(years: SirePeriodYear[]): string[] {
  return Array.from(new Set(years.flatMap((y) => (y.lisPeriodos ?? []).map((p) => p.perTributario)).filter(Boolean))).sort();
}

/** «202610» → «10/2026». */
const periodLabel = formatSirePeriod;

function HistoryItem({
  item,
  onExcel,
  onRemove,
  onRetry,
  busy,
}: {
  item: SireDownloadItem;
  onExcel: (it: SireDownloadItem) => void;
  onRemove: (it: SireDownloadItem) => void;
  onRetry: (it: SireDownloadItem) => void;
  busy: boolean;
}) {
  const [detail, setDetail] = useState(false);
  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-slate-800">
              {item.libro === 'compras' ? 'Compras' : 'Ventas'} · {periodLabel(item.period)}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sin glosas</span>
            {item.status === 'en_proceso' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">En proceso</span> : null}
            {item.status === 'listo' ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Listo</span> : null}
            {item.status === 'sin_datos' ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sin movimientos</span> : null}
            {item.status === 'error' ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Error</span> : null}
            <span className="text-xs text-slate-400" title={new Date(item.created_at).toLocaleString('es-PE')}>
              {timeAgo(item.created_at)}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {item.status === 'en_proceso' ? (
              <span role="status">
                <i className="fas fa-spinner fa-spin mr-1.5" aria-hidden />
                {STEP_LABEL[item.step ?? 'solicitando']}
              </span>
            ) : item.status === 'listo' ? (
              `${item.rows} ${item.rows === 1 ? 'comprobante' : 'comprobantes'} · listo para descargar`
            ) : item.status === 'sin_datos' ? (
              'SUNAT no tiene comprobantes en la propuesta de este período.'
            ) : (
              <span className="text-red-700">
                {item.error_message || 'No se pudo completar la consulta.'}
                {item.error_detail ? (
                  <button type="button" onClick={() => setDetail((v) => !v)} className="ml-2 underline">
                    {detail ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
                  </button>
                ) : null}
              </span>
            )}
          </p>
          {detail && item.error_detail ? (
            <p className="break-words rounded-md bg-slate-50 px-2 py-1.5 font-mono text-2xs text-slate-700">
              {item.error_code ? `[${item.error_code}] ` : ''}
              {item.error_detail}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {item.status === 'listo' ? (
            <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={busy} onClick={() => onExcel(item)}>
              <i className="fas fa-file-excel mr-1.5 text-green-700" aria-hidden />
              Excel
            </Button>
          ) : null}
          {item.status === 'error' ? (
            <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={busy} onClick={() => onRetry(item)}>
              <i className="fas fa-rotate-right mr-1.5" aria-hidden />
              Reintentar
            </Button>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(item)}
            title="Quitar del historial"
            aria-label="Quitar del historial"
            className="rounded-lg px-2 py-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <i className="fas fa-trash-can" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Herramientas → SIRE → una empresa: pestañas de Compras y Ventas, a la izquierda el formulario (año, mes o rango) y a
 * la derecha el historial de consultas de la empresa. Cada consulta se procesa en segundo plano y queda guardada: si ya
 * está lista solo se baja el Excel, sin volver a consultar a SUNAT.
 */
const SireCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [libro, setLibro] = useState<SireLibro>('compras');
  const [years, setYears] = useState<SirePeriodYear[]>([]);
  const [period, setPeriod] = useState('');
  const [rangeOpen, setRangeOpen] = useState(false);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState<SireApiError | null>(null);
  const [testState, setTestState] = useState<'idle' | 'running' | 'ok' | SireApiError>('idle');
  const [items, setItems] = useState<SireDownloadItem[]>([]);
  const [historyError, setHistoryError] = useState<SireApiError | null>(null);
  const [actionError, setActionError] = useState<SireApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState(false);

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

  const loadHistory = useCallback(async () => {
    try {
      setItems(await sireService.downloads(companyId));
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  }, [companyId]);

  useEffect(() => {
    if (!Number.isFinite(companyId) || companyId <= 0) return;
    void loadHistory();
  }, [companyId, loadHistory]);

  // Mientras alguna consulta siga en proceso, el historial se refresca solo.
  const hasRunning = items.some((i) => i.status === 'en_proceso');
  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => void loadHistory(), POLL_MS);
    return () => window.clearInterval(id);
  }, [hasRunning, loadHistory]);

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
  const rangeError = !rangeOpen || !desde || !hasta ? '' : rangePeriods.length === 0 ? 'El período «desde» no puede ser posterior a «hasta».' : rangePeriods.length > MAX_RANGE ? `El rango máximo es de ${MAX_RANGE} períodos.` : '';

  const start = async (lb: SireLibro, periods: string[]) => {
    setBusy(true);
    setActionError(null);
    try {
      await sireService.startDownloads(companyId, { libro: lb, periods, mode: 'sin_glosas' });
      await loadHistory();
    } catch (e) {
      setActionError(e as SireApiError);
    } finally {
      setBusy(false);
    }
  };

  const downloadExcel = async (it: SireDownloadItem) => {
    if (!company) return;
    setBusy(true);
    setActionError(null);
    try {
      saveBlobAs(await sireService.downloadBlob(companyId, it.id), sirePropuestaFileName(company.ruc, it.period, it.libro));
    } catch (e) {
      setActionError(e as SireApiError);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (it: SireDownloadItem) => {
    setActionError(null);
    try {
      await sireService.removeDownload(companyId, it.id);
      setItems((cur) => cur.filter((x) => x.id !== it.id));
    } catch (e) {
      setActionError(e as SireApiError);
    }
  };

  const clearAll = async () => {
    setActionError(null);
    try {
      await sireService.clearDownloads(companyId);
      await loadHistory();
    } catch (e) {
      setActionError(e as SireApiError);
    }
  };

  const readyOfTab = items.filter((i) => i.libro === libro && i.status === 'listo');

  const mergeReady = async () => {
    if (!company || readyOfTab.length < 2) return;
    setMerging(true);
    setActionError(null);
    try {
      const sorted = [...readyOfTab].sort((a, b) => a.period.localeCompare(b.period));
      const parts = [];
      for (const it of sorted) parts.push({ period: it.period, blob: await sireService.downloadBlob(companyId, it.id) });
      const merged = await mergePeriodExcels(parts);
      saveBlobAs(merged, sirePropuestaFileName(company.ruc, `${sorted[0].period}-${sorted[sorted.length - 1].period}`, libro));
    } catch (e) {
      setActionError(e as SireApiError);
    } finally {
      setMerging(false);
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

  const tabLabel = SIRE_LIBROS.find((l) => l.value === libro)?.short ?? '';
  const submitDisabled = busy || periodsLoading || (rangeOpen ? !!rangeError || rangePeriods.length === 0 : !period);

  return (
    <div className="space-y-5 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/tools/sire" className="text-xs font-semibold text-primary-700 hover:underline">
            <i className="fas fa-arrow-left mr-1" aria-hidden />
            Volver a la lista
          </Link>
          <PageHeading className="mt-1">{company?.business_name || 'SIRE'}</PageHeading>
          <p className="mt-1 text-sm font-medium text-slate-500">{company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}</p>
        </div>
        {company && !missing ? (
          <Button variant="secondary" onClick={() => void runTest()} disabled={testState === 'running'}>
            <i className={`fas ${testState === 'running' ? 'fa-spinner fa-spin' : 'fa-plug'} mr-1.5`} aria-hidden />
            Probar conexión
          </Button>
        ) : null}
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

      {testState === 'ok' ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">Conexión correcta: SUNAT aceptó las credenciales de API de esta empresa.</p>
      ) : typeof testState === 'object' ? (
        <SireErrorBox error={testState} />
      ) : null}

      {company && !missing ? (
        <>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="tablist" aria-label="Libro">
            {TABS.map((t) => (
              <button key={t.value} type="button" role="tab" aria-selected={libro === t.value} onClick={() => setLibro(t.value)} className={segBtn(libro === t.value)}>
                <i className={`${t.icon} mr-1.5`} aria-hidden />
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
            <Card title={`Descarga individual (${tabLabel})`} subtitle="Elija el período y SUNAT preparará el Excel; el resultado queda en el historial.">
              <div className="space-y-3">
                <div>
                  <span className="mb-0.5 block text-xs text-slate-600">Empresa</span>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    <span className="font-medium">{company.business_name}</span>
                    <span className="ml-2 font-mono text-xs text-slate-500">{company.ruc}</span>
                  </div>
                </div>

                {!rangeOpen ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-slate-600">
                      <span className="mb-0.5 block">Año</span>
                      <select
                        value={year}
                        disabled={periodsLoading || years.length === 0}
                        onChange={(e) => {
                          const last = periodList.filter((p) => p.startsWith(e.target.value)).pop();
                          if (last) setPeriod(last);
                        }}
                        className={`${SELECT_CLS} w-full`}
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
                      <select value={period} disabled={periodsLoading || monthsOfYear.length === 0} onChange={(e) => setPeriod(e.target.value)} className={`${SELECT_CLS} w-full`}>
                        {monthsOfYear.map((p) => (
                          <option key={p} value={p}>
                            {formatSirePeriod(p)}
                            {periodMeta.get(p) ? ` — ${periodMeta.get(p)}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-slate-600">
                      <span className="mb-0.5 block">Desde</span>
                      <select value={desde} disabled={periodsLoading || rangeOptions.length === 0} onChange={(e) => setDesde(e.target.value)} className={`${SELECT_CLS} w-full`}>
                        {rangeOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">
                      <span className="mb-0.5 block">Hasta</span>
                      <select value={hasta} disabled={periodsLoading || rangeOptions.length === 0} onChange={(e) => setHasta(e.target.value)} className={`${SELECT_CLS} w-full`}>
                        {rangeOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {rangeError ? <p className="text-xs text-amber-700">{rangeError}</p> : null}

                <div>
                  <span className="mb-0.5 block text-xs text-slate-600">Modo de descarga</span>
                  <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Modo de descarga">
                    <button type="button" aria-pressed="true" className={segBtn(true)}>
                      Sin glosas
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Aún no disponible: el SIRE de SUNAT no entrega glosas por su API."
                      className="cursor-not-allowed bg-white px-4 py-2 text-sm font-semibold text-slate-400"
                    >
                      Con glosas
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button disabled={submitDisabled} onClick={() => void start(libro, rangeOpen ? rangePeriods : [period])}>
                    <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-download'} mr-1.5`} aria-hidden />
                    {rangeOpen ? `Consultar ${rangePeriods.length || ''} ${rangePeriods.length === 1 ? 'período' : 'períodos'}` : 'Consultar y descargar'}
                  </Button>
                  <button type="button" onClick={() => setRangeOpen((v) => !v)} className="text-xs font-semibold text-primary-700 hover:underline">
                    {rangeOpen ? 'Volver a un solo período' : 'Consultar un rango de períodos'}
                  </button>
                </div>

                {periodsLoading ? <Spinner label="Consultando períodos en SUNAT…" /> : null}
                {periodsError ? <SireErrorBox error={periodsError} onRetry={() => void loadPeriods()} /> : null}
              </div>
            </Card>

            <Card
              title="Descargas activas"
              subtitle="Historial de consultas de esta empresa. Si ya está lista, solo baje el Excel."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{items.length}</span>
                  {readyOfTab.length >= 2 ? (
                    <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={merging} onClick={() => void mergeReady()} title="Junta los Excel listos de esta pestaña en un solo archivo, con una hoja por período">
                      <i className={`fas ${merging ? 'fa-spinner fa-spin' : 'fa-object-group'} mr-1.5`} aria-hidden />
                      Unir {tabLabel.toLowerCase()} en un Excel
                    </Button>
                  ) : null}
                  <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={items.every((i) => i.status === 'en_proceso')} onClick={() => void clearAll()}>
                    <i className="fas fa-broom mr-1.5" aria-hidden />
                    Limpiar historial
                  </Button>
                </div>
              }
            >
              {actionError ? (
                <div className="mb-3">
                  <SireErrorBox error={actionError} />
                </div>
              ) : null}
              {historyError ? (
                <div className="mb-3">
                  <SireErrorBox error={historyError} onRetry={() => void loadHistory()} />
                </div>
              ) : null}

              {items.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Aún no hay consultas. Elija el período y pulse «Consultar y descargar»: aquí quedará el resultado.</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((it) => (
                    <HistoryItem key={it.id} item={it} busy={busy} onExcel={(x) => void downloadExcel(x)} onRemove={(x) => void remove(x)} onRetry={(x) => void start(x.libro, [x.period])} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default SireCompany;
