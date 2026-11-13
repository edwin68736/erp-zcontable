import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { saveAs } from 'file-saver';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import LongTaskPanel from '../../../components/LongTaskPanel';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { spotService, type SpotDownloadItem, type SpotFilter, type SpotModo, type SpotTipoCuenta, type SpotTipoPago } from '../../../services/spot';
import type { SireApiError } from '../../../services/sire';
import { formatDateTime } from '../../../utils/format';
import { taskKey, trackAsync } from '../../../utils/longTasks';
import { notify } from '../../../utils/notify';
import { useTask, useTaskSettled } from '../../../utils/useLongTasks';
import { timeAgo } from '../buzon/buzonUi';
import { daysAgo } from '../rh/rhUi';
import { Card, SireErrorBox } from '../sire/SireShared';
import { INPUT_CLS } from '../sire/sireUi';
import { MESES, SPOT_MAX_DAYS, TIPOS_CUENTA, TIPOS_PAGO, aniosDisponibles, cuentaNombre, filterError, mesesDelAnio, pagoNombre, pagosParaCuenta, periodoDe, rangoTexto, resumenTexto } from './spotUi';

const TOOL = 'detracciones';

const SELECT_CLS = `${INPUT_CLS} w-full`;

/** Una descarga del historial «Descargas Realizadas». */
function DownloadEntry({
  item,
  company,
  busy,
  onOpen,
  onRemove,
}: {
  item: SpotDownloadItem;
  company: CompanyAccessCredentialRow | null;
  busy: boolean;
  onOpen: (it: SpotDownloadItem, excel: boolean) => void;
  onRemove: (it: SpotDownloadItem) => void;
}) {
  const [detail, setDetail] = useState(false);
  const failed = item.status === 'error';
  const empty = item.status === 'sin_datos';
  const ready = item.status === 'listo';
  const running = item.status === 'en_proceso';
  return (
    <li className={`rounded-xl border p-3 ${failed ? 'border-red-200 bg-red-50/40' : ready ? 'border-green-200 bg-green-50/30' : 'border-slate-200'}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-sm font-bold uppercase text-slate-800">{company ? `${company.ruc} - ${company.business_name}` : `Empresa ${item.company_id}`}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-700">{rangoTexto(item)}</span>
            <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-2xs font-extrabold text-blue-700">DETRACCIONES</span>
            <span className="text-slate-400">
              {cuentaNombre(item.tipo_cuenta).replace('Cuenta de Detracciones ', '')} · {pagoNombre(item.tipo_pago)}
            </span>
          </div>
          {running ? (
            <p className="text-xs font-medium text-blue-700">
              <i className="fas fa-spinner fa-spin mr-1" aria-hidden />
              Descargando constancias de SUNAT…
            </p>
          ) : null}
          {ready || empty ? (
            <p className={`text-xs font-medium ${ready ? 'text-green-700' : 'text-slate-500'}`}>
              {ready ? <i className="fas fa-circle-check mr-1" aria-hidden /> : null}
              {resumenTexto(item)}
            </p>
          ) : null}
          {ready && item.aviso ? <p className="text-xs text-amber-700">{item.aviso}</p> : null}
          {failed ? (
            <p className="text-xs font-medium text-red-700">
              <i className="fas fa-circle-exclamation mr-1" aria-hidden />
              {item.error_message || 'No se pudo completar la descarga.'}
              {item.error_detail ? (
                <button type="button" onClick={() => setDetail((v) => !v)} className="ml-2 font-normal underline">
                  {detail ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
                </button>
              ) : null}
            </p>
          ) : null}
          {detail && item.error_detail ? (
            <p className="break-words rounded-md bg-white/70 px-2 py-1.5 font-mono text-2xs text-slate-700">
              {item.error_code ? `[${item.error_code}] ` : ''}
              {item.error_detail}
            </p>
          ) : null}
          <p className="text-2xs text-slate-400" title={formatDateTime(item.created_at)}>
            {timeAgo(item.created_at)}
          </p>
          {ready ? (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={busy} onClick={() => onOpen(item, false)} title="Bajar el ZIP con el Excel y las constancias">
                <i className="fas fa-folder-open mr-1.5" aria-hidden />
                Abrir
              </Button>
              <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={busy} onClick={() => onOpen(item, true)} title="Bajar solo el Excel del reporte">
                <i className="fas fa-file-excel mr-1.5 text-green-700" aria-hidden />
                Excel
              </Button>
            </div>
          ) : null}
        </div>
        <button type="button" className="shrink-0 text-slate-400 hover:text-red-600 disabled:opacity-40" title="Quitar del historial" aria-label="Quitar del historial" disabled={busy || running} onClick={() => onRemove(item)}>
          <i className="fas fa-xmark" aria-hidden />
        </button>
      </div>
    </li>
  );
}

const radioCls = (on: boolean) => `flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition-colors ${on ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`;

/**
 * Herramientas → Consulta de Detracciones → una empresa: baja de la plataforma de Pagos de SUNAT los pagos de
 * detracciones (constancias de depósito) con los mismos filtros que SUNAT y deja el Excel y las constancias en el historial.
 * Solo lectura. Usa la clave SOL de la empresa. La descarga corre en el servidor y sigue aunque se cambie de pantalla.
 */
const DetraccionesCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const validId = Number.isFinite(companyId) && companyId > 0;
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');

  const hoy = useMemo(() => new Date(), []);
  const [tipoCuenta, setTipoCuenta] = useState<SpotTipoCuenta>('1');
  const [tipoPago, setTipoPago] = useState<SpotTipoPago>('individuales');
  const [modo, setModo] = useState<SpotModo>('fecha');
  const [desde, setDesde] = useState(daysAgo(29));
  const [hasta, setHasta] = useState(daysAgo(0));
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);

  const [history, setHistory] = useState<SpotDownloadItem[]>([]);
  const [historyError, setHistoryError] = useState<SireApiError | null>(null);
  const [error, setError] = useState<SireApiError | null>(null);
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!validId) return;
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
  }, [companyId, validId]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await spotService.history(companyId));
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  }, [companyId]);

  useEffect(() => {
    if (validId) void loadHistory();
  }, [validId, loadHistory]);

  // El registro global sigue la descarga (cabecera + aviso si la persona se fue a otra pantalla).
  const running = history.some((h) => h.status === 'en_proceso');
  const task = useTask(taskKey(TOOL, companyId));
  const ownTask = useRef<number | null>(null);
  useEffect(() => {
    if (!running || task?.status === 'running') return;
    const pending = history.filter((h) => h.status === 'en_proceso');
    const ids = new Set(pending.map((h) => h.id));
    const oldest = Math.min(...pending.map((h) => Date.parse(h.created_at) || Date.now()));
    trackAsync(
      {
        tool: TOOL,
        toolLabel: 'Detracciones',
        companyId,
        companyName: company?.business_name || `Empresa ${companyId}`,
        detail: rangoTexto(pending[0]),
        href: `/tools/consulta-detracciones/${companyId}`,
        startedAt: oldest,
      },
      async () => {
        const rows = (await spotService.history(companyId)).filter((h) => ids.has(h.id));
        if (rows.some((h) => h.status === 'en_proceso')) return { status: 'running' };
        const failed = rows.find((h) => h.status === 'error');
        if (failed) return { status: 'error', message: failed.error_message || 'No se pudo completar la descarga.' };
        return { status: 'done', resultId: rows[0]?.id, summary: `${rows[0]?.total ?? 0} detracciones` };
      },
    );
  }, [running, task?.status, history, companyId, company?.business_name]);
  // Terminó (aquí o mientras la persona estaba en otra pantalla): se refresca el historial.
  useTaskSettled(taskKey(TOOL, companyId), ownTask, () => void loadHistory());
  // Mientras alguna descarga siga en proceso, el historial se refresca solo.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void loadHistory(), 5000);
    return () => window.clearInterval(id);
  }, [running, loadHistory]);

  // Cambiar el tipo de cuenta puede dejar sin sentido el tipo de pago; por periodo solo hay pagos individuales.
  const changeCuenta = (c: SpotTipoCuenta) => {
    setTipoCuenta(c);
    if (!pagosParaCuenta(c).includes(tipoPago)) {
      setTipoPago('individuales');
    }
  };
  const changePago = (p: SpotTipoPago) => {
    setTipoPago(p);
    if (p !== 'individuales') setModo('fecha');
  };
  const periodoDisponible = tipoPago === 'individuales';

  const anios = useMemo(() => aniosDisponibles(hoy), [hoy]);
  const meses = useMemo(() => mesesDelAnio(anio, hoy), [anio, hoy]);
  useEffect(() => {
    // Al cambiar de año, el mes elegido debe existir en ese año.
    if (meses.length > 0 && !meses.includes(mes)) setMes(meses[meses.length - 1]);
  }, [meses, mes]);

  const filter: SpotFilter = {
    tipo_cuenta: tipoCuenta,
    tipo_pago: tipoPago,
    modo,
    desde: modo === 'fecha' ? desde : '',
    hasta: modo === 'fecha' ? hasta : '',
    periodo: modo === 'periodo' ? periodoDe(anio, mes) : '',
  };
  const filterMsg = filterError(filter, daysAgo(0));
  const hasKey = company?.sol_configurado ?? false;
  const busy = starting || running;

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      // El servidor hace el trabajo en segundo plano: la fila «en proceso» del historial la sigue el registro global (efecto de arriba).
      await spotService.start(companyId, filter);
      await loadHistory();
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setStarting(false);
    }
  };

  const open = async (it: SpotDownloadItem, excel: boolean) => {
    setOpening(true);
    try {
      const f = await spotService.file(companyId, it.id, excel);
      saveAs(f.blob, f.name);
    } catch (e) {
      void notify.error('No se pudo bajar el archivo', (e as SireApiError).message);
    } finally {
      setOpening(false);
    }
  };

  const remove = async (it: SpotDownloadItem) => {
    try {
      await spotService.remove(companyId, it.id);
      void notify.success('Descarga quitada');
      setHistory((c) => c.filter((x) => x.id !== it.id));
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  const clear = async () => {
    if (!(await notify.confirm({ message: '¿Limpiar las descargas realizadas de esta empresa? Se borran también sus archivos guardados.', title: 'Limpiar descargas', confirmLabel: 'Limpiar', danger: true }))) return;
    try {
      await spotService.clear(companyId);
      void notify.success('Descargas limpiadas');
      await loadHistory();
    } catch (e) {
      setHistoryError(e as SireApiError);
    }
  };

  if (!validId) return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <Link to="/tools/consulta-detracciones" title="Volver a la lista" aria-label="Volver a la lista" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary-700">
          <i className="fas fa-arrow-left text-xs" aria-hidden />
        </Link>
        <PageHeading>{company?.business_name || 'Consulta de Detracciones'}</PageHeading>
        <p className="text-sm font-medium text-slate-500">{company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}</p>
        <Link to={`/tools/consulta-detracciones/${companyId}/npd`} className="ml-auto text-xs font-medium text-primary-700 hover:underline">
          Ver los NPD generados →
        </Link>
      </div>

      {companyError ? <Alert variant="error">{companyError}</Alert> : null}
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
            <Card title="Consulta de Detracciones" subtitle="Elija los filtros de SUNAT; el sistema baja las constancias de depósito y arma el Excel.">
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">1. Empresa seleccionada</p>
                  <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
                    {company.ruc} - {company.business_name}
                  </div>
                </div>
                <div>
                  <label htmlFor="spot-cuenta" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    2. Tipo de cuenta
                  </label>
                  <select id="spot-cuenta" value={tipoCuenta} disabled={busy} onChange={(e) => changeCuenta(e.target.value as SpotTipoCuenta)} className={SELECT_CLS}>
                    {TIPOS_CUENTA.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="spot-pago" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    3. Tipo de pago
                  </label>
                  <select id="spot-pago" value={tipoPago} disabled={busy} onChange={(e) => changePago(e.target.value as SpotTipoPago)} className={SELECT_CLS}>
                    {TIPOS_PAGO.filter((t) => pagosParaCuenta(tipoCuenta).includes(t.value)).map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">4. Modalidad de consulta</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Modalidad de consulta">
                    <label className={radioCls(modo === 'fecha')}>
                      <input type="radio" name="spot-modo" checked={modo === 'fecha'} disabled={busy} onChange={() => setModo('fecha')} />
                      Por fecha de pago
                    </label>
                    <label className={`${radioCls(modo === 'periodo')} ${periodoDisponible ? '' : 'cursor-not-allowed opacity-50'}`} title={periodoDisponible ? undefined : 'Por periodo solo se consultan los pagos individuales'}>
                      <input type="radio" name="spot-modo" checked={modo === 'periodo'} disabled={busy || !periodoDisponible} onChange={() => setModo('periodo')} />
                      Por periodo
                    </label>
                  </div>
                  {modo === 'fecha' ? (
                    <div className="mt-2">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-slate-500">
                          Fecha inicio
                          <input type="date" value={desde} max={hasta || undefined} disabled={busy} onChange={(e) => setDesde(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full`} />
                        </label>
                        <label className="block text-xs text-slate-500">
                          Fecha fin
                          <input type="date" value={hasta} min={desde || undefined} max={daysAgo(0)} disabled={busy} onChange={(e) => setHasta(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full`} />
                        </label>
                      </div>
                      <p className="mt-1 text-2xs text-slate-400">SUNAT admite hasta {SPOT_MAX_DAYS} días por consulta.</p>
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="block text-xs text-slate-500">
                        Año
                        <select value={anio} disabled={busy} onChange={(e) => setAnio(Number(e.target.value))} className={`${SELECT_CLS} mt-0.5`}>
                          {anios.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-slate-500">
                        Mes
                        <select value={mes} disabled={busy} onChange={(e) => setMes(Number(e.target.value))} className={`${SELECT_CLS} mt-0.5`}>
                          {meses.map((m) => (
                            <option key={m} value={m}>
                              {String(m).padStart(2, '0')} - {MESES[m - 1]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
                <Button className="w-full" disabled={busy || !!filterMsg} onClick={() => void start()}>
                  <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-download'} mr-1.5`} aria-hidden />
                  Descargar Constancias
                </Button>
                {filterMsg ? <p className="text-xs text-amber-700">{filterMsg}</p> : null}
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium text-primary-700 hover:underline">¿Qué hace este proceso?</summary>
                  <p className="mt-1.5 leading-relaxed">
                    Entra a <strong>SUNAT</strong> con la clave SOL y abre <em>Pagos → Consulta de Pago de Detracciones</em> (la misma pantalla que usa SUNAT): lista los depósitos de la
                    cuenta de detracciones y baja la <strong>constancia de depósito</strong> de cada uno. Entrega un ZIP con el Excel del reporte y las constancias en HTML. Solo lee: no
                    envía ni cambia nada en SUNAT.
                  </p>
                </details>
              </div>
            </Card>
          </aside>

          <div className="min-w-0 space-y-4">
            <Alert variant="warning">
              <strong>Aviso sobre SUNAT:</strong> cuando muchas personas consultan a la vez (alta concurrencia), SUNAT puede demorar o rechazar la consulta. Si falla, espere unos minutos y vuelva a intentar.
            </Alert>
            <LongTaskPanel task={task} title="Descargando constancias de SUNAT" hint="La descarga corre en el servidor: puede seguir usando el sistema y volver luego. Queda guardada en «Descargas Realizadas»." />
            {error ? <SireErrorBox error={error} onRetry={() => void start()} /> : null}
            <Card
              title="Descargas Realizadas"
              subtitle="Quedan guardadas por empresa: ábralas sin volver a consultar a SUNAT."
              actions={
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{history.length}</span>
                  <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={history.filter((h) => h.status !== 'en_proceso').length === 0 || busy} onClick={() => void clear()}>
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
                <p className="py-8 text-center text-sm text-slate-500">Aún no hay descargas. Elija los filtros y pulse «Descargar Constancias»: aquí quedará el resultado.</p>
              ) : (
                <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-0.5">
                  {history.map((it) => (
                    <DownloadEntry key={it.id} item={it} company={company} busy={opening} onOpen={(x, excel) => void open(x, excel)} onRemove={(x) => void remove(x)} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DetraccionesCompany;
