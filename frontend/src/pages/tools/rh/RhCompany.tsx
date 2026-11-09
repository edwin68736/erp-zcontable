import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { rheService, type RheComprobante, type RheHistoryItem, type RheResponse, type RheTipo } from '../../../services/rhe';
import type { SireApiError } from '../../../services/sire';
import { timeAgo } from '../buzon/buzonUi';
import { Card, SireErrorBox } from '../sire/SireShared';
import { INPUT_CLS, SELECT_CLS, sireMissing } from '../sire/sireUi';
import {
  RH_ESTADOS,
  RH_ESTADO_BADGE,
  RH_MAX_DAYS,
  daysAgo,
  daysBetween,
  docLabel,
  exportRheExcel,
  fmtDay,
  fmtMoney,
  motivosLabel,
  totalsByCurrency,
} from './rhUi';
import { formatDateTime } from '../../../utils/format';
import Alert from '../../../components/ui/Alert';
import { notify } from '../../../utils/notify';
import LongTaskPanel from '../../../components/LongTaskPanel';
import { failTask, finishTask, startTask, taskKey } from '../../../utils/longTasks';
import { useTask, useTaskSettled } from '../../../utils/useLongTasks';

const RANGES = [
  { label: '15 días', days: 15 },
  { label: '30 días', days: 30 },
  { label: '3 meses', days: 90 },
  { label: '6 meses', days: 180 },
];

function Detail({ r, motivos }: { r: RheComprobante; motivos: Record<string, string> }) {
  return (
    <div className="grid grid-cols-1 gap-3 text-xs text-slate-700 md:grid-cols-3">
      <div>
        <p className="mb-1 font-semibold text-slate-800">Fechas</p>
        <p>Emisión: {fmtDay(r.fec_emision)}</p>
        <p>Puesta a disposición: {fmtDay(r.fec_puesta_disposicion)}</p>
        <p>Plazo de pago: {fmtDay(r.fec_plazo_pago)}</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-slate-800">Cuotas</p>
        {(r.cuotas ?? []).length === 0 ? (
          <p className="text-slate-500">Sin cuotas informadas.</p>
        ) : (
          (r.cuotas ?? []).map((c) => (
            <p key={c.numero}>
              Cuota {c.numero}: {fmtMoney(c.monto, r.moneda)} — vence {fmtDay(c.vencimiento)}
            </p>
          ))
        )}
        {r.monto_pendiente ? <p className="mt-1">Monto neto pendiente de pago: {fmtMoney(r.monto_pendiente, r.moneda)}</p> : null}
      </div>
      <div>
        {r.fec_disconformidad ? (
          <>
            <p className="mb-1 font-semibold text-slate-800">Disconformidad</p>
            <p>Fecha: {fmtDay(r.fec_disconformidad)}</p>
            <p>Motivos: {motivosLabel(r.motivos_disconformidad, motivos) || '—'}</p>
            {r.sustento_disconformidad ? <p>Sustento: {r.sustento_disconformidad}</p> : null}
          </>
        ) : null}
        {r.fec_subsanacion ? (
          <>
            <p className="mb-1 font-semibold text-slate-800">Subsanación</p>
            <p>Fecha: {fmtDay(r.fec_subsanacion)}</p>
            {(r.notas_subsanacion ?? []).map((n) => (
              <p key={`${n.serie}-${n.numero}`}>
                {n.cod_cpe} {n.serie}-{n.numero}
                {n.comentario ? ` — ${n.comentario}` : ''}
                {n.motivos.length ? ` (motivos: ${motivosLabel(n.motivos, motivos)})` : ''}
              </p>
            ))}
          </>
        ) : null}
        {!r.fec_disconformidad && !r.fec_subsanacion ? <p className="text-slate-500">Sin disconformidad ni subsanación.</p> : null}
      </div>
    </div>
  );
}

/** Una consulta del historial: se abre con un clic (resultado guardado, sin volver a consultar a SUNAT). */
function HistoryEntry({
  item,
  active,
  busy,
  onOpen,
  onRemove,
  onRetry,
}: {
  item: RheHistoryItem;
  active: boolean;
  busy: boolean;
  onOpen: (it: RheHistoryItem) => void;
  onRemove: (it: RheHistoryItem) => void;
  onRetry: (it: RheHistoryItem) => void;
}) {
  const [detail, setDetail] = useState(false);
  const estados = item.estados
    .split(",")
    .filter(Boolean)
    .map((v) => RH_ESTADOS[item.tipo].find((e) => e.value === v)?.label ?? v)
    .join(", ");
  return (
    <li
      className={`rounded-xl border p-3 ${active ? "border-blue-400 bg-blue-50/60" : "border-slate-200"}`}
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-slate-800">
            {item.tipo === "C" ? "Recibidos" : "Emitidos"}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {item.cod_cpe === "02" ? "RHE" : "Factura"}
          </span>
          {item.status === "listo" ? (
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
              {item.total}
            </span>
          ) : null}
          {item.status === "sin_datos" ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              Sin resultados
            </span>
          ) : null}
          {item.status === "error" ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              Error
            </span>
          ) : null}
        </div>
        <p className="text-xs text-slate-700">
          {fmtDay(item.desde)} al {fmtDay(item.hasta)}
        </p>
        {estados ? <p className="text-2xs text-slate-500">{estados}</p> : null}
        <p
          className="text-2xs text-slate-400"
          title={formatDateTime(item.created_at)}
        >
          {timeAgo(item.created_at)}
          {item.status === "listo" || item.status === "sin_datos"
            ? ` · ${item.consultas} consulta${item.consultas === 1 ? "" : "s"} a SUNAT`
            : ""}
          {item.truncado ? " · incompleta (tope)" : ""}
        </p>
        {item.status === "error" ? (
          <p className="text-xs text-red-700">
            {item.error_message || "No se pudo completar la consulta."}
            {item.error_detail ? (
              <button
                type="button"
                onClick={() => setDetail((v) => !v)}
                className="ml-2 underline"
              >
                {detail ? "Ocultar detalle técnico" : "Ver detalle técnico"}
              </button>
            ) : null}
          </p>
        ) : null}
        {detail && item.error_detail ? (
          <p className="break-words rounded-md bg-slate-50 px-2 py-1.5 font-mono text-2xs text-slate-700">
            {item.error_code ? `[${item.error_code}] ` : ""}
            {item.error_detail}
          </p>
        ) : null}
        <div className="flex items-center gap-2 pt-0.5">
          {item.status === "listo" ? (
            <Button
              variant="secondary"
              className="!px-3 !py-1 text-xs"
              disabled={busy || active}
              onClick={() => onOpen(item)}
            >
              <i className="fas fa-eye mr-1.5" aria-hidden />
              {active ? "Viendo" : "Ver"}
            </Button>
          ) : null}
          {item.status === "error" || item.status === "sin_datos" ? (
            <Button
              variant="secondary"
              className="!px-3 !py-1 text-xs"
              disabled={busy}
              onClick={() => onRetry(item)}
            >
              <i className="fas fa-rotate-right mr-1.5" aria-hidden />
              {item.status === "error" ? "Reintentar" : "Consultar de nuevo"}
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
 * Herramientas → RH → una empresa: consulta en SUNAT los recibos por honorarios (o facturas) que están en la
 * plataforma de confirmación del RHE y de la FE: pendientes, subsanados y pendientes por reinicio (compras) o
 * disconformes (ventas). Solo lectura.
 */
const RhCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [tipo, setTipo] = useState<RheTipo>('C');
  const [codCpe, setCodCpe] = useState<'02' | '01'>('02');
  const [desde, setDesde] = useState(daysAgo(30));
  const [hasta, setHasta] = useState(daysAgo(0));
  const [estados, setEstados] = useState<string[]>(() => RH_ESTADOS.C.map((e) => e.value));
  const [error, setError] = useState<SireApiError | null>(null);
  const [resp, setResp] = useState<RheResponse | null>(null);
  const [queried, setQueried] = useState<{ tipo: RheTipo; desde: string; hasta: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState('');
  // Historial de consultas de la empresa (se guarda en el servidor; el resultado se puede volver a ver sin consultar a SUNAT).
  const [history, setHistory] = useState<RheHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<SireApiError | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [opening, setOpening] = useState(false);
  // La consulta a SUNAT la sigue el registro global (utils/longTasks): sobrevive a un cambio de pantalla.
  const task = useTask(taskKey('rh', companyId));
  const loading = task?.status === 'running';
  const ownTask = useRef<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await rheService.history(companyId));
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  }, [companyId]);

  useEffect(() => {
    if (!Number.isFinite(companyId) || companyId <= 0) return;
    void loadHistory();
  }, [companyId, loadHistory]);

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
  const span = daysBetween(desde, hasta);
  const rangeError =
    !desde || !hasta ? 'Indique las dos fechas.' : span < 0 ? 'La fecha «desde» no puede ser mayor que «hasta».' : span > RH_MAX_DAYS ? `El rango máximo es de ${RH_MAX_DAYS} días.` : '';

  const changeTipo = (t: RheTipo) => {
    setTipo(t);
    setEstados(RH_ESTADOS[t].map((e) => e.value));
  };

  const toggleEstado = (v: string) =>
    setEstados((cur) => (cur.includes(v) ? (cur.length > 1 ? cur.filter((x) => x !== v) : cur) : [...cur, v]));

  const run = async (p?: {
    tipo: RheTipo;
    cod_cpe: "02" | "01";
    desde: string;
    hasta: string;
    estados: string[];
  }) => {
    const params = p ?? { tipo, cod_cpe: codCpe, desde, hasta, estados };
    setError(null);
    setOpen("");
    setSavedAt("");
    const t = startTask({
      tool: 'rh',
      toolLabel: 'RH',
      companyId,
      companyName: company?.business_name || `Empresa ${companyId}`,
      detail: `${params.tipo === 'C' ? 'Recibidos' : 'Emitidos'} · ${fmtDay(params.desde)} – ${fmtDay(params.hasta)}`,
      href: `/tools/rh/${companyId}`,
    });
    ownTask.current = t.id;
    try {
      const r = await rheService.list(companyId, params);
      finishTask(t.id, { resultId: r.history_id ?? undefined, summary: `${r.data.total} comprobante${r.data.total === 1 ? '' : 's'}` });
      setResp(r);
      setQueried({
        tipo: params.tipo,
        desde: params.desde,
        hasta: params.hasta,
      });
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

  /** Pone en el formulario los filtros de una consulta guardada. */
  const applyQuery = (it: RheHistoryItem) => {
    const vals = it.estados.split(",").filter(Boolean);
    setTipo(it.tipo);
    setCodCpe(it.cod_cpe);
    setDesde(it.desde);
    setHasta(it.hasta);
    setEstados(vals.length ? vals : RH_ESTADOS[it.tipo].map((e) => e.value));
    return {
      tipo: it.tipo,
      cod_cpe: it.cod_cpe,
      desde: it.desde,
      hasta: it.hasta,
      estados: vals.length ? vals : RH_ESTADOS[it.tipo].map((e) => e.value),
    };
  };

  /** Muestra el resultado guardado de una consulta (sin volver a consultar a SUNAT). */
  const openSaved = async (it: RheHistoryItem) => {
    setOpening(true);
    setError(null);
    try {
      const r = await rheService.historyGet(companyId, it.id);
      applyQuery(it);
      setResp(r);
      setQueried({ tipo: it.tipo, desde: it.desde, hasta: it.hasta });
      setActiveId(it.id);
      setSavedAt(it.created_at);
      setOpen("");
      setFilter("");
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setOpening(false);
    }
  };

  // Salió de la pantalla durante la consulta y volvió: el resultado está en el historial del servidor.
  useTaskSettled(taskKey('rh', companyId), ownTask, (done) => {
    if (done.status === 'error') {
      setResp(null);
      setError({ message: done.errorMessage ?? 'SUNAT no respondió. Intente de nuevo.' });
      return;
    }
    void (async () => {
      try {
        const items = await rheService.history(companyId);
        setHistory(items);
        const it = items.find((x) => x.id === done.resultId) ?? items[0];
        if (it) await openSaved(it);
      } catch (e) {
        setError(e as SireApiError);
      }
    })();
  });

  const retrySaved = (it: RheHistoryItem) => void run(applyQuery(it));

  const removeSaved = async (it: RheHistoryItem) => {
    try {
      await rheService.removeHistory(companyId, it.id);
      void notify.success('Consulta quitada');
      setHistory((cur) => cur.filter((x) => x.id !== it.id));
      if (activeId === it.id) setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const clearHistory = async () => {
    try {
      await rheService.clearHistory(companyId);
      void notify.success('Historial limpiado');
      setHistory([]);
      setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const items = useMemo(() => {
    const all = resp?.data.items ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.serie}-${r.numero} ${r.ruc_emisor} ${r.estado_desc}`.toLowerCase().includes(q));
  }, [resp, filter]);

  const isRhe = codCpe === '02';

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Link to="/tools/rh" title="Volver a la lista" aria-label="Volver a la lista" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary-700">
            <i className="fas fa-arrow-left text-xs" aria-hidden />
          </Link>
          <PageHeading>{company?.business_name || 'RH'}</PageHeading>
          <p className="text-sm font-medium text-slate-500">{company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}</p>
        </div>
      </div>

      {companyError ? <Alert variant="error">{companyError}</Alert> : null}

      {company && missing ? (
        <Alert variant="warning">
          Falta cargar: <strong>{missing}</strong>. Complételo en{' '}
          <Link to="/finance/claves-sol" className="font-semibold underline">
            Claves SOL
          </Link>{' '}
          (botón Editar de la empresa). Se usan las mismas credenciales de API que el SIRE.
        </Alert>
      ) : null}

      {company && !missing ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-4">
            <Card title="Consulta en SUNAT" subtitle="Elija el tipo de consulta, las fechas y los estados.">
              <div className="space-y-3">
                <div>
                  <span className="mb-0.5 block text-xs text-slate-600">Tipo de consulta</span>
                  <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Tipo de consulta">
                    {(
                      [
                        ['C', 'Recibidos (compras)'],
                        ['V', 'Emitidos (ventas)'],
                      ] as const
                    ).map(([v, label], i) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={tipo === v}
                        onClick={() => changeTipo(v)}
                        className={`flex-1 px-3 py-2 text-sm font-semibold ${i > 0 ? 'border-l border-slate-300 ' : ''}${tipo === v ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block text-xs text-slate-600">
                  <span className="mb-0.5 block">Comprobante</span>
                  <select value={codCpe} onChange={(e) => setCodCpe(e.target.value as '02' | '01')} className={`${SELECT_CLS} w-full`}>
                    <option value="02">Recibo por honorarios</option>
                    <option value="01">Factura</option>
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Emisión desde</span>
                    <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={`${INPUT_CLS} w-full`} />
                  </label>
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Hasta</span>
                    <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={`${INPUT_CLS} w-full`} />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-1" aria-label="Rangos rápidos">
                  <span className="mr-1 text-xs text-slate-500">Últimos:</span>
                  {RANGES.map((r) => (
                    <button
                      key={r.days}
                      type="button"
                      onClick={() => {
                        setDesde(daysAgo(r.days));
                        setHasta(daysAgo(0));
                      }}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                <fieldset>
                  <legend className="mb-1 text-xs text-slate-600">Estados</legend>
                  <div className="space-y-1">
                    {RH_ESTADOS[tipo].map((e) => (
                      <label key={e.value} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={estados.includes(e.value)} onChange={() => toggleEstado(e.value)} />
                        {e.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <Button className="w-full" disabled={loading || !!rangeError} onClick={() => void run()}>
                  <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'} mr-1.5`} aria-hidden />
                  Consultar en SUNAT
                </Button>
                {rangeError ? <p className="text-xs text-amber-700">{rangeError}</p> : null}

                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium text-primary-700 hover:underline">¿Qué muestra esta consulta?</summary>
                  <p className="mt-1.5 leading-relaxed">
                    Usa la <strong>Plataforma de confirmación del RHE y de la FE</strong>: muestra solo los comprobantes pendientes, subsanados o pendientes por
                    reinicio (compras) y disconformes (ventas), no el registro completo. SUNAT permite 15 días por consulta; un rango mayor se consulta por
                    tramos automáticamente.
                  </p>
                </details>
              </div>
            </Card>

            <Card
                title="Historial de consultas"
                subtitle="Quedan guardadas por empresa: ábralas sin volver a consultar a SUNAT."
                actions={
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {history.length}
                    </span>
                    <Button
                      variant="secondary"
                      className="!px-3 !py-1.5 text-xs"
                      disabled={history.length === 0 || loading}
                      onClick={() => void clearHistory()}
                    >
                      <i className="fas fa-broom mr-1.5" aria-hidden />
                      Limpiar
                    </Button>
                  </div>
                }
              >
                {historyError ? (
                  <div className="mb-3">
                    <SireErrorBox
                      error={historyError}
                      onRetry={() => void loadHistory()}
                    />
                  </div>
                ) : null}
                {history.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Aún no hay consultas. Elija las fechas y pulse «Consultar en
                    SUNAT»: aquí quedará el resultado.
                  </p>
                ) : (
                  <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-0.5">
                    {history.map((it) => (
                      <HistoryEntry
                        key={it.id}
                        item={it}
                        active={activeId === it.id}
                        busy={loading || opening}
                        onOpen={(x) => void openSaved(x)}
                        onRemove={(x) => void removeSaved(x)}
                        onRetry={retrySaved}
                      />
                    ))}
                  </ul>
                )}
              </Card>
          </aside>

          <div className="min-w-0 space-y-4">
            <LongTaskPanel task={task} hint="Los rangos largos se consultan por tramos de 15 días. Puede seguir usando el sistema; la consulta queda guardada en el historial." />
            {error ? <SireErrorBox error={error} onRetry={() => void run()} /> : null}

            {resp && queried && !loading ? (
            <Card
              title={`${resp.data.total} comprobante${resp.data.total === 1 ? '' : 's'}`}
              subtitle={`Emisión del ${fmtDay(queried.desde)} al ${fmtDay(queried.hasta)} · ${resp.data.consultas} consultas a SUNAT${savedAt ? ` · guardada ${timeAgo(savedAt)} (no se volvió a consultar)` : ''}`}
              actions={
                resp.data.total > 0 ? (
                  <Button
                    variant="secondary"
                    className="!py-1.5 text-xs"
                    onClick={() =>
                      void exportRheExcel(resp.data.items, resp.motivos, {
                        empresa: company.business_name,
                        ruc: company.ruc,
                        tipo: queried.tipo,
                        desde: queried.desde,
                        hasta: queried.hasta,
                      })
                    }
                  >
                    <i className="fas fa-file-excel mr-1.5" aria-hidden />
                    Excel
                  </Button>
                ) : undefined
              }
            >
              {resp.data.truncado ? (
                <Alert variant="warning" className="mb-3">
                  Hay más comprobantes de los que se muestran (tope de {resp.data.items.length}). Acorte el rango de fechas.
                </Alert>
              ) : null}

              {resp.data.total === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  SUNAT no tiene {isRhe ? 'recibos por honorarios' : 'facturas'} en estos estados para ese rango de fechas.
                </p>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap gap-3 text-sm">
                    {(isRhe
                      ? ([
                          ['Total honorarios', (r: RheComprobante) => r.total_honorarios],
                          ['Retención', (r: RheComprobante) => r.retencion],
                          ['Neto recibido', (r: RheComprobante) => r.neto_recibido],
                        ] as const)
                      : ([
                          ['Importe facturas', (r: RheComprobante) => r.importe_factura],
                          ['Pendiente de pago', (r: RheComprobante) => r.monto_pendiente],
                        ] as const)
                    ).map(([label, pick]) => (
                      <div key={label} className="rounded-lg border border-slate-200 px-4 py-2">
                        <span className="block text-[10px] font-semibold uppercase text-slate-400">{label}</span>
                        {totalsByCurrency(resp.data.items, pick).map(([cur, v]) => (
                          <span key={cur} className="block font-bold text-slate-800">
                            {fmtMoney(v, cur)}
                          </span>
                        ))}
                      </div>
                    ))}
                    <label className="ml-auto self-end text-xs text-slate-600">
                      <span className="mb-0.5 block">Filtrar</span>
                      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Serie-número, RUC o estado…" className={`${INPUT_CLS} w-64`} />
                    </label>
                  </div>

                  <div className="overflow-auto">
                    <table className="min-w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 uppercase">
                          {['', 'Estado', 'Comprobante', 'RUC emisor', 'Emisión', isRhe ? 'Honorarios' : 'Importe', ...(isRhe ? ['Retención', 'Neto'] : ['Pendiente'])].map(
                            (h, i) => (
                              <th key={`${h}-${i}`} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold">
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((r) => {
                          const key = `${r.estado}|${r.ruc_emisor}|${r.cod_cpe}|${docLabel(r)}`;
                          const expanded = open === key;
                          return (
                            <Fragment key={key}>
                              <tr className="border-b border-slate-100 align-top hover:bg-slate-50/70">
                                <td className="px-2 py-2">
                                  <button
                                    type="button"
                                    aria-expanded={expanded}
                                    aria-label={expanded ? 'Ocultar detalle' : 'Ver detalle'}
                                    onClick={() => setOpen(expanded ? '' : key)}
                                    className="text-slate-500 hover:text-slate-800"
                                  >
                                    <i className={`fas ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden />
                                  </button>
                                </td>
                                <td className="px-2 py-2">
                                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${RH_ESTADO_BADGE[r.estado] ?? 'bg-slate-100 text-slate-700'}`}>
                                    {r.estado_desc}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 font-mono">{docLabel(r)}</td>
                                <td className="whitespace-nowrap px-2 py-2 font-mono">{r.ruc_emisor}</td>
                                <td className="whitespace-nowrap px-2 py-2">{fmtDay(r.fec_emision)}</td>
                                {isRhe ? (
                                  <>
                                    <td className="whitespace-nowrap px-2 py-2 text-right">{fmtMoney(r.total_honorarios, r.moneda)}</td>
                                    <td className="whitespace-nowrap px-2 py-2 text-right">{fmtMoney(r.retencion, r.moneda)}</td>
                                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{fmtMoney(r.neto_recibido, r.moneda)}</td>
                                  </>
                                ) : (
                                  <>
                                    <td className="whitespace-nowrap px-2 py-2 text-right">{fmtMoney(r.importe_factura, r.moneda)}</td>
                                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{fmtMoney(r.monto_pendiente, r.moneda)}</td>
                                  </>
                                )}
                              </tr>
                              {expanded ? (
                                <tr className="border-b border-slate-100 bg-slate-50/70">
                                  <td />
                                  <td colSpan={isRhe ? 7 : 6} className="px-2 py-3">
                                    <Detail r={r} motivos={resp.motivos} />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                        {items.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-2 py-6 text-center text-slate-500">
                              Ningún comprobante coincide con el filtro.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          ) : null}

            {!(resp && queried) && !loading && !error ? (
              <Card title="Resultados" subtitle="Aquí verá los comprobantes y podrá descargar el Excel.">
                <p className="py-10 text-center text-sm text-slate-500">
                  Elija el tipo de consulta y las fechas, y pulse «Consultar en SUNAT». También puede abrir una consulta guardada del historial sin volver a
                  consultar a SUNAT.
                </p>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default RhCompany;
