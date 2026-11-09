import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { npdService, type NpdHistoryItem, type NpdResult } from '../../../services/npd';
import type { SireApiError } from '../../../services/sire';
import { timeAgo } from '../buzon/buzonUi';
import { Card, SireErrorBox } from '../sire/SireShared';
import { INPUT_CLS } from '../sire/sireUi';
import { NPD_ESTADOS, NPD_ESTADO_BADGE, NPD_MAX_DAYS, daysAgo, daysSpan, exportNpdExcel, fmtDay, fmtMoney, totalsByEstado } from './npdUi';
import { formatDateTime } from '../../../utils/format';
import Alert from '../../../components/ui/Alert';
import { notify } from '../../../utils/notify';
import LongTaskPanel from '../../../components/LongTaskPanel';
import { failTask, finishTask, startTask, taskKey } from '../../../utils/longTasks';
import { useTask, useTaskSettled } from '../../../utils/useLongTasks';

const RANGES = [
  { label: '30 días', days: 29 },
  { label: '3 meses', days: 89 },
  { label: '6 meses', days: 179 },
  { label: '12 meses', days: 364 },
];

/** Una consulta del historial: se abre con un clic (resultado guardado, sin volver a consultar a SUNAT). */
function HistoryEntry({
  item,
  active,
  busy,
  onOpen,
  onRemove,
  onRetry,
}: {
  item: NpdHistoryItem;
  active: boolean;
  busy: boolean;
  onOpen: (it: NpdHistoryItem) => void;
  onRemove: (it: NpdHistoryItem) => void;
  onRetry: (it: NpdHistoryItem) => void;
}) {
  const [detail, setDetail] = useState(false);
  return (
    <li className={`rounded-xl border p-3 ${active ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200'}`}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-slate-800">
            {fmtDay(item.desde)} al {fmtDay(item.hasta)}
          </span>
          {item.status === 'listo' ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{item.total}</span> : null}
          {item.status === 'sin_datos' ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sin NPD</span> : null}
          {item.status === 'error' ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Error</span> : null}
        </div>
        {item.status === 'listo' ? (
          <p className="text-xs text-slate-700">
            {fmtMoney(item.total_importe)}
            {item.vigentes > 0 ? (
              <span className="text-amber-700">
                {' '}
                · {item.vigentes} vigente{item.vigentes === 1 ? '' : 's'} ({fmtMoney(item.importe_vigente)})
              </span>
            ) : null}
          </p>
        ) : null}
        <p className="text-2xs text-slate-400" title={formatDateTime(item.created_at)}>
          {timeAgo(item.created_at)}
        </p>
        {item.status === 'error' ? (
          <p className="text-xs text-red-700">
            {item.error_message || 'No se pudo completar la consulta.'}
            {item.error_detail ? (
              <button type="button" onClick={() => setDetail((v) => !v)} className="ml-2 underline">
                {detail ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
              </button>
            ) : null}
          </p>
        ) : null}
        {detail && item.error_detail ? (
          <p className="break-words rounded-md bg-slate-50 px-2 py-1.5 font-mono text-2xs text-slate-700">
            {item.error_code ? `[${item.error_code}] ` : ''}
            {item.error_detail}
          </p>
        ) : null}
        <div className="flex items-center gap-2 pt-0.5">
          {item.status === 'listo' ? (
            <Button variant="secondary" className="!px-3 !py-1 text-xs" disabled={busy || active} onClick={() => onOpen(item)}>
              <i className="fas fa-eye mr-1.5" aria-hidden />
              {active ? 'Viendo' : 'Ver'}
            </Button>
          ) : null}
          {item.status === 'error' || item.status === 'sin_datos' ? (
            <Button variant="secondary" className="!px-3 !py-1 text-xs" disabled={busy} onClick={() => onRetry(item)}>
              <i className="fas fa-rotate-right mr-1.5" aria-hidden />
              {item.status === 'error' ? 'Reintentar' : 'Consultar de nuevo'}
            </Button>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(item)}
            title="Quitar del historial"
            aria-label="Quitar del historial"
            className="ml-auto rounded-lg px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <i className="fas fa-trash-can" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Herramientas → Consulta de detracciones → una empresa: lee en SUNAT (Menú SOL → Detracciones → Consulta de NPD) los
 * Números de Pago de Detracciones generados por la empresa entre dos fechas, con su estado (vigente, pagado, no
 * vigente), fecha límite de pago e importe. Usa la clave SOL. Solo lectura: nunca anula un NPD.
 * Cada consulta queda guardada en el historial de la empresa.
 */
const NpdCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [desde, setDesde] = useState(daysAgo(89));
  const [hasta, setHasta] = useState(daysAgo(0));
  const [error, setError] = useState<SireApiError | null>(null);
  const [resp, setResp] = useState<NpdResult | null>(null);
  const [estado, setEstado] = useState('');
  const [filter, setFilter] = useState('');
  const [history, setHistory] = useState<NpdHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<SireApiError | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState('');
  const [opening, setOpening] = useState(false);
  // La consulta a SUNAT la sigue el registro global (utils/longTasks): sobrevive a un cambio de pantalla.
  const task = useTask(taskKey('npd', companyId));
  const loading = task?.status === 'running';
  const ownTask = useRef<number | null>(null);

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

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await npdService.history(companyId));
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  }, [companyId]);

  useEffect(() => {
    if (!Number.isFinite(companyId) || companyId <= 0) return;
    void loadHistory();
  }, [companyId, loadHistory]);

  // La consulta usa la clave SOL de la empresa (no las credenciales de API).
  const missingSol = company ? !company.sol_configurado : false;
  const today = daysAgo(0);
  const span = daysSpan(desde, hasta);
  const rangeError = !desde || !hasta
    ? 'Indique las dos fechas.'
    : span === 0
      ? 'La fecha «desde» no puede ser mayor que «hasta».'
      : hasta > today
        ? 'La fecha «hasta» no puede ser posterior a hoy.'
        : span > NPD_MAX_DAYS
          ? `El rango máximo es de ${NPD_MAX_DAYS} días (12 meses).`
          : '';

  const run = async (p?: { desde: string; hasta: string }) => {
    const params = p ?? { desde, hasta };
    setError(null);
    setSavedAt('');
    setEstado('');
    setFilter('');
    const t = startTask({
      tool: 'npd',
      toolLabel: 'Detracciones',
      companyId,
      companyName: company?.business_name || `Empresa ${companyId}`,
      detail: `${fmtDay(params.desde)} – ${fmtDay(params.hasta)}`,
      href: `/tools/consulta-detracciones/${companyId}`,
    });
    ownTask.current = t.id;
    try {
      const r = await npdService.query(companyId, params.desde, params.hasta);
      finishTask(t.id, { resultId: r.history_id ?? undefined, summary: `${r.data.total} NPD` });
      setResp(r.data);
      setActiveId(r.history_id ?? null);
    } catch (e) {
      setResp(null);
      setActiveId(null);
      failTask(t.id, e);
      setError(e as SireApiError);
    } finally {
      void loadHistory();
    }
  };

  const applyQuery = (it: NpdHistoryItem) => {
    setDesde(it.desde);
    setHasta(it.hasta);
    return { desde: it.desde, hasta: it.hasta };
  };

  /** Muestra el resultado guardado de una consulta (sin volver a consultar a SUNAT). */
  const openSaved = async (it: NpdHistoryItem) => {
    setOpening(true);
    setError(null);
    try {
      const r = await npdService.historyGet(companyId, it.id);
      applyQuery(it);
      setResp(r.data);
      setActiveId(it.id);
      setSavedAt(it.created_at);
      setEstado('');
      setFilter('');
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setOpening(false);
    }
  };

  // Salió de la pantalla durante la consulta y volvió: el resultado está en el historial del servidor.
  useTaskSettled(taskKey('npd', companyId), ownTask, (done) => {
    if (done.status === 'error') {
      setResp(null);
      setError({ message: done.errorMessage ?? 'SUNAT no respondió. Intente de nuevo.' });
      return;
    }
    void (async () => {
      try {
        const items = await npdService.history(companyId);
        setHistory(items);
        const it = items.find((x) => x.id === done.resultId) ?? items[0];
        if (it) await openSaved(it);
      } catch (e) {
        setError(e as SireApiError);
      }
    })();
  });

  const removeSaved = async (it: NpdHistoryItem) => {
    try {
      await npdService.removeHistory(companyId, it.id);
      void notify.success('Consulta quitada');
      setHistory((c) => c.filter((x) => x.id !== it.id));
      if (activeId === it.id) setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const clearHistory = async () => {
    try {
      await npdService.clearHistory(companyId);
      void notify.success('Historial limpiado');
      setHistory([]);
      setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const items = useMemo(() => {
    const all = resp?.items ?? [];
    const q = filter.trim().toLowerCase();
    return all.filter((r) => (!estado || r.estado_cod === estado) && (!q || `${r.npd} ${r.estado}`.toLowerCase().includes(q)));
  }, [resp, estado, filter]);

  const byEstado = useMemo(() => totalsByEstado(resp?.items ?? []), [resp]);

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Link to="/tools/consulta-detracciones" title="Volver a la lista" aria-label="Volver a la lista" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary-700">
            <i className="fas fa-arrow-left text-xs" aria-hidden />
          </Link>
          <PageHeading>{company?.business_name || 'Consulta de detracciones'}</PageHeading>
          <p className="text-sm font-medium text-slate-500">{company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}</p>
        </div>
      </div>

      {companyError ? <Alert variant="error">{companyError}</Alert> : null}

      {company && missingSol ? (
        <Alert variant="warning">
          Falta cargar: <strong>usuario y clave SOL</strong>. Complételos en{' '}
          <Link to="/finance/claves-sol" className="font-semibold underline">
            Claves SOL
          </Link>{' '}
          (botón Editar de la empresa). Esta consulta entra a SUNAT con la clave SOL; no usa las credenciales de API.
        </Alert>
      ) : null}

      {company && !missingSol ? (
        <>
          <Alert variant="info">
            Esta consulta es la de <strong>NPD (Número de Pago de Detracciones)</strong> del Menú SOL de SUNAT: los NPD que generó la empresa para pagar
            detracciones, con su estado y fecha límite de pago. Se busca por <strong>fecha de generación</strong> (hasta 12 meses por consulta). Es solo
            lectura: desde aquí no se puede anular ningún NPD.
          </Alert>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="min-w-0 space-y-5">
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Generados desde</span>
                    <input type="date" value={desde} max={hasta || today} onChange={(e) => setDesde(e.target.value)} className={INPUT_CLS} />
                  </label>
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Hasta</span>
                    <input type="date" value={hasta} min={desde || undefined} max={today} onChange={(e) => setHasta(e.target.value)} className={INPUT_CLS} />
                  </label>
                  <div className="flex flex-wrap gap-1" aria-label="Rangos rápidos">
                    {RANGES.map((r) => (
                      <button
                        key={r.days}
                        type="button"
                        onClick={() => {
                          setDesde(daysAgo(r.days));
                          setHasta(daysAgo(0));
                        }}
                        className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <Button className="ml-auto" disabled={loading || !!rangeError} onClick={() => void run()}>
                    <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'} mr-1.5`} aria-hidden />
                    Consultar en SUNAT
                  </Button>
                </div>
                {rangeError ? <p className="text-xs text-amber-700">{rangeError}</p> : null}
              </div>

              <LongTaskPanel task={task} hint="Entra a SOL con la clave de la empresa. Puede seguir usando el sistema; la consulta queda guardada en el historial." />
              {error ? <SireErrorBox error={error} onRetry={() => void run()} /> : null}

              {resp && !loading ? (
                <Card
                  title={`${resp.total} NPD`}
                  subtitle={`Generados del ${fmtDay(resp.desde)} al ${fmtDay(resp.hasta)}${savedAt ? ` · guardada ${timeAgo(savedAt)} (no se volvió a consultar)` : ''}`}
                  actions={
                    <Button
                      variant="secondary"
                      className="!py-1.5 text-xs"
                      onClick={() => void exportNpdExcel(resp, { empresa: company.business_name, ruc: company.ruc })}
                      disabled={resp.total === 0}
                    >
                      <i className="fas fa-file-excel mr-1.5" aria-hidden />
                      Excel
                    </Button>
                  }
                >
                  {resp.total === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">SUNAT no tiene NPD generados por esta empresa en ese rango de fechas.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-3 text-sm">
                        <div className="rounded-lg border border-slate-200 px-4 py-2">
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">Total de NPD</span>
                          <span className="font-bold text-slate-800">{fmtMoney(resp.total_importe)}</span>
                        </div>
                        <div className={`rounded-lg border px-4 py-2 ${resp.vigentes > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200'}`}>
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">Pendientes de pago (vigentes)</span>
                          <span className="font-bold text-slate-800">
                            {fmtMoney(resp.importe_vigente)} <span className="text-xs font-medium text-slate-500">· {resp.vigentes}</span>
                          </span>
                        </div>
                        {byEstado
                          .filter((e) => e.cod !== '00')
                          .map((e) => (
                            <div key={e.cod} className="rounded-lg border border-slate-200 px-4 py-2">
                              <span className="block text-[10px] font-semibold uppercase text-slate-400">{e.label}</span>
                              <span className="font-bold text-slate-800">
                                {fmtMoney(e.importe)} <span className="text-xs font-medium text-slate-500">· {e.count}</span>
                              </span>
                            </div>
                          ))}
                      </div>

                      <div className="flex flex-wrap items-end gap-3">
                        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Estado">
                          {[{ value: '', label: 'Todos' }, ...NPD_ESTADOS].map((e) => (
                            <button
                              key={e.value || 'todos'}
                              type="button"
                              aria-pressed={estado === e.value}
                              onClick={() => setEstado(e.value)}
                              className={`px-3 py-1.5 text-xs font-semibold ${estado === e.value ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                            >
                              {e.label}
                            </button>
                          ))}
                        </div>
                        <label className="ml-auto text-xs text-slate-600">
                          <span className="mb-0.5 block">Filtrar</span>
                          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Número de NPD o estado…" className={`${INPUT_CLS} w-56`} />
                        </label>
                      </div>

                      <div className="overflow-auto">
                        <table className="min-w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500 uppercase">
                              {['NPD', 'Creación', 'Fecha límite de pago', 'Estado', 'Importe'].map((h) => (
                                <th key={h} className={`whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold ${h === 'Importe' ? 'text-right' : ''}`}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((r) => (
                              <tr key={r.npd} className="border-b border-slate-100 hover:bg-slate-50/70">
                                <td className="whitespace-nowrap px-2 py-2 font-mono">{r.npd}</td>
                                <td className="whitespace-nowrap px-2 py-2" title={r.fec_registro}>
                                  {r.fec_creacion}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2">{r.fec_limite_pago}</td>
                                <td className="px-2 py-2">
                                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${NPD_ESTADO_BADGE[r.estado_cod] ?? 'bg-slate-100 text-slate-700'}`}>{r.estado}</span>
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-right font-mono font-semibold">{fmtMoney(r.importe)}</td>
                              </tr>
                            ))}
                            {items.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-2 py-6 text-center text-slate-500">
                                  Ningún NPD coincide con el filtro.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Card>
              ) : null}
            </div>

            <aside className="lg:sticky lg:top-2">
              <Card
                title="Historial de consultas"
                subtitle="Quedan guardadas por empresa: ábralas sin volver a consultar a SUNAT."
                actions={
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{history.length}</span>
                    <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={history.length === 0 || loading} onClick={() => void clearHistory()}>
                      <i className="fas fa-broom mr-1.5" aria-hidden />
                      Limpiar
                    </Button>
                  </div>
                }
              >
                {historyError ? (
                  <div className="mb-3">
                    <SireErrorBox error={historyError} onRetry={() => void loadHistory()} />
                  </div>
                ) : null}
                {history.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">Aún no hay consultas. Elija las fechas y pulse «Consultar en SUNAT»: aquí quedará el resultado.</p>
                ) : (
                  <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-0.5">
                    {history.map((it) => (
                      <HistoryEntry
                        key={it.id}
                        item={it}
                        active={activeId === it.id}
                        busy={loading || opening}
                        onOpen={(x) => void openSaved(x)}
                        onRemove={(x) => void removeSaved(x)}
                        onRetry={(x) => void run(applyQuery(x))}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default NpdCompany;
