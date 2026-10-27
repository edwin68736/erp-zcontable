import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import ActivityPeriodFilter from '../../components/activity/ActivityPeriodFilter';
import { RowActionLink } from '../../components/activity/RowActionLink';
import ActivityOwnerFilters from '../../components/activity/ActivityOwnerFilters';
import SuspendCompanyAction from '../../components/activity/SuspendCompanyAction';
import SuspensionCarryOverModal from '../../components/activity/SuspensionCarryOverModal';
import {
  PRELIMINAR_VENTAS_LATE_CELL_CLASS,
  PRELIMINAR_VENTAS_STATUS_FILTER,
  preliminarVentasEntregadaFueraDePlazo,
  preliminarVentasSlotBadge,
} from '../../components/activity/preliminarVentasConfig';
import { Z_HEAD_ROW, frozenIdBodyCellStyle, frozenIdHeadCellStyle } from '../../components/activity/stickyTable';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activitiesBasePath, workspaceHomePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import {
  preliminarVentasService,
  type PreliminarVentasListRow,
  type PreliminarVentasSlotStatus,
} from '../../services/preliminarVentas';
// El arrastre de suspensión entre períodos (§5.9.9) es genérico (vive en detraccionesService porque
// Detracciones es el único módulo que escribe/resuelve "suspendida", no porque sea exclusivo de
// ese módulo) — se reusa tal cual acá para que abrir Preliminar de Ventas en un período nuevo
// también pregunte si corresponde arrastrar la suspensión del período anterior, en vez de dejar que
// el control nuevo nazca en falso silenciosamente (antes solo Detracciones preguntaba esto).
import { detraccionesService, type SuspensionCarryOverRow } from '../../services/detracciones';
import { currentPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import { exportPreliminarVentasReportExcel } from '../../utils/preliminarVentasExcelExport';

function formatDueDate(iso?: string): string {
  if (!iso) return 'Sin fecha configurada';
  // La fecha límite es un día calendario: se toman los 10 primeros caracteres (AAAA-MM-DD) del valor del
  // servidor. Parsearlo como instante lo corría un día atrás cuando el servidor está en UTC (medianoche UTC
  // = el día anterior en Perú).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return 'Sin fecha configurada';
  return `${m[3]}/${m[2]}/${m[1]}`;
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
  const initialPeriod = searchParams.get('period_ym') || currentPeriodYM();

  const [periodYm, setPeriodYm] = useState(initialPeriod);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [statusFilter, setStatusFilter] = useState('');
  const [filterAssistantId, setFilterAssistantId] = useState<number | null>(null);
  const [filterSupervisorId, setFilterSupervisorId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [rows, setRows] = useState<PreliminarVentasListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [excelSlots, setExcelSlots] = useState<'both' | '1' | '2'>('both');

  // Modal de arrastre de suspensión entre períodos (§5.9.9) — "cualquier usuario" puede resolverlo
  // (§5.9.9.3), así que no se acota por permiso de edición.
  const [carryOverCompanies, setCarryOverCompanies] = useState<SuspensionCarryOverRow[]>([]);
  const [carryOverOpen, setCarryOverOpen] = useState(false);
  const [carryOverSaving, setCarryOverSaving] = useState(false);
  const [carryOverError, setCarryOverError] = useState('');

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
        assistant_user_id: filterAssistantId ?? undefined,
        supervisor_user_id: filterSupervisorId ?? undefined,
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
  }, [periodYm, debouncedQ, statusFilter, filterAssistantId, filterSupervisorId, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [periodYm, debouncedQ, statusFilter, filterAssistantId, filterSupervisorId]);

  // Al entrar (o cambiar de período), se consulta si hay un arrastre de suspensión sin resolver —
  // si el usuario cierra el modal sin decidir, no se recuerda acá: la próxima vez que se entre a
  // este período se vuelve a preguntar, igual que en Control de Detracciones (§5.9.9.2).
  useEffect(() => {
    let cancelled = false;
    detraccionesService
      .getSuspensionCarryOverStatus(periodYm)
      .then((status) => {
        if (cancelled) return;
        setCarryOverCompanies(status.companies ?? []);
        setCarryOverOpen(status.pending);
        setCarryOverError('');
      })
      .catch((err: unknown) => {
        console.error(err);
        // Silencioso: no bloquea el uso normal del listado si esta consulta falla.
      });
    return () => {
      cancelled = true;
    };
  }, [periodYm]);

  const handleCarryOverConfirm = async (keepSuspendedCompanyIds: number[]) => {
    try {
      setCarryOverSaving(true);
      setCarryOverError('');
      await detraccionesService.applySuspensionCarryOver(periodYm, keepSuspendedCompanyIds);
      setCarryOverOpen(false);
      await load();
    } catch (err) {
      // Si ya lo resolvió otro usuario (§5.9.9.4), recargar el estado en vez de reintentar.
      setCarryOverError(extractApiErrorMessage(err, 'No se pudo aplicar la decisión.'));
      try {
        const status = await detraccionesService.getSuspensionCarryOverStatus(periodYm);
        setCarryOverCompanies(status.companies ?? []);
        setCarryOverOpen(status.pending);
        if (!status.pending) await load();
      } catch (reloadErr) {
        console.error(reloadErr);
      }
    } finally {
      setCarryOverSaving(false);
    }
  };

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    try {
      setExportingExcel(true);
      setError('');
      const exportRows = await preliminarVentasService.fetchExportData({
        period_ym: periodYm,
        q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
        status: statusFilter || undefined,
        assistant_user_id: filterAssistantId ?? undefined,
        supervisor_user_id: filterSupervisorId ?? undefined,
      });
      await exportPreliminarVentasReportExcel({
        periodYm,
        rows: exportRows,
        workspace,
        slots: excelSlots === 'both' ? [1, 2] : [Number(excelSlots) as 1 | 2],
      });
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo exportar a Excel.'));
    } finally {
      setExportingExcel(false);
    }
  };

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
        <ActivityOwnerFilters
          assistantId={filterAssistantId}
          supervisorId={filterSupervisorId}
          onAssistantChange={setFilterAssistantId}
          onSupervisorChange={setFilterSupervisorId}
        />
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
        <div className="shrink-0">
          <label htmlFor="pv-excel-slots" className="block text-xs font-medium text-slate-500 mb-1">
            Excel de
          </label>
          <select
            id="pv-excel-slots"
            value={excelSlots}
            onChange={(e) => setExcelSlots(e.target.value as 'both' | '1' | '2')}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="both">Ambas entregas</option>
            <option value="1">Entrega 1</option>
            <option value="2">Entrega 2</option>
          </select>
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
                <th className={TH}>Suspender</th>
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
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">
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
                      className={`${TD} font-medium bg-white group-hover:bg-slate-50 truncate`}
                      style={frozenIdBodyCellStyle('name')}
                      title={row.business_name}
                    >
                      {row.business_name || '—'}
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
                    <td className={`${TD} ${slotCellClass(row.slot1, row.suspendida)}`}>
                      <SlotBadge to={slotLink(row.company_id, 1)} slot={row.slot1} suspendida={row.suspendida} />
                    </td>
                    <td className={`${TD} ${slotCellClass(row.slot2, row.suspendida)}`}>
                      <SlotBadge to={slotLink(row.company_id, 2)} slot={row.slot2} suspendida={row.suspendida} />
                    </td>
                    <td className={TD}>
                      <SuspendCompanyAction
                        companyId={row.company_id}
                        companyName={row.business_name}
                        periodYm={periodYm}
                        suspendida={!!row.suspendida}
                        onChanged={() => void load()}
                      />
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

      <SuspensionCarryOverModal
        open={carryOverOpen}
        companies={carryOverCompanies}
        saving={carryOverSaving}
        error={carryOverError}
        onClose={() => setCarryOverOpen(false)}
        onConfirm={(ids) => void handleCarryOverConfirm(ids)}
      />
    </div>
  );
};

// Suspendida es un overlay global del período (SupervisorMonthlyControl.Suspendida, §5.9.7) — no un
// estado más de la entrega — así que pisa el estado real de AMBAS entregas en vez de mostrarse como
// un chip aparte junto a la razón social (mismo criterio que pdt621DisplayStatus en PDT 601/621).
/** Celda celeste: entrega registrada después de su fecha del calendario (igual en el Excel). */
function slotCellClass(slot: PreliminarVentasSlotStatus, suspendida: boolean): string {
  return !suspendida && preliminarVentasEntregadaFueraDePlazo(slot.status, slot.timeliness) ? PRELIMINAR_VENTAS_LATE_CELL_CLASS : '';
}

function SlotBadge({ to, slot, suspendida }: { to: string; slot: PreliminarVentasSlotStatus; suspendida: boolean }) {
  const badge = preliminarVentasSlotBadge(slot.status, slot.timeliness);
  const label = suspendida ? 'Suspendida' : badge.label;
  const badgeClass = suspendida ? 'bg-purple-100 text-purple-900' : badge.className;
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${badgeClass}`}>{label}</span>
      {/* El lápiz aparece recién desde la fecha de la entrega en el calendario (fecha del servidor).
          Solo es la pantalla: el backend no bloquea entregas anticipadas. */}
      {slot.disponible !== false ? (
        <RowActionLink to={to} icon="fa-pen" label="Editar registro" />
      ) : (
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400"
          title={`Se habilita el ${formatDueDate(slot.due_date)}`}
        >
          <i className="fas fa-lock text-xs" aria-hidden />
        </span>
      )}
    </div>
  );
}

export default PreliminarVentasListPage;
