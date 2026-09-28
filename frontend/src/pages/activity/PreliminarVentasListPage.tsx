import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import ActivityPeriodFilter from '../../components/activity/ActivityPeriodFilter';
import { RowActionLink } from '../../components/activity/RowActionLink';
import {
  PRELIMINAR_VENTAS_STATUS_FILTER,
  preliminarVentasStatusBadgeClass,
  preliminarVentasStatusLabel,
} from '../../components/activity/preliminarVentasConfig';
import { Z_HEAD_ROW, frozenIdBodyCellStyle, frozenIdHeadCellStyle } from '../../components/activity/stickyTable';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activitiesBasePath, workspaceHomePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import {
  preliminarVentasService,
  type PreliminarVentasListRow,
  type PreliminarVentasSlotStatus,
} from '../../services/preliminarVentas';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';

function formatDueDate(iso?: string): string {
  if (!iso) return 'Sin fecha configurada';
  // El backend manda un time.Time de Go serializado en RFC3339 completo (con hora/offset), no una
  // fecha suelta — parsearlo directo, sin concatenarle "Txx:xx:xx" (eso lo dejaba inválido).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sin fecha configurada';
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type PreliminarVentasListPageProps = {
  workspace: ActivityWorkspace;
};

const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 whitespace-nowrap';
const TD = 'px-4 py-3 text-sm text-slate-700 border-t border-slate-100';

const PreliminarVentasListPage = ({ workspace }: PreliminarVentasListPageProps) => {
  const homePath = workspaceHomePath(workspace);
  const [searchParams, setSearchParams] = useSearchParams();
  // Igual que PDT 601/621: se trabaja "pasando el mes" (en setiembre se controla lo de agosto).
  const initialPeriod = searchParams.get('period_ym') || previousMonthPeriodYM();

  const [periodYm, setPeriodYm] = useState(initialPeriod);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [rows, setRows] = useState<PreliminarVentasListRow[]>([]);
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
      const res = await preliminarVentasService.list({
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
      setError(extractApiErrorMessage(err, 'No se pudo cargar Preliminar de ventas.'));
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

  const slotLink = (companyId: number, slotIndex: 1 | 2) => {
    const path = `${activitiesBasePath(workspace)}/preliminar-ventas/${companyId}/${slotIndex}`;
    return `${path}?period_ym=${encodeURIComponent(periodYm)}`;
  };

  // La fecha límite de cada entrega sale del calendario y es la misma para toda la lista en este
  // período (no depende de la empresa) — se toma de la primera fila que la traiga.
  const slot1DueDate = rows[0]?.slot1.due_date;
  const slot2DueDate = rows[0]?.slot2.due_date;

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Preliminar de ventas</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Resumen de ventas del mes que se envía al cliente antes del cierre, para prever el pago de impuestos.
          </p>
        </div>
        <Link to={homePath} className="text-primary-700 text-sm font-medium hover:underline shrink-0 whitespace-nowrap">
          ← Volver
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
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
          <label className="block text-xs font-medium text-slate-500 mb-1">Estado (cualquier entrega)</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          >
            {PRELIMINAR_VENTAS_STATUS_FILTER.map((opt) => (
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
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-clip">
        <div className="overflow-auto max-h-[75vh]">
          <table className="min-w-full w-full text-left">
            <thead>
              <tr className="bg-slate-50" style={{ position: 'sticky', top: 0, zIndex: Z_HEAD_ROW }}>
                <th className={`${TH} bg-slate-50`} style={frozenIdHeadCellStyle('code')}>Código</th>
                <th className={`${TH} bg-slate-50`} style={frozenIdHeadCellStyle('dig')}>Dígito</th>
                <th className={`${TH} bg-slate-50`} style={frozenIdHeadCellStyle('name')}>Razón social</th>
                <th className={`${TH} bg-slate-50`} style={frozenIdHeadCellStyle('ruc')}>RUC</th>
                <th className={`${TH} bg-slate-50`} style={frozenIdHeadCellStyle('assistant')}>Asistente</th>
                <th className={TH}>{formatDueDate(slot1DueDate)}</th>
                <th className={TH}>{formatDueDate(slot2DueDate)}</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.company_id} className="group hover:bg-slate-50/80">
                    <td className={`${TD} font-mono bg-white group-hover:bg-slate-50`} style={frozenIdBodyCellStyle('code')}>
                      {row.code || '—'}
                    </td>
                    <td className={`${TD} bg-white group-hover:bg-slate-50`} style={frozenIdBodyCellStyle('dig')}>
                      {row.dig || '—'}
                    </td>
                    <td
                      className={`${TD} font-medium bg-white group-hover:bg-slate-50`}
                      style={frozenIdBodyCellStyle('name')}
                      title={row.business_name}
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{row.business_name || '—'}</span>
                        {row.suspendida ? (
                          <span
                            className="shrink-0 inline-block px-1.5 py-0.5 rounded-full text-2xs font-medium bg-purple-100 text-purple-900"
                            title="Suspendida en este período"
                          >
                            Suspendida
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td
                      className={`${TD} font-mono whitespace-nowrap bg-white group-hover:bg-slate-50`}
                      style={frozenIdBodyCellStyle('ruc')}
                    >
                      {row.ruc || '—'}
                    </td>
                    <td
                      className={`${TD} bg-white group-hover:bg-slate-50`}
                      style={frozenIdBodyCellStyle('assistant')}
                      title={row.assistant_username}
                    >
                      <span className="block truncate">{row.assistant_username || '—'}</span>
                    </td>
                    <td className={TD}>
                      <SlotBadge to={slotLink(row.company_id, 1)} slot={row.slot1} />
                    </td>
                    <td className={TD}>
                      <SlotBadge to={slotLink(row.company_id, 2)} slot={row.slot2} />
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
    </div>
  );
};

function SlotBadge({ to, slot }: { to: string; slot: PreliminarVentasSlotStatus }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${preliminarVentasStatusBadgeClass(slot.status)}`}
      >
        {preliminarVentasStatusLabel(slot.status)}
      </span>
      <RowActionLink to={to} icon="fa-pen" label="Editar registro" />
    </div>
  );
}

export default PreliminarVentasListPage;
