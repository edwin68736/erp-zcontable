import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import ActivityPeriodFilter from '../../components/activity/ActivityPeriodFilter';
import DetraccionesRowActions from '../../components/activity/DetraccionesRowActions';
import {
  formatStoredAt,
  DETRACCIONES_STATUS_FILTER,
} from '../../components/activity/detraccionesConfig';
import {
  timelinessBadgeClass,
  timelinessLabel,
  timelinessRowBorderClass,
} from '../../components/activity/timelinessConfig';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  activityModulePath,
  workspaceHomePath,
  type ActivityWorkspace,
} from '../../navigation/activityRoutes';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { detraccionesService, type DetraccionesListRow } from '../../services/detracciones';
import { currentPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type DetraccionesListPageProps = {
  workspace: ActivityWorkspace;
};

const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500';
const TD = 'px-4 py-3 text-sm text-slate-700 border-t border-slate-100';

const DetraccionesListPage = ({ workspace }: DetraccionesListPageProps) => {
  const homePath = workspaceHomePath(workspace);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPeriod = searchParams.get('period_ym') || currentPeriodYM();

  const canUpload = useMemo(
    () => workspace === 'assistant' && auth.hasPermission(P.supervisorsAttachmentsUpload),
    [workspace],
  );
  const canVerify = useMemo(
    () => workspace === 'supervisor' && auth.hasPermission(P.supervisorsDeclarationsApprove),
    [workspace],
  );
  const canSetStatus = canVerify;

  const [periodYm, setPeriodYm] = useState(initialPeriod);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [rows, setRows] = useState<DetraccionesListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

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
      const res = await detraccionesService.list({
        period_ym: periodYm,
        q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
        status: statusFilter || undefined,
        page,
        per_page: perPage,
      });
      setRows(res.data ?? []);
      setTotal(res.pagination?.total ?? 0);
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar Control de Detracciones.'));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [periodYm, debouncedQ, statusFilter, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [periodYm, debouncedQ, statusFilter]);

  const detailLink = (companyId: number) => {
    const path = `${activityModulePath(workspace, 'detracciones')}/${companyId}`;
    return `${path}?period_ym=${encodeURIComponent(periodYm)}`;
  };

  const handleUpload = async (companyId: number, file: File) => {
    setActionError('');
    try {
      await detraccionesService.uploadPdf(companyId, periodYm, file);
    } catch (err) {
      setActionError(extractApiErrorMessage(err, 'No se pudo subir el PDF.'));
      throw err;
    }
  };

  const handleVerify = async (declarationId: number) => {
    setActionError('');
    try {
      await detraccionesService.verify(declarationId);
    } catch (err) {
      setActionError(extractApiErrorMessage(err, 'No se pudo verificar.'));
      throw err;
    }
  };

  const handleSetStatus = async (
    companyId: number,
    declarationId: number | undefined,
    status: 'sin_clave' | 'no_corresponde',
  ) => {
    setActionError('');
    try {
      let id = declarationId;
      if (!id) {
        const detail = await detraccionesService.getDetail(companyId, periodYm);
        id = detail.declaration.id;
      }
      await detraccionesService.setSupervisorStatus(id, status);
    } catch (err) {
      setActionError(extractApiErrorMessage(err, 'No se pudo cambiar el estado.'));
      throw err;
    }
  };

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Control de Detracciones SUNAT</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Carga de comprobante PDF por el asistente y verificación por el supervisor.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
        <ActivityPeriodFilter value={periodYm} onChange={setPeriodYm} />
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Buscar</label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="RUC, razón social o código (mín. 2 caracteres)…"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="min-w-[10rem]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          >
            {DETRACCIONES_STATUS_FILTER.map((opt) => (
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
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}
      {actionError ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm">{actionError}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full w-full text-left">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Código</th>
                <th className={TH}>Dígito</th>
                <th className={TH}>Razón social</th>
                <th className={TH}>RUC</th>
                <th className={TH}>Asistente</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Cumplimiento</th>
                <th className={TH}>Fecha almacenamiento</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.company_id}
                    className={`hover:bg-slate-50/80 border-l-4 ${timelinessRowBorderClass(row.timeliness?.timeliness)}`}
                  >
                    <td className={`${TD} font-mono`}>{row.code || '—'}</td>
                    <td className={TD}>{row.dig || '—'}</td>
                    <td className={`${TD} max-w-[14rem] font-medium`} title={row.business_name}>
                      <span className="block truncate">{row.business_name || '—'}</span>
                    </td>
                    <td className={`${TD} font-mono whitespace-nowrap`}>{row.ruc || '—'}</td>
                    <td className={TD}>{row.assistant_username || '—'}</td>
                    <td className={TD}>
                      <DetraccionesRowActions
                        row={row}
                        periodYm={periodYm}
                        workspace={workspace}
                        canUpload={canUpload}
                        canVerify={canVerify}
                        canSetStatus={canSetStatus}
                        onUpdated={() => void load()}
                        onUpload={handleUpload}
                        onVerify={handleVerify}
                        onSetStatus={handleSetStatus}
                      />
                    </td>
                    <td className={TD}>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${timelinessBadgeClass(row.timeliness?.timeliness)}`}
                        title={
                          row.timeliness?.due_at
                            ? `Plazo: ${new Date(row.timeliness.due_at).toLocaleString('es-PE')}`
                            : undefined
                        }
                      >
                        {timelinessLabel(row.timeliness?.timeliness)}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-slate-600`}>{formatStoredAt(row.last_stored_at)}</td>
                    <td className={TD}>
                      <Link
                        to={detailLink(row.company_id)}
                        className="text-primary-700 text-sm font-medium hover:underline"
                      >
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))
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

      <p className="text-xs text-slate-400">
        <Link to={homePath} className="text-primary-700 hover:underline">
          ← Volver
        </Link>
      </p>
    </div>
  );
};

export default DetraccionesListPage;
