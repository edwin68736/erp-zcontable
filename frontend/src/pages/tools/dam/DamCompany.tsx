import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { damService, type DamHistoryItem, type DamResult } from '../../../services/dam';
import type { SireApiError } from '../../../services/sire';
import { timeAgo } from '../buzon/buzonUi';
import { daysAgo, daysSpan, fmtDay } from '../npd/npdUi';
import { Card, SireErrorBox } from '../sire/SireShared';
import { INPUT_CLS } from '../sire/sireUi';
import { DAM_MAX_DAYS, exportDamExcel, filterDams, fmtDamAmount, hasRegularizacion } from './damUi';
import { formatDateTime } from '../../../utils/format';
import Alert from '../../../components/ui/Alert';
import { notify } from '../../../utils/notify';
import LongTaskPanel from '../../../components/LongTaskPanel';
import { taskKey, trackAsync } from '../../../utils/longTasks';
import { useTask, useTaskSettled } from '../../../utils/useLongTasks';

const POLL_MS = 4000;

const RANGES = [
  { label: '7 días', days: 6 },
  { label: '30 días', days: 29 },
  { label: '60 días', days: 59 },
  { label: '3 meses', days: 91 },
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
  item: DamHistoryItem;
  active: boolean;
  busy: boolean;
  onOpen: (it: DamHistoryItem) => void;
  onRemove: (it: DamHistoryItem) => void;
  onRetry: (it: DamHistoryItem) => void;
}) {
  const [detail, setDetail] = useState(false);
  return (
    <li className={`rounded-xl border p-3 ${active ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200'}`}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-slate-800">
            {fmtDay(item.desde)} al {fmtDay(item.hasta)}
          </span>
          {item.status === 'en_proceso' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">En proceso</span> : null}
          {item.status === 'listo' ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{item.total}</span> : null}
          {item.status === 'sin_datos' ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sin DAM</span> : null}
          {item.status === 'error' ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Error</span> : null}
        </div>
        {item.status === 'en_proceso' ? (
          <p className="text-xs text-slate-500" role="status">
            <i className="fas fa-spinner fa-spin mr-1.5" aria-hidden />
            Consultando en SUNAT Aduanas… puede tardar más de un minuto.
          </p>
        ) : null}
        {item.status === 'listo' ? <p className="text-xs text-slate-700">Valor en aduana {fmtDamAmount(item.total_valor)}</p> : null}
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
 * Herramientas → Consulta DAM → una empresa: lee en SUNAT (Menú SOL → Aduanas → Despacho aduanero de salida → Consulta de
 * DAM) las Declaraciones Aduaneras de Mercancías de exportación numeradas en un rango de fechas. Usa la clave SOL. Solo
 * lectura. La búsqueda de Aduanas es lenta, así que corre en segundo plano: queda «en proceso» en el historial de la
 * empresa y la pantalla se actualiza sola cuando termina.
 */
const DamCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [desde, setDesde] = useState(daysAgo(29));
  const [hasta, setHasta] = useState(daysAgo(0));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<SireApiError | null>(null);
  const [resp, setResp] = useState<DamResult | null>(null);
  const [filter, setFilter] = useState('');
  const [history, setHistory] = useState<DamHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<SireApiError | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState('');
  const [opening, setOpening] = useState(false);
  // Consulta que acaba de iniciar esta pantalla: al terminar se abre sola.
  const watching = useRef<number | null>(null);

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
      setHistory(await damService.history(companyId));
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  }, [companyId]);

  useEffect(() => {
    if (!Number.isFinite(companyId) || companyId <= 0) return;
    void loadHistory();
  }, [companyId, loadHistory]);

  const running = history.some((h) => h.status === 'en_proceso');
  // El registro global sigue la consulta (header + aviso si la persona se fue a otra pantalla).
  const task = useTask(taskKey('dam', companyId));
  const ownTask = useRef<number | null>(null);
  useEffect(() => {
    if (!running || task?.status === 'running') return;
    const pending = history.filter((h) => h.status === 'en_proceso');
    const ids = new Set(pending.map((h) => h.id));
    const oldest = Math.min(...pending.map((h) => Date.parse(h.created_at) || Date.now()));
    trackAsync(
      {
        tool: 'dam',
        toolLabel: 'DAM',
        companyId,
        companyName: company?.business_name || `Empresa ${companyId}`,
        detail: `${fmtDay(pending[0].desde)} – ${fmtDay(pending[0].hasta)}`,
        href: `/tools/consulta-dam/${companyId}`,
        startedAt: oldest,
      },
      async () => {
        const rows = (await damService.history(companyId)).filter((h) => ids.has(h.id));
        if (rows.some((h) => h.status === 'en_proceso')) return { status: 'running' };
        const failed = rows.find((h) => h.status === 'error');
        if (failed) return { status: 'error', message: failed.error_message || 'No se pudo completar la consulta.' };
        return { status: 'done', resultId: rows[0]?.id, summary: `${rows[0]?.total ?? 0} DAM` };
      },
    );
  }, [running, task?.status, history, companyId, company?.business_name]);
  // Salió de la pantalla durante la consulta y volvió: se abre el resultado (o el error) como si hubiera esperado aquí.
  useTaskSettled(taskKey('dam', companyId), ownTask, (done) => {
    void (async () => {
      try {
        const list = await damService.history(companyId);
        setHistory(list);
        const it = list.find((h) => h.id === done.resultId);
        if (done.status === 'error') setError({ message: done.errorMessage ?? 'No se pudo completar la consulta.' });
        else if (it && it.status === 'listo' && watching.current == null) await showSaved(it, false);
      } catch (e) {
        setError(e as SireApiError);
      }
    })();
  });
  // Mientras alguna consulta siga en proceso, el historial se refresca solo.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void loadHistory(), POLL_MS);
    return () => window.clearInterval(id);
  }, [running, loadHistory]);

  const showSaved = useCallback(
    async (it: DamHistoryItem, fromHistory: boolean) => {
      setOpening(true);
      setError(null);
      try {
        const r = await damService.historyGet(companyId, it.id);
        setResp(r);
        setActiveId(it.id);
        setSavedAt(fromHistory ? it.created_at : '');
        setFilter('');
        if (fromHistory) {
          setDesde(it.desde);
          setHasta(it.hasta);
        }
      } catch (e) {
        setError(e as SireApiError);
      } finally {
        setOpening(false);
      }
    },
    [companyId],
  );

  // Cuando termina la consulta que iniciamos desde esta pantalla, se muestra su resultado (o su error).
  useEffect(() => {
    const id = watching.current;
    if (id == null) return;
    const it = history.find((h) => h.id === id);
    if (!it || it.status === 'en_proceso') return;
    watching.current = null;
    ownTask.current = null;
    if (it.status === 'listo') {
      void showSaved(it, false);
    } else if (it.status === 'sin_datos') {
      setResp({ desde: it.desde, hasta: it.hasta, items: [], total: 0, total_clausula: 0, total_valor: 0 });
      setActiveId(it.id);
    } else {
      setError({ message: it.error_message || 'No se pudo completar la consulta.', code: it.error_code, detail: it.error_detail });
    }
  }, [history, showSaved]);

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
        : span > DAM_MAX_DAYS
          ? `El rango máximo es de ${DAM_MAX_DAYS} días (3 meses): la consulta de Aduanas es lenta.`
          : '';

  const start = async (p?: { desde: string; hasta: string }) => {
    const params = p ?? { desde, hasta };
    setStarting(true);
    setError(null);
    setResp(null);
    setActiveId(null);
    setSavedAt('');
    try {
      const row = await damService.start(companyId, params.desde, params.hasta);
      watching.current = row.id;
      setHistory((cur) => [row, ...cur.filter((x) => x.id !== row.id)]);
      void loadHistory();
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setStarting(false);
    }
  };

  const retrySaved = (it: DamHistoryItem) => {
    setDesde(it.desde);
    setHasta(it.hasta);
    void start({ desde: it.desde, hasta: it.hasta });
  };

  const removeSaved = async (it: DamHistoryItem) => {
    try {
      await damService.removeHistory(companyId, it.id);
      void notify.success('Consulta quitada');
      setHistory((c) => c.filter((x) => x.id !== it.id));
      if (activeId === it.id) setActiveId(null);
      if (watching.current === it.id) watching.current = null;
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const clearHistory = async () => {
    try {
      await damService.clearHistory(companyId);
      void notify.success('Historial limpiado');
      await loadHistory();
      setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const items = useMemo(() => filterDams(resp?.items ?? [], filter), [resp, filter]);
  const showReg = hasRegularizacion(resp?.items ?? []);

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Link to="/tools/consulta-dam" title="Volver a la lista" aria-label="Volver a la lista" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary-700">
            <i className="fas fa-arrow-left text-xs" aria-hidden />
          </Link>
          <PageHeading>{company?.business_name || 'Consulta DAM'}</PageHeading>
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
            Esta consulta es la de <strong>DAM (Declaración Aduanera de Mercancías) de exportación</strong> del Menú SOL de SUNAT, por <strong>fecha de
            numeración</strong> (hasta 3 meses por consulta). La búsqueda de Aduanas es lenta: <strong>puede tardar más de un minuto</strong>. Corre en segundo plano
            y queda en el historial; puede esperar aquí o volver después. Si la empresa no exporta, SUNAT no devuelve resultados.
          </Alert>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="min-w-0 space-y-5">
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Numeradas desde</span>
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
                  <Button className="ml-auto" disabled={starting || running || !!rangeError} onClick={() => void start()}>
                    <i className={`fas ${starting || running ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'} mr-1.5`} aria-hidden />
                    {running ? 'Consultando…' : 'Consultar en SUNAT'}
                  </Button>
                </div>
                {rangeError ? <p className="text-xs text-amber-700">{rangeError}</p> : null}
                {running && !task ? (
                  <p className="text-xs text-amber-700" role="status">
                    Hay una consulta en proceso en SUNAT Aduanas. Se mostrará aquí sola cuando termine.
                  </p>
                ) : null}
                <LongTaskPanel task={task} title="Consultando SUNAT Aduanas" hint="La consulta de Aduanas es lenta. Puede seguir usando el sistema; el resultado se abrirá aquí cuando termine." />
              </div>

              {error ? <SireErrorBox error={error} onRetry={() => void start()} /> : null}

              {resp ? (
                <Card
                  title={`${resp.total} DAM`}
                  subtitle={`Numeradas del ${fmtDay(resp.desde)} al ${fmtDay(resp.hasta)}${savedAt ? ` · guardada ${timeAgo(savedAt)} (no se volvió a consultar)` : ''}`}
                  actions={
                    <Button
                      variant="secondary"
                      className="!py-1.5 text-xs"
                      onClick={() => void exportDamExcel(resp, { empresa: company.business_name, ruc: company.ruc })}
                      disabled={resp.total === 0}
                    >
                      <i className="fas fa-file-excel mr-1.5" aria-hidden />
                      Excel
                    </Button>
                  }
                >
                  {resp.total === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">
                      SUNAT no tiene DAM de exportación numeradas por esta empresa en ese rango de fechas (o la empresa no está autorizada a consultarlas).
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {resp.aviso ? <Alert variant="warning">Aviso de SUNAT: {resp.aviso}</Alert> : null}
                      <div className="flex flex-wrap items-end gap-3 text-sm">
                        <div className="rounded-lg border border-slate-200 px-4 py-2">
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">DAM</span>
                          <span className="font-bold text-slate-800">{resp.total}</span>
                        </div>
                        <div className="rounded-lg border border-slate-200 px-4 py-2">
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">Valor en aduana</span>
                          <span className="font-bold text-slate-800">{fmtDamAmount(resp.total_valor)}</span>
                        </div>
                        <div className="rounded-lg border border-slate-200 px-4 py-2">
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">Cláusula de venta</span>
                          <span className="font-bold text-slate-800">{fmtDamAmount(resp.total_clausula)}</span>
                        </div>
                        <label className="ml-auto text-xs text-slate-600">
                          <span className="mb-0.5 block">Filtrar</span>
                          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="DAM, exportador, consignatario…" className={`${INPUT_CLS} w-64`} />
                        </label>
                      </div>

                      <div className="overflow-auto">
                        <table className="min-w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500 uppercase">
                              {['DAM', 'Numeración', 'Despachador', 'Exportador', 'Consignatario', 'Embarque', 'Cláusula de venta', 'Valor en aduana', ...(showReg ? ['Regularización'] : [])].map((h) => (
                                <th
                                  key={h}
                                  className={`whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold ${h === 'Cláusula de venta' || h === 'Valor en aduana' ? 'text-right' : ''}`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((r) => (
                              <tr key={`${r.dam}-${r.id_declaracion ?? ''}`} className="border-b border-slate-100 align-top hover:bg-slate-50/70">
                                <td className="whitespace-nowrap px-2 py-2 font-mono">{r.dam}</td>
                                <td className="whitespace-nowrap px-2 py-2">{r.fec_numeracion}</td>
                                <td className="max-w-[14rem] px-2 py-2">{r.despachador}</td>
                                <td className="max-w-[14rem] px-2 py-2">{r.exportador}</td>
                                <td className="max-w-[14rem] px-2 py-2">{r.consignatario}</td>
                                <td className="whitespace-nowrap px-2 py-2">{r.tipo_embarque}</td>
                                <td className="whitespace-nowrap px-2 py-2 text-right font-mono">{fmtDamAmount(r.clausula_venta)}</td>
                                <td className="whitespace-nowrap px-2 py-2 text-right font-mono font-semibold">{fmtDamAmount(r.valor_aduana)}</td>
                                {showReg ? <td className="whitespace-nowrap px-2 py-2">{r.regularizacion || '—'}</td> : null}
                              </tr>
                            ))}
                            {items.length === 0 ? (
                              <tr>
                                <td colSpan={showReg ? 9 : 8} className="px-2 py-6 text-center text-slate-500">
                                  Ninguna DAM coincide con el filtro.
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
                    <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={history.every((h) => h.status === 'en_proceso')} onClick={() => void clearHistory()}>
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
                        busy={starting || running || opening}
                        onOpen={(x) => void showSaved(x, true)}
                        onRemove={(x) => void removeSaved(x)}
                        onRetry={retrySaved}
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

export default DamCompany;
