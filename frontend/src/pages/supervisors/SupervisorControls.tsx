import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supervisorsService, type SupervisorMonthlyControl } from '../../services/supervisors';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import Pagination from '../../components/Pagination';
import CompanySearchInput from '../../components/CompanySearchInput';
import ConfirmDialog from '../../components/ConfirmDialog';
import ActivityHubNav from '../../components/activity/ActivityHubNav';
import {
  controlsDetailBasePath,
  type ActivityWorkspace,
} from '../../navigation/activityRoutes';
import { controlStatusLabel, currentPeriodYM, riskLevelLabel } from '../../utils/supervisorLabels';

type SupervisorControlsProps = {
  /** Ruta base para enlazar al detalle (p. ej. /assistant/controls). */
  detailBasePath?: string;
  /** supervisor | assistant — define el hub de actividades y textos. */
  workspace?: ActivityWorkspace;
};

const SupervisorControls = ({
  detailBasePath,
  workspace = 'supervisor',
}: SupervisorControlsProps) => {
  const resolvedDetailBase = detailBasePath ?? controlsDetailBasePath(workspace);
  const canView = useMemo(() => auth.hasPermission(P.supervisorsControlsView), []);
  const canCreate = useMemo(() => auth.hasPermission(P.supervisorsControlsCreate), []);
  const canDelete = useMemo(() => auth.hasPermission(P.supervisorsControlsDelete), []);
  const [searchParams, setSearchParams] = useSearchParams();

  const periodYm = searchParams.get('period_ym') || currentPeriodYM();
  const page = Number(searchParams.get('page') || '1') || 1;
  const companyId = searchParams.get('company_id') || '';
  const generalStatus = searchParams.get('general_status') || '';

  const [list, setList] = useState<SupervisorMonthlyControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, per_page: 20, total: 0, total_pages: 0 });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createCompanyId, setCreateCompanyId] = useState('');
  const [createPeriod, setCreatePeriod] = useState(periodYm);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await supervisorsService.listControls({
        period_ym: periodYm,
        company_id: companyId || undefined,
        general_status: generalStatus || undefined,
        page,
        per_page: 20,
      });
      setList(Array.isArray(res.items) ? res.items : []);
      setPagination(res.pagination);
    } catch {
      setMsg('Error al cargar controles');
    } finally {
      setLoading(false);
    }
  }, [periodYm, companyId, generalStatus, page]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setSearchParams(next);
  };

  const handleCreate = async () => {
    const cid = Number(createCompanyId);
    if (!cid) return;
    try {
      await supervisorsService.createControl({
        company_id: cid,
        period_ym: createPeriod,
        general_status: 'pendiente',
        risk_level: 'bajo',
      });
      setShowCreate(false);
      void load();
    } catch {
      setMsg('No se pudo crear el control (¿ya existe para esa empresa/período?)');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await supervisorsService.deleteControl(deleteId);
      setDeleteId(null);
      void load();
    } catch {
      setMsg('No se pudo eliminar');
    }
  };

  if (!canView) {
    return <p className="p-6 text-center text-slate-600">Sin permiso para ver controles mensuales.</p>;
  }

  const pageTitle = 'Control de actividades';
  const pageSubtitle =
    workspace === 'assistant'
      ? 'Hub operativo y listado de controles mensuales de sus empresas.'
      : 'Hub de supervisión y listado de controles mensuales por empresa.';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">{pageTitle}</h2>
          <p className="text-sm text-slate-500">{pageSubtitle}</p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium"
          >
            <i className="fas fa-plus text-xs mr-1"></i> Nuevo control
          </button>
        ) : null}
      </div>

      {msg ? <p className="text-sm text-red-600">{msg}</p> : null}

      <ActivityHubNav workspace={workspace} />

      <div className="border-t border-slate-100 pt-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Controles mensuales</h3>
        <p className="text-xs text-slate-500 mb-4">
          Vista legacy durante la migración. Use &quot;Detalle&quot; para el flujo completo hasta habilitar PDT 601/621.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-sm text-slate-600">
          Período
          <input
            type="month"
            value={periodYm}
            onChange={(e) => setFilter('period_ym', e.target.value)}
            className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          />
        </label>
        <div className="min-w-[220px]">
          <span className="text-sm text-slate-600 block mb-1">Empresa</span>
          <CompanySearchInput value={companyId} onChange={(id) => setFilter('company_id', id)} />
        </div>
        <label className="text-sm text-slate-600">
          Estado
          <select
            value={generalStatus}
            onChange={(e) => setFilter('general_status', e.target.value)}
            className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            <option value="al_dia">Al día</option>
            <option value="pendiente">Pendiente</option>
            <option value="vencido">Vencido</option>
            <option value="observado">Observado</option>
            <option value="cerrado">Cerrado</option>
          </select>
        </label>
      </div>

      {showCreate ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-4 space-y-3">
          <p className="text-sm font-medium text-slate-800">Nuevo control mensual</p>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              Período
              <input
                type="month"
                value={createPeriod}
                onChange={(e) => setCreatePeriod(e.target.value)}
                className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
              />
            </label>
            <div className="min-w-[240px]">
              <span className="text-sm block mb-1">Empresa</span>
              <CompanySearchInput value={createCompanyId} onChange={setCreateCompanyId} />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm"
            >
              Guardar
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-slate-600">
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3">Empresa</th>
                <th className="text-left px-4 py-3">Período</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Riesgo</th>
                <th className="text-left px-4 py-3">Responsable</th>
                <th className="text-left px-4 py-3">Supervisor</th>
                <th className="text-left px-4 py-3">Vencimiento</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No hay controles para este período o filtros. Cree un período y genere controles, o agregue uno manualmente.
                  </td>
                </tr>
              ) : null}
              {list.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.company?.business_name ?? `#${row.company_id}`}</p>
                    <p className="text-xs text-slate-500">{row.company?.ruc}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{row.period_ym}</td>
                  <td className="px-4 py-3">{controlStatusLabel(row.general_status)}</td>
                  <td className="px-4 py-3">{riskLevelLabel(row.risk_level)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.responsible?.full_name || row.responsible?.username || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.supervisor?.full_name || row.supervisor?.username || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                    {row.due_date ? new Date(row.due_date).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Link to={`${resolvedDetailBase}/${row.id}`} className="text-primary-700 text-xs font-medium">
                      Detalle
                    </Link>
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => setDeleteId(row.id)}
                        className="text-red-600 text-xs font-medium"
                      >
                        Eliminar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={pagination.page}
        perPage={pagination.per_page}
        total={pagination.total}
        onPageChange={(p) => setFilter('page', String(p))}
        onPerPageChange={() => {}}
      />

      <ConfirmDialog
        open={deleteId != null}
        title="Eliminar control"
        message="Se eliminarán declaraciones, liquidación y NPS asociados."
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteId(null)}
      />
    </div>
  );
};

export default SupervisorControls;
