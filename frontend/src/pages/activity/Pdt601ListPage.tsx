import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import ActivityPeriodFilter from '../../components/activity/ActivityPeriodFilter';
import CompanyDigitoFilter from '../../components/finance/CompanyDigitoFilter';
import { RowActionLink } from '../../components/activity/RowActionLink';
import {
  pdt601StatusBadgeClass,
  pdt601StatusLabel,
  pdt601RowBgClass,
  PDT601_APPROVED_STATUSES,
  PDT601_STATUS_FILTER,
} from '../../components/activity/pdt601Config';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  activityModulePath,
  workspaceHomePath,
  type ActivityWorkspace,
} from '../../navigation/activityRoutes';
import { pdt601Service, type Pdt601ListRow } from '../../services/pdt601';
import {
  companyAccessCredentialsService,
  type CredentialFilterUserOption,
} from '../../services/companyAccessCredentials';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import { exportPdt601ReportExcel } from '../../utils/pdt601ExcelExport';
import { timelinessBadgeClass, timelinessLabel } from '../../components/activity/timelinessConfig';
import { useElementHeight } from '../../hooks/useElementHeight';
import { Z_HEAD_ROW, Z_HEAD_ROW1, frozenIdBodyCellStyle, frozenIdHeadCellStyle } from '../../components/activity/stickyTable';

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type Pdt601ListPageProps = {
  workspace: ActivityWorkspace;
};

const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 whitespace-nowrap';
const SUBTH = 'px-3 py-2 text-center text-[11px] font-semibold uppercase text-slate-500 whitespace-nowrap';
const TD = 'px-4 py-3 text-sm text-slate-700 border-t border-slate-100';
const TDN = `${TD} tabular-nums text-center whitespace-nowrap`;
const TDM = `${TD} tabular-nums text-right whitespace-nowrap`;
/** Separador vertical entre grupos de columnas (N° trabajadores / PDT 601). */
const GROUP_BORDER = 'border-l border-slate-200';
/** Total de columnas hoja (para el colSpan de filas vacías). */
const COL_COUNT = 25;

// ───────────────────── Encabezado y columnas fijas (sticky) ─────────────────────
// Encabezado: `position: sticky` respecto al contenedor con scroll vertical real (el propio
// panel de scroll de la tabla — ver comentario más abajo) — no requiere saber si el sidebar
// está colapsado, porque no usamos `position: fixed` con offsets manuales.
// Columnas Código→Asistente: `position: sticky` respecto al contenedor con scroll horizontal
// (el mismo panel) — por la misma razón, tampoco depende del ancho del sidebar: el offset es
// relativo al propio contenedor de scroll de la tabla.
// Anchos y helpers compartidos con las demás tablas de Supervisor/Asistente — ver
// components/activity/stickyTable.ts.

function formatMoney(n: number): string {
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Fondo de fila por estado (sin planilla / a tiempo / atrasado), OPACO siempre — para las
 * celdas fijas (Código…Asistente). A diferencia de `pdt601RowBgClass` (usada en el resto de la
 * fila), acá el hover NUNCA usa opacidad `/NN`: durante el scroll horizontal el contenido de las
 * columnas no fijas pasa por debajo de estas celdas, y cualquier transparencia dejaría verlo "a
 * través" (ver components/activity/stickyTable.ts). Mismos estados/colores que
 * `pdt601RowBgClass`, solo que con `group-hover` opaco en vez de `hover` translúcido.
 */
function frozenRowBgClass(sinPlanilla: boolean | undefined, timeliness: string | undefined): string {
  if (sinPlanilla) return 'bg-slate-100 group-hover:bg-slate-200';
  if (timeliness === 'on_time') return 'bg-emerald-50 group-hover:bg-emerald-100';
  if (timeliness === 'missing' || timeliness === 'late') return 'bg-red-50 group-hover:bg-red-100';
  return 'bg-white group-hover:bg-slate-50';
}

const Pdt601ListPage = ({ workspace }: Pdt601ListPageProps) => {
  const homePath = workspaceHomePath(workspace);
  const [searchParams, setSearchParams] = useSearchParams();
  // Por defecto, el mes calendario anterior: los controles PDT 601/621 se trabajan "pasando el
  // mes" (en setiembre se controla lo de agosto).
  const initialPeriod = searchParams.get('period_ym') || previousMonthPeriodYM();

  const [periodYm, setPeriodYm] = useState(initialPeriod);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [statusFilter, setStatusFilter] = useState('');
  const [filterDig, setFilterDig] = useState<string | null>(null);
  const [filterAssistantId, setFilterAssistantId] = useState<number | null>(null);
  const [assistants, setAssistants] = useState<CredentialFilterUserOption[]>([]);
  const [digColorsJson, setDigColorsJson] = useState<string | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [rows, setRows] = useState<Pdt601ListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  // Altura real de la 1ª fila del encabezado — medida sobre la celda "N° de trabajadores"
  // (colSpan, NO rowSpan): es la única celda de la fila 1 que pertenece SOLO a esa fila, así que
  // su alto natural coincide exactamente con el alto real de la fila 1. Las demás celdas de la
  // fila 1 (Código, Dígito, RUC, Estado, ...) son `rowSpan={2}` — su alto abarca fila 1 + fila 2
  // combinadas, así que medirlas daría un alto MAYOR al de la fila 1 sola, dejando un hueco en
  // blanco debajo de "N° de trabajadores"/"PDT 601" antes de que empiece la 2ª fila. La 2ª fila
  // (subtítulos ONP/AFP/...) usa este valor como su `top` para apilarse justo debajo, sin hueco
  // ni superposición, cuando ambas quedan fijas.
  const [headRow1Ref, headRow1H] = useElementHeight<HTMLTableCellElement>();

  const loadFacets = useCallback(async () => {
    try {
      setFacetsLoading(true);
      const data = await companyAccessCredentialsService.filterFacets();
      setDigColorsJson(data.claves_sol_dig_colors_json ?? null);
      setAssistants(data.assistants ?? []);
    } catch {
      setDigColorsJson(null);
      setAssistants([]);
    } finally {
      setFacetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('period_ym', periodYm);
        return next;
      },
      { replace: true },
    );
  }, [periodYm, setSearchParams]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await pdt601Service.list({
        period_ym: periodYm,
        q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
        status: statusFilter || undefined,
        dig: filterDig ?? undefined,
        assistant_user_id: filterAssistantId ?? undefined,
        page,
        per_page: perPage,
      });
      setRows(res.data ?? []);
      setTotal(res.pagination?.total ?? 0);
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar Control Planillas PDT 601.'));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [periodYm, debouncedQ, statusFilter, filterDig, filterAssistantId, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [periodYm, debouncedQ, statusFilter, filterDig, filterAssistantId]);

  const detailLink = (companyId: number) => {
    const path = `${activityModulePath(workspace, 'pdt-601')}/${companyId}`;
    return `${path}?period_ym=${encodeURIComponent(periodYm)}`;
  };

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    try {
      setExportingExcel(true);
      setError('');
      setMsg('');
      const exportRows = await pdt601Service.fetchExportData({
        period_ym: periodYm,
        q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
        status: statusFilter || undefined,
        dig: filterDig ?? undefined,
        assistant_user_id: filterAssistantId ?? undefined,
      });
      await exportPdt601ReportExcel({ periodYm, rows: exportRows });
      setMsg('Excel generado correctamente.');
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo exportar a Excel.'));
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Control Planillas PDT 601</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Seguimiento manual de planillas PDT 601 por empresa y período. Sin integración con SUNAT.
          </p>
        </div>
        <Link to={homePath} className="text-primary-700 text-sm font-medium hover:underline shrink-0 whitespace-nowrap">
          ← Volver
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm space-y-3">
        <CompanyDigitoFilter
          filterDig={filterDig}
          onFilterDigChange={setFilterDig}
          digColorsJson={digColorsJson}
          loading={facetsLoading}
        />
        <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-slate-100">
        <ActivityPeriodFilter value={periodYm} onChange={setPeriodYm} />
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Buscar</label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="RUC o razón social (mín. 2 caracteres)…"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="min-w-[10rem]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Asistente</label>
          <select
            value={filterAssistantId ?? ''}
            onChange={(e) => setFilterAssistantId(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">Todos</option>
            {assistants.map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.username}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[10rem]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          >
            {PDT601_STATUS_FILTER.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 shrink-0 min-w-[9rem]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Empresas</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums leading-tight">{loading ? '—' : total}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleExportExcel()}
          disabled={loading || exportingExcel}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50 shrink-0"
        >
          <i className={`fas ${exportingExcel ? 'fa-spinner fa-spin' : 'fa-file-excel'} text-xs`} aria-hidden />
          Excel
        </button>
        </div>
      </div>

      {msg ? (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center gap-2">
          <i className="fas fa-check-circle" aria-hidden />
          {msg}
        </div>
      ) : null}

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}

      {/*
        La tabla es su PROPIO panel de scroll (alto MÁXIMO acotado + overflow-auto), en vez de
        dejar que <main> (la página completa) haga el scroll vertical de la tabla en sí. Es
        necesario por una regla real de CSS: en cuanto un contenedor tiene `overflow-x: auto`
        (indispensable aquí para poder desplazar las 24 columnas), el navegador fuerza también su
        `overflow-y` a comportarse como `auto` — aunque no se haya pedido — y ESE contenedor pasa
        a ser el ancestro de scroll que usa `position: sticky`, no <main>.
        El alto es un MÁXIMO (`max-h-[75vh]`, no un alto fijo): si hay pocas filas, la tabla se
        ajusta a su contenido real (sin espacio en blanco forzado ni scroll innecesario); si hay
        más filas de las que caben, recién ahí se activa el scroll propio al llegar a ese tope.
        Se usa un porcentaje del viewport (no medido con JS) porque es más robusto entre
        navegadores/zoom reales — una medición exacta en píxeles resultó desincronizada en
        algunos entornos.
        La página en sí sigue siendo scroll normal de <main> — la paginación queda después de la
        tabla, dentro de ese scroll, no fija a la vista.
      */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-clip">
        <div className="overflow-auto max-h-[75vh]">
          <table className="min-w-full w-full text-left">
            <thead>
              <tr className="bg-slate-50" style={{ position: 'sticky', top: 0, zIndex: Z_HEAD_ROW1 }}>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenIdHeadCellStyle('code')}>Código</th>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenIdHeadCellStyle('dig')}>Dígito</th>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenIdHeadCellStyle('name')}>Razón social</th>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenIdHeadCellStyle('ruc')}>RUC</th>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenIdHeadCellStyle('assistant')}>Asistente</th>
                <th className={TH} rowSpan={2}>Estado</th>
                <th className={TH} rowSpan={2} />
                <th ref={headRow1Ref} className={`${TH} text-center ${GROUP_BORDER}`} colSpan={3}>
                  N° de trabajadores
                </th>
                <th className={`${TH} text-center ${GROUP_BORDER}`} colSpan={8}>
                  PDT 601
                </th>
                <th className={`${TH} ${GROUP_BORDER}`} rowSpan={2}>Fecha de entrega</th>
                <th className={TH} rowSpan={2}>Observaciones</th>
                <th className={TH} rowSpan={2}>Fecha de declaración PDT</th>
                <th className={TH} rowSpan={2}>NPS</th>
                <th className={TH} rowSpan={2}>Ticket AFP</th>
                <th className={TH} rowSpan={2}>Estado de envío boletas de trabajadores</th>
                <th className={TH} rowSpan={2}>Fecha de envío de NPS, tickets y boletas</th>
              </tr>
              <tr className="bg-slate-50" style={{ position: 'sticky', top: headRow1H, zIndex: Z_HEAD_ROW }}>
                <th className={`${SUBTH} ${GROUP_BORDER}`}>ONP</th>
                <th className={SUBTH}>AFP</th>
                <th className={SUBTH}>Total</th>
                <th className={`${SUBTH} ${GROUP_BORDER}`}>ESSALUD</th>
                <th className={SUBTH}>ONP</th>
                <th className={SUBTH}>AFP</th>
                <th className={SUBTH}>SIS</th>
                <th className={SUBTH}>4TA</th>
                <th className={SUBTH}>5TA</th>
                <th className={SUBTH}>SCTR</th>
                <th className={SUBTH}>RH</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={COL_COUNT} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COL_COUNT} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const pl = row.planilla;
                  return (
                    <tr key={row.company_id} className={`group ${pdt601RowBgClass(pl?.sin_planilla, row.timeliness)}`}>
                      <td
                        className={`${TD} font-mono ${frozenRowBgClass(pl?.sin_planilla, row.timeliness)}`}
                        style={frozenIdBodyCellStyle('code')}
                      >
                        {row.code || '—'}
                      </td>
                      <td
                        className={`${TD} ${frozenRowBgClass(pl?.sin_planilla, row.timeliness)}`}
                        style={frozenIdBodyCellStyle('dig')}
                      >
                        {row.dig || '—'}
                      </td>
                      <td
                        className={`${TD} font-medium ${frozenRowBgClass(pl?.sin_planilla, row.timeliness)}`}
                        style={frozenIdBodyCellStyle('name')}
                        title={row.business_name}
                      >
                        <span className="block truncate">{row.business_name || '—'}</span>
                      </td>
                      <td
                        className={`${TD} font-mono whitespace-nowrap ${frozenRowBgClass(pl?.sin_planilla, row.timeliness)}`}
                        style={frozenIdBodyCellStyle('ruc')}
                      >
                        {row.ruc || '—'}
                      </td>
                      <td
                        className={`${TD} ${frozenRowBgClass(pl?.sin_planilla, row.timeliness)}`}
                        style={frozenIdBodyCellStyle('assistant')}
                        title={row.assistant_username}
                      >
                        <span className="block truncate">{row.assistant_username || '—'}</span>
                      </td>
                      <td className={TD}>
                        <div className="flex flex-col items-start gap-1">
                          {/* Igual que en el detalle (combinedStatusValue): "sin_planilla" no es un
                              estado real de la declaración, pero se muestra acá en vez del estado
                              de revisión para no decir "Pendiente" en una empresa sin planilla. */}
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pdt601StatusBadgeClass(pl?.sin_planilla ? 'sin_planilla' : row.status)}`}
                          >
                            {pdt601StatusLabel(pl?.sin_planilla ? 'sin_planilla' : row.status)}
                          </span>
                          {/* Cumplimiento del plazo del calendario de actividades (tipo "pdt_601")
                              para la entrega del asistente (fecha_entrega) — antes solo coloreaba
                              el fondo de la fila (pdt601RowBgClass), sin texto explícito acá.
                              Sin planilla no tiene plazo de entrega que cumplir: se omite. */}
                          {!pl?.sin_planilla ? (
                            <span
                              title="Cumplimiento del plazo de entrega según el calendario de actividades"
                              className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${timelinessBadgeClass(row.timeliness)}`}
                            >
                              {timelinessLabel(row.timeliness)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={TD}>
                        {/* El asistente ya no puede editar (ni entrar al detalle) una vez que el
                            supervisor aprobó — a diferencia del resto de las tablas, acá el check
                            verde NO es un link: es solo la señal de "ya no hay nada que hacer". */}
                        {workspace === 'assistant' && PDT601_APPROVED_STATUSES.has(row.status) ? (
                          <span
                            title={`${pdt601StatusLabel(row.status)} — ya no se puede editar`}
                            aria-label={`${pdt601StatusLabel(row.status)} — ya no se puede editar`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600 text-white shadow-sm cursor-default"
                          >
                            <i className="fas fa-check text-xs" aria-hidden />
                          </span>
                        ) : (
                          <RowActionLink to={detailLink(row.company_id)} icon="fa-pen" label="Editar planilla" />
                        )}
                      </td>
                      {pl?.sin_planilla ? (
                        // "Sin planilla" ya se indica en la columna Estado — acá solo se dejan
                        // en blanco los campos numéricos (no aplica), sin repetir la etiqueta.
                        <td colSpan={11} className={`${TD} ${GROUP_BORDER}`} />
                      ) : (
                        <>
                          <td className={`${TDN} ${GROUP_BORDER}`}>{pl ? pl.trabajadores_onp : ''}</td>
                          <td className={TDN}>{pl ? pl.trabajadores_afp : ''}</td>
                          <td className={`${TDN} font-semibold`}>{pl ? pl.trabajadores_total : ''}</td>
                          <td className={`${TDM} ${GROUP_BORDER}`}>{pl ? formatMoney(pl.essalud) : ''}</td>
                          <td className={TDM}>{pl ? formatMoney(pl.onp) : ''}</td>
                          <td className={TDM}>{pl ? formatMoney(pl.afp) : ''}</td>
                          <td className={TDM}>{pl ? formatMoney(pl.sis) : ''}</td>
                          <td className={TDM}>{pl ? formatMoney(pl.rta_4ta) : ''}</td>
                          <td className={TDM}>{pl ? formatMoney(pl.rta_5ta) : ''}</td>
                          <td className={TDM}>{pl ? formatMoney(pl.sctr) : ''}</td>
                          <td className={TDM}>{pl ? formatMoney(pl.rh) : ''}</td>
                        </>
                      )}
                      <td className={`${TD} whitespace-nowrap ${GROUP_BORDER}`}>{pl?.fecha_entrega || ''}</td>
                      <td className={`${TD} max-w-[12rem]`} title={pl?.observaciones || ''}>
                        <span className="block truncate">{pl?.observaciones || ''}</span>
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{pl?.fecha_declaracion_pdt || ''}</td>
                      <td className={`${TD} whitespace-nowrap`}>{pl?.nps || ''}</td>
                      <td className={`${TD} whitespace-nowrap`}>{pl?.ticket_afp || ''}</td>
                      <td className={`${TD} whitespace-nowrap`}>{pl?.estado_envio_boletas || ''}</td>
                      <td className={`${TD} whitespace-nowrap`}>{pl?.fecha_envio_nps_tickets_boletas || ''}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(next) => {
          setPerPage(next);
          setPage(1);
        }}
      />
    </div>
  );
};

export default Pdt601ListPage;
