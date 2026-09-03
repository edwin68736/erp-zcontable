import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import ActivityPeriodFilter from '../../components/activity/ActivityPeriodFilter';
import CompanyDigitoFilter from '../../components/finance/CompanyDigitoFilter';
import { RowActionLink } from '../../components/activity/RowActionLink';
import {
  pdt621StatusBadgeClass,
  pdt621StatusLabel,
  pdt621RowBgClass,
  PDT621_STATUS_FILTER,
} from '../../components/activity/pdt621Config';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  activityModulePath,
  workspaceHomePath,
  type ActivityWorkspace,
} from '../../navigation/activityRoutes';
import { pdt621Service, type Pdt621ListRow } from '../../services/pdt621';
import {
  companyAccessCredentialsService,
  type CredentialFilterUserOption,
} from '../../services/companyAccessCredentials';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import { exportPdt621ReportExcel } from '../../utils/pdt621ExcelExport';
import { timelinessBadgeClass, timelinessLabel } from '../../components/activity/timelinessConfig';
import { useElementHeight } from '../../hooks/useElementHeight';
import {
  Z_HEAD_ROW,
  Z_HEAD_ROW1,
  buildFrozenLefts,
  frozenBodyCellStyle,
  frozenHeadCellStyle,
} from '../../components/activity/stickyTable';

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type Pdt621ListPageProps = {
  workspace: ActivityWorkspace;
};

const TH = 'px-3 py-3 text-left text-xs font-semibold uppercase text-slate-500 whitespace-nowrap';
const SUBTH = 'px-2 py-2 text-center text-[11px] font-semibold uppercase text-slate-500 whitespace-nowrap';
const TD = 'px-3 py-2.5 text-sm text-slate-700 border-t border-slate-100';
const TDN = `${TD} tabular-nums text-center whitespace-nowrap`;
const TDM = `${TD} tabular-nums text-right whitespace-nowrap`;
/** Separador vertical entre grupos de columnas. */
const GROUP_BORDER = 'border-l border-slate-200';
/** Total de columnas hoja (para el colSpan de filas vacías/estado de carga). */
const COL_COUNT = 22;

function formatMoney(n: number): string {
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateCell(value?: string | null): string {
  if (!value) return '';
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-PE', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const SIRE_LABEL: Record<string, string> = { si: 'Sí', no: 'No' };

const TAX_REGIME_LABEL: Record<string, string> = {
  mype: 'MYPE',
  rer: 'RER',
  general: 'General',
};

// ───────────────────── Columnas fijas (sticky) ─────────────────────
// Esta tabla congela sus primeras 4 columnas (N°, Código, Razón social, RUC) — el orden real de
// columnas de ESTA tabla difiere del resto (Dígito/Reg. trib. van después, no junto a Código), así
// que usa su propio mapa de anchos en vez del preset compartido `FROZEN_ID_*` de las demás tablas
// (pensado para code→dig→name→ruc→assistant contiguos). Ver components/activity/stickyTable.ts
// para el resto del patrón (por qué el panel de scroll es `overflow-auto` acotado, por qué el
// fondo de las celdas fijas debe ser siempre opaco, etc.) y Pdt601ListPage.tsx para el caso con
// encabezado de 2 filas (Z_HEAD_ROW1) igual que esta tabla.
const FROZEN_COL_W = { num: 56, code: 84, name: 208, ruc: 124 } as const;
const FROZEN_LEFT = buildFrozenLefts(FROZEN_COL_W);
function frozenHeadStyle(col: keyof typeof FROZEN_COL_W) {
  return frozenHeadCellStyle(FROZEN_LEFT[col], FROZEN_COL_W[col]);
}
function frozenBodyStyle(col: keyof typeof FROZEN_COL_W) {
  return frozenBodyCellStyle(FROZEN_LEFT[col], FROZEN_COL_W[col]);
}

/**
 * Fondo de fila por cumplimiento, OPACO siempre — para las celdas fijas (N°, Código, Razón
 * social, RUC). A diferencia de `pdt621RowBgClass` (usada en el resto de la fila), acá el hover
 * nunca usa opacidad `/NN`: durante el scroll horizontal el contenido de las columnas no fijas
 * pasa por debajo de estas celdas (ver components/activity/stickyTable.ts).
 */
function frozenRowBgClass(timeliness: string | undefined): string {
  if (timeliness === 'on_time') return 'bg-emerald-50 group-hover:bg-emerald-100';
  if (timeliness === 'missing' || timeliness === 'late') return 'bg-red-50 group-hover:bg-red-100';
  return 'bg-white group-hover:bg-slate-50';
}

const Pdt621ListPage = ({ workspace }: Pdt621ListPageProps) => {
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
  const [rows, setRows] = useState<Pdt621ListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  // Altura real de la 1ª fila del encabezado — medida sobre la celda "1ra entrega" (colSpan, NO
  // rowSpan): es la única celda de la fila 1 que pertenece SOLO a esa fila. Ver el mismo patrón,
  // explicado con más detalle, en Pdt601ListPage.tsx.
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
      const res = await pdt621Service.list({
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
      setError(extractApiErrorMessage(err, 'No se pudo cargar Control Vencimientos PDT 621.'));
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
    const path = `${activityModulePath(workspace, 'pdt-621')}/${companyId}`;
    return `${path}?period_ym=${encodeURIComponent(periodYm)}`;
  };

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    try {
      setExportingExcel(true);
      setError('');
      setMsg('');
      const exportRows = await pdt621Service.fetchExportData({
        period_ym: periodYm,
        q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
        status: statusFilter || undefined,
        dig: filterDig ?? undefined,
        assistant_user_id: filterAssistantId ?? undefined,
      });
      await exportPdt621ReportExcel({ periodYm, rows: exportRows });
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
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Control Vencimientos PDT 621</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Seguimiento manual de vencimientos PDT 621 por empresa y período. Sin integración con SUNAT.
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
            {PDT621_STATUS_FILTER.map((opt) => (
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
        La tabla es su PROPIO panel de scroll, en vez de dejar que <main> (la página completa)
        haga el scroll vertical. En cuanto un contenedor tiene `overflow-x: auto`, el navegador
        fuerza también su `overflow-y` a comportarse como `auto` — aunque no se haya pedido — y
        ESE contenedor pasa a ser el ancestro de scroll que usa `position: sticky`, no <main>.
        Ver Pdt601ListPage.tsx para más detalle (incluye el mismo caso de encabezado de 2 filas).
      */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-clip">
        <div className="overflow-auto max-h-[75vh]">
          <table className="min-w-full w-full text-left">
            <thead>
              <tr className="bg-slate-50" style={{ position: 'sticky', top: 0, zIndex: Z_HEAD_ROW1 }}>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenHeadStyle('num')}>N°</th>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenHeadStyle('code')}>Código</th>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenHeadStyle('name')}>Razón social</th>
                <th className={`${TH} bg-slate-50`} rowSpan={2} style={frozenHeadStyle('ruc')}>RUC</th>
                <th className={TH} rowSpan={2}>Dígito</th>
                <th className={TH} rowSpan={2}>Reg. trib.</th>
                <th className={TH} rowSpan={2}>Asistente</th>
                <th className={TH} rowSpan={2}>Estado</th>
                <th ref={headRow1Ref} className={`${TH} text-center ${GROUP_BORDER}`} colSpan={2}>
                  1ra entrega
                </th>
                <th className={TH} rowSpan={2}>Observación</th>
                <th className={`${TH} text-center ${GROUP_BORDER}`} colSpan={2}>
                  2da entrega
                </th>
                <th className={`${TH} ${GROUP_BORDER}`} rowSpan={2}>Fecha declaración</th>
                <th className={`${TH} text-center ${GROUP_BORDER}`} colSpan={4}>
                  Importes declarados PDT 621
                </th>
                <th className={`${TH} text-center ${GROUP_BORDER}`} colSpan={3}>
                  SIRE
                </th>
                <th className={`${TH} ${GROUP_BORDER}`} rowSpan={2}>Archivos</th>
              </tr>
              <tr className="bg-slate-50" style={{ position: 'sticky', top: headRow1H, zIndex: Z_HEAD_ROW }}>
                <th className={`${SUBTH} ${GROUP_BORDER}`}>Fecha</th>
                <th className={SUBTH}>Hora</th>
                <th className={`${SUBTH} ${GROUP_BORDER}`}>Fecha</th>
                <th className={SUBTH}>Hora</th>
                <th className={`${SUBTH} ${GROUP_BORDER}`}>Ventas</th>
                <th className={SUBTH}>Compras</th>
                <th className={SUBTH}>IGV</th>
                <th className={SUBTH}>Renta</th>
                <th className={`${SUBTH} ${GROUP_BORDER}`}>¿Enviado?</th>
                <th className={SUBTH}>F. envío</th>
                <th className={SUBTH}>Motivo</th>
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
                rows.map((row, idx) => {
                  const rec = row.record;
                  return (
                    <tr key={row.company_id} className={`group ${pdt621RowBgClass(row.declaration_timeliness)}`}>
                      <td
                        className={`${TD} tabular-nums text-center text-slate-400 ${frozenRowBgClass(row.declaration_timeliness)}`}
                        style={frozenBodyStyle('num')}
                      >
                        {(page - 1) * perPage + idx + 1}
                      </td>
                      <td
                        className={`${TD} font-mono ${frozenRowBgClass(row.declaration_timeliness)}`}
                        style={frozenBodyStyle('code')}
                      >
                        {row.code || '—'}
                      </td>
                      <td
                        className={`${TD} font-medium ${frozenRowBgClass(row.declaration_timeliness)}`}
                        style={frozenBodyStyle('name')}
                        title={row.business_name}
                      >
                        <span className="block truncate">{row.business_name || '—'}</span>
                      </td>
                      <td
                        className={`${TD} font-mono whitespace-nowrap ${frozenRowBgClass(row.declaration_timeliness)}`}
                        style={frozenBodyStyle('ruc')}
                      >
                        {row.ruc || '—'}
                      </td>
                      <td className={TD}>{row.dig || '—'}</td>
                      <td className={TD}>{TAX_REGIME_LABEL[row.tax_regime] ?? row.tax_regime ?? '—'}</td>
                      <td className={TD}>{row.assistant_username || '—'}</td>
                      <td className={TD}>
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pdt621StatusBadgeClass(row.status)}`}
                            >
                              {pdt621StatusLabel(row.status)}
                            </span>
                            {/* Botón de acción (registrar/ver) movido acá desde la última columna,
                                junto al estado en vez de al fondo de la fila. */}
                            <RowActionLink to={detailLink(row.company_id)} icon="fa-pen" label="Editar registro" />
                          </div>
                          {/* Plazo INTERNO del estudio (calendario de actividades) para la 1ra
                              entrega del asistente — no valida nada contra SUNAT, ver
                              pdt621Config.ts / supervisor_pdt621_service.go (AssistantTimeliness). */}
                          <span
                            title="Cumplimiento del plazo interno de entrega del asistente (calendario de actividades)"
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${timelinessBadgeClass(row.assistant_timeliness)}`}
                          >
                            {timelinessLabel(row.assistant_timeliness)}
                          </span>
                        </div>
                      </td>
                      <td className={`${TDN} ${GROUP_BORDER}`}>{formatDateCell(rec?.primera_entrega_fecha)}</td>
                      <td className={TDN}>{rec?.primera_entrega_hora || ''}</td>
                      <td className={`${TD} max-w-[12rem]`} title={rec?.observacion || ''}>
                        <span className="block truncate">{rec?.observacion || ''}</span>
                      </td>
                      <td className={`${TDN} ${GROUP_BORDER}`}>{formatDateCell(rec?.segunda_entrega_fecha)}</td>
                      <td className={TDN}>{rec?.segunda_entrega_hora || ''}</td>
                      <td className={`${TD} ${GROUP_BORDER} whitespace-nowrap font-medium`}>
                        {formatDateCell(rec?.fecha_declaracion)}
                      </td>
                      <td className={`${TDM} ${GROUP_BORDER}`}>
                        {rec?.total_ventas ? formatMoney(rec.total_ventas) : ''}
                      </td>
                      <td className={TDM}>{rec?.total_compras ? formatMoney(rec.total_compras) : ''}</td>
                      <td className={TDM}>{rec?.igv ? formatMoney(rec.igv) : ''}</td>
                      <td className={TDM}>{rec?.rta ? formatMoney(rec.rta) : ''}</td>
                      <td className={`${TDN} ${GROUP_BORDER}`}>
                        {rec?.envio_sire ? SIRE_LABEL[rec.envio_sire] ?? rec.envio_sire : ''}
                      </td>
                      <td className={TDN}>{formatDateCell(rec?.fecha_envio_sire)}</td>
                      <td className={`${TD} max-w-[10rem]`} title={rec?.motivo_no_envio || ''}>
                        <span className="block truncate">{rec?.motivo_no_envio || ''}</span>
                      </td>
                      <td className={`${TDN} ${GROUP_BORDER}`}>{row.attachment_count}</td>
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

export default Pdt621ListPage;
