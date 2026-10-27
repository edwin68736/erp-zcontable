import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import ActivityPeriodFilter from '../../components/activity/ActivityPeriodFilter';
import CompanyDigitoFilter from '../../components/finance/CompanyDigitoFilter';
import { RowActionLink } from '../../components/activity/RowActionLink';
import SuspendCompanyAction from '../../components/activity/SuspendCompanyAction';
import {
  PDF_REPORT_MODULES,
  PDF_REPORT_STATUS_FILTER,
  PDF_REPORT_TERMINAL_STATUSES,
  formatDateOnly,
  pdfReportDisplayStatus,
} from '../../components/activity/pdfReportConfig';
import { pdt601RowBgClass } from '../../components/activity/pdt601Config';
import { timelinessBadgeClass, timelinessLabel } from '../../components/activity/timelinessConfig';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activityModulePath, workspaceHomePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import { pdfReportService, type PdfReportListRow, type PdfReportSlug } from '../../services/pdfReports';
import {
  companyAccessCredentialsService,
  type CredentialFilterUserOption,
} from '../../services/companyAccessCredentials';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import { exportPdfReportExcel } from '../../utils/pdfReportExcelExport';

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type PdfReportListPageProps = {
  workspace: ActivityWorkspace;
  slug: PdfReportSlug;
};

const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 whitespace-nowrap';
const TD = 'px-4 py-3 text-sm text-slate-700 border-t border-slate-100';
const FIELD =
  'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500';
const COL_COUNT = 11;

/**
 * Listado de un módulo de informe en PDF (Informe detracciones / Siscont balances): empresas del
 * alcance del usuario con estado, fecha límite, fecha de cumplimiento y archivo cargado, filtros por
 * dígito/asistente/estado y reporte Excel. Compartido por el asistente (carga) y el supervisor
 * (revisión).
 */
const PdfReportListPage = ({ workspace, slug }: PdfReportListPageProps) => {
  const mod = PDF_REPORT_MODULES[slug];
  const homePath = workspaceHomePath(workspace);
  const [searchParams, setSearchParams] = useSearchParams();
  // Igual que PDT 601/621: se trabaja "pasando el mes" (en setiembre se controla lo de agosto).
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
  const [rows, setRows] = useState<PdfReportListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  useEffect(() => {
    void (async () => {
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
    })();
  }, []);

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

  const filters = useCallback(
    () => ({
      period_ym: periodYm,
      q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
      status: statusFilter || undefined,
      dig: filterDig ?? undefined,
      assistant_user_id: filterAssistantId ?? undefined,
    }),
    [periodYm, debouncedQ, statusFilter, filterDig, filterAssistantId],
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await pdfReportService.list(slug, { ...filters(), page, per_page: perPage });
      setRows(res.data ?? []);
      setTotal(res.pagination?.total ?? 0);
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, `No se pudo cargar ${mod.title}.`));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [slug, mod.title, filters, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [periodYm, debouncedQ, statusFilter, filterDig, filterAssistantId]);

  const detailLink = (companyId: number) =>
    `${activityModulePath(workspace, mod.moduleId)}/${companyId}?period_ym=${encodeURIComponent(periodYm)}`;

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    try {
      setExportingExcel(true);
      setError('');
      setMsg('');
      const exportRows = await pdfReportService.fetchExportData(slug, filters());
      await exportPdfReportExcel({ module: mod, periodYm, rows: exportRows, workspace });
      setMsg('Excel generado correctamente.');
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo exportar a Excel.'));
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{mod.title}</h1>
          <p className="text-slate-500 mt-1 text-sm">{mod.description}</p>
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
              className={FIELD}
            />
          </div>
          <div className="min-w-[10rem]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Asistente</label>
            <select
              value={filterAssistantId ?? ''}
              onChange={(e) => setFilterAssistantId(e.target.value ? Number(e.target.value) : null)}
              className={FIELD}
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
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={FIELD}>
              {PDF_REPORT_STATUS_FILTER.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 shrink-0 min-w-[9rem]">
            <p className="text-2xs font-semibold uppercase tracking-wide text-slate-500">Empresas</p>
            <p className="text-lg font-semibold text-slate-800 tabular-nums leading-tight">{loading ? '—' : total}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={loading || exportingExcel}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary-200 bg-primary-50 text-primary-800 text-sm font-medium hover:bg-primary-100 disabled:opacity-50 shrink-0"
          >
            <i className={`fas ${exportingExcel ? 'fa-spinner fa-spin' : 'fa-file-excel'} text-xs`} aria-hidden />
            Excel
          </button>
        </div>
      </div>

      {msg ? (
        <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg text-sm text-primary-800 flex items-center gap-2">
          <i className="fas fa-check-circle" aria-hidden />
          {msg}
        </div>
      ) : null}

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-clip">
        <div className="overflow-auto max-h-[75vh]">
          <table className="min-w-full w-full text-left">
            <thead>
              <tr className="bg-slate-50 sticky top-0 z-10">
                <th className={TH}>Código</th>
                <th className={TH}>Dígito</th>
                <th className={TH}>Razón social</th>
                <th className={TH}>RUC</th>
                <th className={TH}>Asistente</th>
                <th className={TH}>Estado</th>
                <th className={TH} />
                <th className={TH}>Fecha límite</th>
                <th className={TH}>Fecha de cumplimiento</th>
                <th className={TH}>Archivo</th>
                <th className={TH}>Observación</th>
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
                  const display = pdfReportDisplayStatus({
                    status: row.status,
                    suspendida: row.suspendida,
                    timeliness: row.timeliness,
                  });
                  const terminal = PDF_REPORT_TERMINAL_STATUSES.has(row.status);
                  return (
                    <tr key={row.company_id} className={pdt601RowBgClass(false, row.timeliness, row.suspendida)}>
                      <td className={`${TD} font-mono`}>{row.code || '—'}</td>
                      <td className={TD}>{row.dig || '—'}</td>
                      <td className={`${TD} font-medium`} title={row.business_name}>
                        <span className="block truncate max-w-xs">{row.business_name || '—'}</span>
                      </td>
                      <td className={`${TD} font-mono whitespace-nowrap`}>{row.ruc || '—'}</td>
                      <td className={TD} title={row.assistant_username}>
                        <span className="block truncate">{row.assistant_username || '—'}</span>
                      </td>
                      <td className={TD}>
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${display.className}`}
                          >
                            {display.label}
                          </span>
                          {/* "Entregado" ya incluye la puntualidad en el badge de arriba; suspendida
                              no tiene plazo que cumplir. */}
                          {!row.suspendida && row.status !== 'entregado' ? (
                            <span
                              title="Cumplimiento del plazo según el calendario de actividades"
                              className={`inline-block px-2 py-0.5 rounded-full text-2xs font-medium ${timelinessBadgeClass(row.timeliness)}`}
                            >
                              {timelinessLabel(row.timeliness)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={TD}>
                        {/* Igual que PDT 601: el asistente ya no edita una entrega aprobada — el check
                            verde NO es un link, solo la señal de "nada más que hacer". */}
                        {workspace === 'assistant' && terminal ? (
                          <span
                            title="Entregado — ya no se puede editar"
                            aria-label="Entregado — ya no se puede editar"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary-600 text-white shadow-sm cursor-default"
                          >
                            <i className="fas fa-check text-xs" aria-hidden />
                          </span>
                        ) : (
                          <RowActionLink
                            to={detailLink(row.company_id)}
                            icon={workspace === 'supervisor' ? 'fa-eye' : 'fa-pen'}
                            label={workspace === 'supervisor' ? 'Ver / revisar' : 'Cargar'}
                          />
                        )}
                        <SuspendCompanyAction
                          companyId={row.company_id}
                          companyName={row.business_name}
                          periodYm={periodYm}
                          suspendida={!!row.suspendida}
                          onChanged={() => void load()}
                        />
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{formatDateOnly(row.due_date)}</td>
                      <td className={`${TD} whitespace-nowrap`}>{row.suspendida ? '—' : formatDateOnly(row.fecha_entrega)}</td>
                      <td className={`${TD} max-w-[14rem]`} title={row.file_name || ''}>
                        <span className="block truncate">{row.file_name || '—'}</span>
                      </td>
                      <td className={`${TD} max-w-[16rem]`} title={row.observacion || ''}>
                        <span className="block truncate">{row.observacion || ''}</span>
                      </td>
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

export default PdfReportListPage;
