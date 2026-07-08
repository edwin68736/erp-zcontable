import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import ActivityPeriodFilter from '../../components/activity/ActivityPeriodFilter';
import {
  formatStoredAt,
  formatPdt601DueDateCell,
  pdt601StatusBadgeClass,
  pdt601StatusLabel,
  PDT601_STATUS_FILTER,
} from '../../components/activity/pdt601Config';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  activityModulePath,
  workspaceHomePath,
  type ActivityWorkspace,
} from '../../navigation/activityRoutes';
import { pdt601Service, type Pdt601ListRow } from '../../services/pdt601';
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

type Pdt601ListPageProps = {
  workspace: ActivityWorkspace;
};

const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500';
const TD = 'px-4 py-3 text-sm text-slate-700 border-t border-slate-100';

const Pdt601ListPage = ({ workspace }: Pdt601ListPageProps) => {
  const homePath = workspaceHomePath(workspace);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPeriod = searchParams.get('period_ym') || currentPeriodYM();

  const [periodYm, setPeriodYm] = useState(initialPeriod);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [rows, setRows] = useState<Pdt601ListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
  }, [periodYm, debouncedQ, statusFilter, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [periodYm, debouncedQ, statusFilter]);

  const detailLink = (companyId: number) => {
    const path = `${activityModulePath(workspace, 'pdt-601')}/${companyId}`;
    return `${path}?period_ym=${encodeURIComponent(periodYm)}`;
  };

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Control Planillas PDT 601</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Seguimiento manual de planillas PDT 601 por empresa y período. Sin integración con SUNAT.
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
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
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
                <th className={TH}>Fecha vencimiento</th>
                <th className={TH}>Cantidad archivos</th>
                <th className={TH}>Fecha almacenamiento</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.company_id} className="hover:bg-slate-50/80">
                    <td className={`${TD} font-mono`}>{row.code || '—'}</td>
                    <td className={TD}>{row.dig || '—'}</td>
                    <td className={`${TD} max-w-[14rem] font-medium`} title={row.business_name}>
                      <span className="block truncate">{row.business_name || '—'}</span>
                    </td>
                    <td className={`${TD} font-mono whitespace-nowrap`}>{row.ruc || '—'}</td>
                    <td className={TD}>{row.assistant_username || '—'}</td>
                    <td className={TD}>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pdt601StatusBadgeClass(row.status)}`}
                      >
                        {pdt601StatusLabel(row.status)}
                      </span>
                    </td>
                    <td
                      className={`${TD} whitespace-nowrap ${row.is_overdue ? 'text-red-700 font-medium' : 'text-slate-600'}`}
                    >
                      {formatPdt601DueDateCell(row.due_date, row.is_overdue, row.days_remaining)}
                    </td>
                    <td className={`${TD} tabular-nums text-center`}>{row.attachment_count}</td>
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

export default Pdt601ListPage;
