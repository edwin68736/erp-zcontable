import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import LongTaskPanel from '../../../components/LongTaskPanel';
import type { CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { rheSolService, type RheSolHistoryItem, type RheSolItem, type RheSolResponse } from '../../../services/rheSol';
import type { SireApiError } from '../../../services/sire';
import { formatDateTime } from '../../../utils/format';
import { failTask, finishTask, startTask, taskKey } from '../../../utils/longTasks';
import { notify } from '../../../utils/notify';
import { useTask, useTaskSettled } from '../../../utils/useLongTasks';
import { timeAgo } from '../buzon/buzonUi';
import { Card, SireErrorBox } from '../sire/SireShared';
import { INPUT_CLS } from '../sire/sireUi';
import { daysAgo, daysBetween, fmtDay, fmtMoney } from './rhUi';
import { RH_SOL_MAX_DAYS, exportRheSolExcel, tipoLabel, totalsByMoneda } from './rhSolUi';

const QUICK_RANGES = [
  { label: '30 días', days: 29 },
  { label: '3 meses', days: 89 },
  { label: '6 meses', days: 179 },
  { label: '12 meses', days: 364 },
];

function HistoryEntry({
  item,
  active,
  busy,
  onOpen,
  onRemove,
}: {
  item: RheSolHistoryItem;
  active: boolean;
  busy: boolean;
  onOpen: (it: RheSolHistoryItem) => void;
  onRemove: (it: RheSolHistoryItem) => void;
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
          {item.status === 'sin_datos' ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sin resultados</span> : null}
          {item.status === 'error' ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Error</span> : null}
        </div>
        <p className="text-2xs text-slate-400" title={formatDateTime(item.created_at)}>
          {timeAgo(item.created_at)}
          {item.status !== 'error' ? ` · ${item.consultas} búsqueda${item.consultas === 1 ? '' : 's'} en SUNAT` : ''}
          {item.truncado ? ' · incompleta (tope)' : ''}
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
            <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={busy} onClick={() => onOpen(item)}>
              <i className="fas fa-folder-open mr-1.5" aria-hidden />
              Abrir
            </Button>
          ) : null}
          <button type="button" className="ml-auto text-slate-400 hover:text-red-600" title="Quitar del historial" aria-label="Quitar del historial" disabled={busy} onClick={() => onRemove(item)}>
            <i className="fas fa-trash-can" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}

function ItemRow({ r }: { r: RheSolItem }) {
  const [open, setOpen] = useState(false);
  const extra = r.descripcion || r.observacion;
  return (
    <>
      <tr className={`border-b border-slate-100 align-top ${r.anulado ? 'text-slate-400' : ''}`}>
        <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtDay(r.fec_emision)}</td>
        <td className="px-2 py-2 whitespace-nowrap">
          <span className="font-mono text-xs">{r.comprobante}</span>
          <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-medium text-slate-600" title={tipoLabel(r.tipo)}>
            {r.tipo}
          </span>
          {r.anulado ? <p className="mt-0.5"><span className="rounded-full bg-red-50 px-2 py-0.5 text-2xs font-semibold text-red-700">{r.estado}</span></p> : null}
        </td>
        <td className="px-2 py-2">
          <p className="font-medium leading-tight">{r.emisor_nombre || '—'}</p>
          <p className="font-mono text-2xs text-slate-500">
            {r.emisor_tipo_doc} {r.emisor_doc}
          </p>
        </td>
        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(r.renta_bruta, r.moneda)}</td>
        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(r.impuesto_renta, r.moneda)}</td>
        <td className="px-2 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{fmtMoney(r.renta_neta, r.moneda)}</td>
        <td className="px-2 py-2 text-right">
          {extra ? (
            <button type="button" className="text-slate-400 hover:text-primary-700" aria-expanded={open} aria-label={open ? 'Ocultar descripción' : 'Ver descripción'} onClick={() => setOpen((v) => !v)}>
              <i className={`fas ${open ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden />
            </button>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-slate-100 bg-slate-50/70 text-xs text-slate-600">
          <td colSpan={7} className="px-3 py-2">
            {r.descripcion ? <p>{r.descripcion}</p> : null}
            {r.observacion ? <p className="mt-0.5 text-slate-500">Observación: {r.observacion}</p> : null}
            <p className="mt-0.5 text-slate-400">
              Tipo de renta {r.tipo_renta || '—'}
              {r.gratuito ? ' · Gratuito' : ''}
              {r.monto_pendiente > 0 ? ` · Pendiente de pago ${fmtMoney(r.monto_pendiente, r.moneda)}` : ''}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Herramientas → RH → una empresa → «Recibos recibidos»: lee en SOL (Consulta Receptor) todos los recibos por honorarios,
 * notas de crédito y otros ingresos de 4.ª categoría emitidos a la empresa. Solo lectura. Usa la clave SOL de la empresa.
 */
const RhSolPanel = ({ companyId, company }: { companyId: number; company: CompanyAccessCredentialRow | null }) => {
  const [desde, setDesde] = useState(daysAgo(89));
  const [hasta, setHasta] = useState(daysAgo(0));
  const [error, setError] = useState<SireApiError | null>(null);
  const [resp, setResp] = useState<RheSolResponse | null>(null);
  const [filter, setFilter] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [history, setHistory] = useState<RheSolHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<SireApiError | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState('');
  const [opening, setOpening] = useState(false);
  // La consulta a SUNAT la sigue el registro global (utils/longTasks): sobrevive a un cambio de pantalla.
  const task = useTask(taskKey('rh', companyId));
  const loading = task?.status === 'running';
  const ownTask = useRef<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await rheSolService.history(companyId));
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  }, [companyId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const hasKey = company?.sol_configurado ?? false;
  const span = daysBetween(desde, hasta);
  const rangeError =
    !desde || !hasta
      ? 'Indique las dos fechas.'
      : span < 0
        ? 'La fecha «desde» no puede ser mayor que «hasta».'
        : span + 1 > RH_SOL_MAX_DAYS
          ? `El rango máximo es de ${RH_SOL_MAX_DAYS} días.`
          : hasta > daysAgo(0)
            ? 'La fecha «hasta» no puede ser posterior a hoy.'
            : '';

  const run = async (p?: { desde: string; hasta: string }) => {
    const params = p ?? { desde, hasta };
    setError(null);
    setSavedAt('');
    setFilter('');
    const t = startTask({
      tool: 'rh',
      toolLabel: 'RH',
      companyId,
      companyName: company?.business_name || `Empresa ${companyId}`,
      detail: `Recibidos · ${fmtDay(params.desde)} – ${fmtDay(params.hasta)}`,
      href: `/tools/rh/${companyId}`,
    });
    ownTask.current = t.id;
    try {
      const r = await rheSolService.query(companyId, params.desde, params.hasta);
      finishTask(t.id, { resultId: r.history_id ?? undefined, summary: `${r.data.total} comprobante${r.data.total === 1 ? '' : 's'}` });
      setResp(r);
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

  /** Muestra el resultado guardado de una consulta (sin volver a consultar a SUNAT). */
  const openSaved = async (it: RheSolHistoryItem) => {
    setOpening(true);
    setError(null);
    try {
      const r = await rheSolService.historyGet(companyId, it.id);
      setDesde(it.desde);
      setHasta(it.hasta);
      setResp(r);
      setActiveId(it.id);
      setSavedAt(it.created_at);
      setFilter('');
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
        const items = await rheSolService.history(companyId);
        setHistory(items);
        const it = items.find((x) => x.id === done.resultId) ?? items[0];
        if (it) await openSaved(it);
      } catch (e) {
        setError(e as SireApiError);
      }
    })();
  });

  const removeSaved = async (it: RheSolHistoryItem) => {
    try {
      await rheSolService.removeHistory(companyId, it.id);
      void notify.success('Consulta quitada');
      setHistory((c) => c.filter((x) => x.id !== it.id));
      if (activeId === it.id) setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const clearHistory = async () => {
    if (!(await notify.confirm({ message: '¿Limpiar el historial de consultas?', title: 'Limpiar historial', confirmLabel: 'Limpiar', danger: true }))) return;
    try {
      await rheSolService.clearHistory(companyId);
      void notify.success('Historial limpiado');
      setHistory([]);
      setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const all = useMemo(() => resp?.data.items ?? [], [resp]);
  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return all.filter((r) => {
      if (onlyActive && r.anulado) return false;
      if (!q) return true;
      return `${r.comprobante} ${r.emisor_nombre} ${r.emisor_doc} ${r.descripcion} ${r.tipo}`.toLowerCase().includes(q);
    });
  }, [all, filter, onlyActive]);
  const totals = useMemo(() => totalsByMoneda(items), [items]);
  const anulados = all.filter((r) => r.anulado).length;
  const notas = all.filter((r) => r.tipo === 'NC').length;

  return (
    <div className="space-y-3">
      {company && !hasKey ? (
        <Alert variant="warning">
          Falta cargar el <strong>usuario y la clave SOL</strong> de la empresa. Complételos en{' '}
          <Link to="/finance/claves-sol" className="font-semibold underline">
            Claves SOL
          </Link>{' '}
          (botón Editar de la empresa).
        </Alert>
      ) : null}

      {company && hasKey ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-4">
            <Card title="Consulta en SUNAT" subtitle="Recibos por honorarios recibidos, según su fecha de emisión.">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Emisión desde</span>
                    <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={`${INPUT_CLS} w-full`} />
                  </label>
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Hasta</span>
                    <input type="date" value={hasta} min={desde || undefined} max={daysAgo(0)} onChange={(e) => setHasta(e.target.value)} className={`${INPUT_CLS} w-full`} />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span>Últimos:</span>
                  {QUICK_RANGES.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      onClick={() => {
                        setDesde(daysAgo(r.days));
                        setHasta(daysAgo(0));
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <Button className="w-full" disabled={loading || !!rangeError} onClick={() => void run()}>
                  <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'} mr-1.5`} aria-hidden />
                  Consultar en SUNAT
                </Button>
                {rangeError ? <p className="text-xs text-amber-700">{rangeError}</p> : null}
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium text-primary-700 hover:underline">¿Qué muestra esta consulta?</summary>
                  <p className="mt-1.5 leading-relaxed">
                    Entra a <strong>SUNAT Operaciones en Línea</strong> con la clave SOL de la empresa y abre <em>Recibos por Honorarios Electrónicos → Consulta
                    Receptor</em>: lista <strong>todos</strong> los recibos, notas de crédito y otros ingresos de 4.ª categoría emitidos a la empresa, vigentes o
                    anulados. SUNAT admite 1 mes por búsqueda; un rango mayor se consulta por tramos automáticamente.
                  </p>
                </details>
              </div>
            </Card>

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
                <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-0.5">
                  {history.map((it) => (
                    <HistoryEntry key={it.id} item={it} active={activeId === it.id} busy={loading || opening} onOpen={(x) => void openSaved(x)} onRemove={(x) => void removeSaved(x)} />
                  ))}
                </ul>
              )}
            </Card>
          </aside>

          <div className="min-w-0 space-y-4">
            <LongTaskPanel task={task} hint="SUNAT admite 1 mes por búsqueda, así que un rango largo se consulta por tramos. Puede seguir usando el sistema; la consulta queda guardada en el historial." />
            {error ? <SireErrorBox error={error} onRetry={() => void run()} /> : null}

            {resp && !loading ? (
              <Card
                title={`${resp.data.total} comprobante${resp.data.total === 1 ? '' : 's'}`}
                subtitle={`Emisión del ${fmtDay(resp.data.desde)} al ${fmtDay(resp.data.hasta)} · ${resp.data.consultas} búsqueda${resp.data.consultas === 1 ? '' : 's'} en SUNAT${savedAt ? ` · guardada ${timeAgo(savedAt)} (no se volvió a consultar)` : ''}`}
                actions={
                  resp.data.total > 0 ? (
                    <Button
                      variant="secondary"
                      className="!py-1.5 text-xs"
                      onClick={() => void exportRheSolExcel(items, { empresa: company.business_name, ruc: company.ruc, desde: resp.data.desde, hasta: resp.data.hasta })}
                    >
                      <i className="fas fa-file-excel mr-1.5" aria-hidden />
                      Excel
                    </Button>
                  ) : null
                }
              >
                {resp.data.truncado ? <Alert variant="warning">Hay más comprobantes de los que se muestran (tope de 5000). Acote el rango de fechas.</Alert> : null}
                {resp.data.total === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">SUNAT no devolvió recibos para este rango de fechas.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {totals.length === 0 ? (
                        <p className="text-sm text-slate-500 sm:col-span-3">Sin importes vigentes para sumar.</p>
                      ) : (
                        totals.map((t) => (
                          <div key={t.moneda} className="contents">
                            <div className="rounded-xl border border-slate-200 px-3 py-2">
                              <p className="text-2xs font-semibold uppercase text-slate-400">Renta bruta{totals.length > 1 ? ` (${t.moneda})` : ''}</p>
                              <p className="text-base font-bold tabular-nums">{fmtMoney(t.bruta, t.moneda)}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 px-3 py-2">
                              <p className="text-2xs font-semibold uppercase text-slate-400">Impuesto a la renta{totals.length > 1 ? ` (${t.moneda})` : ''}</p>
                              <p className="text-base font-bold tabular-nums">{fmtMoney(t.impuesto, t.moneda)}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 px-3 py-2">
                              <p className="text-2xs font-semibold uppercase text-slate-400">Renta neta{totals.length > 1 ? ` (${t.moneda})` : ''}</p>
                              <p className="text-base font-bold tabular-nums">{fmtMoney(t.neta, t.moneda)}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      Los totales no incluyen anulados ni notas de crédito
                      {anulados > 0 ? ` · ${anulados} anulado${anulados === 1 ? '' : 's'}` : ''}
                      {notas > 0 ? ` · ${notas} nota${notas === 1 ? '' : 's'} de crédito` : ''}.
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-[14rem] flex-1 text-xs text-slate-600">
                        <span className="mb-0.5 block">Filtrar</span>
                        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Serie-número, emisor, RUC o descripción…" className={`${INPUT_CLS} w-full`} />
                      </label>
                      {anulados > 0 ? (
                        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
                          Ocultar anulados
                        </label>
                      ) : null}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[40rem] text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                            <th className="px-2 py-2 font-semibold">Emisión</th>
                            <th className="px-2 py-2 font-semibold">Comprobante</th>
                            <th className="px-2 py-2 font-semibold">Emisor</th>
                            <th className="px-2 py-2 text-right font-semibold">Renta bruta</th>
                            <th className="px-2 py-2 text-right font-semibold">Imp. renta</th>
                            <th className="px-2 py-2 text-right font-semibold">Renta neta</th>
                            <th className="w-8 px-2 py-2" aria-label="Descripción" />
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((r) => (
                            <ItemRow key={`${r.tipo}|${r.comprobante}|${r.emisor_doc}`} r={r} />
                          ))}
                        </tbody>
                      </table>
                      {items.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Ningún comprobante coincide con el filtro.</p> : null}
                    </div>
                  </div>
                )}
              </Card>
            ) : null}

            {!resp && !loading && !error ? (
              <Card title="Resultados" subtitle="Aquí verá los recibos y podrá descargar el Excel.">
                <p className="py-10 text-center text-sm text-slate-500">
                  Elija el rango de fechas y pulse «Consultar en SUNAT». También puede abrir una consulta guardada del historial sin volver a consultar a SUNAT.
                </p>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default RhSolPanel;
