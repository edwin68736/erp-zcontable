import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { itfService, type ItfHistoryItem, type ItfResult, type ItfTable } from '../../../services/itf';
import type { SireApiError } from '../../../services/sire';
import { timeAgo } from '../buzon/buzonUi';
import { Card, SireErrorBox, Spinner } from '../sire/SireShared';
import { INPUT_CLS } from '../sire/sireUi';
import {
  ITF_COD_OPER,
  ITF_MAX_MONTHS,
  ITF_MIN_MONTH,
  addMonths,
  colIndex,
  currentMonth,
  exportItfExcel,
  fmtAmount,
  isAmountColumn,
  monthToPeriod,
  monthsBetween,
  periodLabel,
  periodToMonth,
  summarizeByPeriod,
} from './itfUi';

/** Atajos de rango: (mes actual) → [desde, hasta] en «AAAA-MM». */
const RANGES: { label: string; make: (cur: string) => [string, string] }[] = [
  { label: 'Este año', make: (cur) => [`${cur.slice(0, 4)}-01`, cur] },
  { label: '6 meses', make: (cur) => [addMonths(cur, -5), cur] },
  { label: '12 meses', make: (cur) => [addMonths(cur, -11), cur] },
  {
    label: 'Año anterior',
    make: (cur) => {
      const y = Number(cur.slice(0, 4)) - 1;
      return [`${y}-01`, `${y}-12`];
    },
  },
];

/** Columnas que repiten el dato de la empresa consultada: no se muestran (sí van en el Excel). */
const HIDDEN_COLS = ['tipo doc', 'contribuyente'];

/** Tabla del resultado tal como la entrega SUNAT (importes a la derecha, código de operación con su descripción). */
function DataTable({ t, empty }: { t: ItfTable; empty: string }) {
  const iCod = colIndex(t, 'Cod. Oper.');
  if (t.filas.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-500">{empty}</p>;
  }
  const visible = t.columnas.map((_c, i) => i).filter((i) => !HIDDEN_COLS.includes(t.columnas[i].toLowerCase()));
  return (
    <div className="overflow-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead>
          <tr className="bg-slate-100 text-slate-700">
            {visible.map((i) => (
              <th key={`${t.columnas[i]}-${i}`} className={`whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold ${isAmountColumn(t.columnas[i]) ? 'text-right' : ''}`}>
                {t.columnas[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.filas.map((f, ri) => (
            <tr key={ri} className="border-b border-slate-100 hover:bg-slate-50/70">
              {visible.map((i) => (
                <td
                  key={i}
                  title={i === iCod ? ITF_COD_OPER[f[i].padStart(2, '0')] : undefined}
                  className={`whitespace-nowrap px-2 py-1.5 ${isAmountColumn(t.columnas[i]) ? 'text-right font-mono' : ''} ${i === iCod && ITF_COD_OPER[f[i].padStart(2, '0')] ? 'cursor-help underline decoration-dotted' : ''}`}
                >
                  {f[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
  item: ItfHistoryItem;
  active: boolean;
  busy: boolean;
  onOpen: (it: ItfHistoryItem) => void;
  onRemove: (it: ItfHistoryItem) => void;
  onRetry: (it: ItfHistoryItem) => void;
}) {
  const [detail, setDetail] = useState(false);
  return (
    <li className={`rounded-xl border p-3 ${active ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200'}`}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-slate-800">
            {item.desde === item.hasta ? periodLabel(item.desde) : `${periodLabel(item.desde)} al ${periodLabel(item.hasta)}`}
          </span>
          {item.status === 'listo' ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{item.total}</span> : null}
          {item.status === 'sin_datos' ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sin movimientos</span> : null}
          {item.status === 'error' ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Error</span> : null}
        </div>
        {item.status === 'listo' ? (
          <p className="text-xs text-slate-700">
            ITF S/ {fmtAmount(item.total_impuesto)} · base S/ {fmtAmount(item.total_movimientos)}
          </p>
        ) : null}
        <p className="text-2xs text-slate-400" title={new Date(item.created_at).toLocaleString('es-PE')}>
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
 * Herramientas → Consulta ITF → una empresa: lee en SUNAT (Menú SOL → ITF → Consulta de ITF, Formulario 0695) el
 * Impuesto a las Transacciones Financieras de la empresa entre dos períodos: movimientos acumulados por banco,
 * contra asientos por error y exoneraciones. Usa la clave SOL (no las credenciales de API). Solo lectura.
 * Cada consulta queda guardada en el historial de la empresa.
 */
const ItfCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const cur = currentMonth();
  const [desde, setDesde] = useState(addMonths(cur, -5));
  const [hasta, setHasta] = useState(cur);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SireApiError | null>(null);
  const [resp, setResp] = useState<ItfResult | null>(null);
  const [history, setHistory] = useState<ItfHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<SireApiError | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState('');
  const [opening, setOpening] = useState(false);

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
      setHistory(await itfService.history(companyId));
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
  const span = monthsBetween(desde, hasta);
  const rangeError = !desde || !hasta
    ? 'Indique los dos períodos.'
    : span === 0
      ? 'El período inicial no puede ser posterior al final.'
      : desde < ITF_MIN_MONTH
        ? 'SUNAT consulta desde marzo de 2004.'
        : hasta > cur
          ? 'El período final no puede ser posterior al mes actual.'
          : span > ITF_MAX_MONTHS
            ? `El rango máximo es de ${ITF_MAX_MONTHS} meses.`
            : '';

  const run = async (p?: { desde: string; hasta: string }) => {
    const params = p ?? { desde: monthToPeriod(desde), hasta: monthToPeriod(hasta) };
    setLoading(true);
    setError(null);
    setSavedAt('');
    try {
      const r = await itfService.query(companyId, params.desde, params.hasta);
      setResp(r.data);
      setActiveId(r.history_id ?? null);
    } catch (e) {
      setResp(null);
      setActiveId(null);
      setError(e as SireApiError);
    } finally {
      setLoading(false);
      void loadHistory();
    }
  };

  const applyQuery = (it: ItfHistoryItem) => {
    setDesde(periodToMonth(it.desde));
    setHasta(periodToMonth(it.hasta));
    return { desde: it.desde, hasta: it.hasta };
  };

  /** Muestra el resultado guardado de una consulta (sin volver a consultar a SUNAT). */
  const openSaved = async (it: ItfHistoryItem) => {
    setOpening(true);
    setError(null);
    try {
      const r = await itfService.historyGet(companyId, it.id);
      applyQuery(it);
      setResp(r.data);
      setActiveId(it.id);
      setSavedAt(it.created_at);
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setOpening(false);
    }
  };

  const removeSaved = async (it: ItfHistoryItem) => {
    try {
      await itfService.removeHistory(companyId, it.id);
      setHistory((c) => c.filter((x) => x.id !== it.id));
      if (activeId === it.id) setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const clearHistory = async () => {
    try {
      await itfService.clearHistory(companyId);
      setHistory([]);
      setActiveId(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const byPeriod = useMemo(() => (resp ? summarizeByPeriod(resp.acumulados) : []), [resp]);

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;
  }

  const totalRegistros = resp ? resp.acumulados.registros + resp.contra_asientos.registros + resp.exoneraciones.registros : 0;

  return (
    <div className="space-y-5 pt-2">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Link to="/tools/consulta-itf" title="Volver a la lista" aria-label="Volver a la lista" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary-700">
            <i className="fas fa-arrow-left text-xs" aria-hidden />
          </Link>
          <PageHeading>{company?.business_name || 'Consulta ITF'}</PageHeading>
          <p className="text-sm font-medium text-slate-500">{company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}</p>
        </div>
      </div>

      {companyError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{companyError}</p> : null}

      {company && missingSol ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Falta cargar: <strong>usuario y clave SOL</strong>. Complételos en{' '}
          <Link to="/finance/claves-sol" className="font-semibold underline">
            Claves SOL
          </Link>{' '}
          (botón Editar de la empresa). Esta consulta entra a SUNAT con la clave SOL; no usa las credenciales de API.
        </div>
      ) : null}

      {company && !missingSol ? (
        <>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
            Esta consulta es la de <strong>ITF · Formulario 0695</strong> del Menú SOL de SUNAT: movimientos de las cuentas de la empresa afectos al Impuesto a las
            Transacciones Financieras, por banco y período. La <strong>base imponible es referencial</strong>: SUNAT la calcula a partir del impuesto retenido.
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="min-w-0 space-y-5">
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Período inicial</span>
                    <input type="month" value={desde} min={ITF_MIN_MONTH} max={hasta || cur} onChange={(e) => setDesde(e.target.value)} className={INPUT_CLS} />
                  </label>
                  <label className="text-xs text-slate-600">
                    <span className="mb-0.5 block">Período final</span>
                    <input type="month" value={hasta} min={desde || ITF_MIN_MONTH} max={cur} onChange={(e) => setHasta(e.target.value)} className={INPUT_CLS} />
                  </label>
                  <div className="flex flex-wrap gap-1" aria-label="Rangos rápidos">
                    {RANGES.map((r) => (
                      <button
                        key={r.label}
                        type="button"
                        onClick={() => {
                          const [d, h] = r.make(cur);
                          setDesde(d);
                          setHasta(h);
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

              {loading ? <Spinner label="Consultando el ITF en SUNAT (entra a SOL con la clave de la empresa)…" /> : null}
              {error ? <SireErrorBox error={error} onRetry={() => void run()} /> : null}

              {resp && !loading ? (
                <Card
                  title={`ITF ${periodLabel(resp.desde)} al ${periodLabel(resp.hasta)}`}
                  subtitle={`${totalRegistros} registro${totalRegistros === 1 ? '' : 's'}${savedAt ? ` · guardada ${timeAgo(savedAt)} (no se volvió a consultar)` : ''}`}
                  actions={
                    <Button
                      variant="secondary"
                      className="!py-1.5 text-xs"
                      onClick={() => void exportItfExcel(resp, { empresa: company.business_name, ruc: company.ruc })}
                      disabled={totalRegistros === 0}
                    >
                      <i className="fas fa-file-excel mr-1.5" aria-hidden />
                      Excel
                    </Button>
                  }
                >
                  {totalRegistros === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">SUNAT no registra movimientos afectos al ITF para este rango de períodos.</p>
                  ) : (
                    <div className="space-y-5">
                      <div className="flex flex-wrap gap-3 text-sm">
                        <div className="rounded-lg border border-slate-200 px-4 py-2">
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">ITF (impuesto)</span>
                          <span className="font-bold text-slate-800">S/ {fmtAmount(resp.acumulados.total_impuesto ?? 0)}</span>
                        </div>
                        <div className="rounded-lg border border-slate-200 px-4 py-2">
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">Base (referencial)</span>
                          <span className="font-bold text-slate-800">S/ {fmtAmount(resp.acumulados.total_movimientos ?? 0)}</span>
                        </div>
                        <div className="rounded-lg border border-slate-200 px-4 py-2">
                          <span className="block text-[10px] font-semibold uppercase text-slate-400">Registros</span>
                          <span className="font-bold text-slate-800">{totalRegistros}</span>
                        </div>
                      </div>

                      {byPeriod.length > 0 ? (
                        <div>
                          <h4 className="mb-1.5 text-xs font-bold uppercase text-slate-500">Resumen por período</h4>
                          <div className="overflow-auto">
                            <table className="min-w-full border-collapse text-left text-xs">
                              <thead>
                                <tr className="bg-slate-100 text-slate-700">
                                  <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Período</th>
                                  <th className="border-b border-slate-200 px-2 py-1.5 text-right font-semibold">Operaciones</th>
                                  <th className="border-b border-slate-200 px-2 py-1.5 text-right font-semibold">Base</th>
                                  <th className="border-b border-slate-200 px-2 py-1.5 text-right font-semibold">ITF</th>
                                </tr>
                              </thead>
                              <tbody>
                                {byPeriod.map((r) => (
                                  <tr key={r.periodo} className="border-b border-slate-100">
                                    <td className="px-2 py-1.5 font-mono">{periodLabel(r.periodo)}</td>
                                    <td className="px-2 py-1.5 text-right">{r.operaciones}</td>
                                    <td className="px-2 py-1.5 text-right font-mono">{fmtAmount(r.base)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmtAmount(r.impuesto)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}

                      <div>
                        <h4 className="mb-1.5 text-xs font-bold uppercase text-slate-500">{resp.acumulados.titulo || 'Movimientos acumulados'}</h4>
                        <DataTable t={resp.acumulados} empty="Sin movimientos acumulados en este rango." />
                      </div>
                      <div>
                        <h4 className="mb-1.5 text-xs font-bold uppercase text-slate-500">{resp.contra_asientos.titulo || 'Contra asientos por error'}</h4>
                        <DataTable t={resp.contra_asientos} empty="Sin contra asientos por error." />
                      </div>
                      <div>
                        <h4 className="mb-1.5 text-xs font-bold uppercase text-slate-500">{resp.exoneraciones.titulo || 'Exoneración, convenios e inafectación'}</h4>
                        <DataTable t={resp.exoneraciones} empty="Sin exoneraciones, convenios ni inafectación." />
                      </div>
                      {resp.nota ? <p className="text-2xs text-slate-500">Nota de SUNAT: {resp.nota}</p> : null}
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
                  <p className="py-8 text-center text-sm text-slate-500">Aún no hay consultas. Elija los períodos y pulse «Consultar en SUNAT»: aquí quedará el resultado.</p>
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

export default ItfCompany;
