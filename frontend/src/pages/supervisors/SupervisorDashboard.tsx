import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchableSelect from '../../components/SearchableSelect';
import { supervisorsService, type SupervisorDashboardData } from '../../services/supervisors';
import { companiesService } from '../../services/companies';
import { usersService } from '../../services/users';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import type { Company, User } from '../../types/dashboard';
import { controlStatusLabel, currentPeriodYM } from '../../utils/supervisorLabels';

const SupervisorDashboard = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsDashboardView), []);
  const canPickCompanies = useMemo(() => auth.hasPermission(P.companiesView), []);
  const canPickUsers = useMemo(() => auth.hasPermission(P.usersView), []);

  const isAnalistaScope = useMemo(
    () =>
      auth.hasPermission(P.supervisorsControlsUpdate) &&
      !auth.hasPermission(P.supervisorsDeclarationsApprove),
    [],
  );

  const [periodYm, setPeriodYm] = useState(currentPeriodYM());
  const [generalStatus, setGeneralStatus] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [supervisorUserId, setSupervisorUserId] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [data, setData] = useState<SupervisorDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed || !isAnalistaScope) return;
    const u = auth.getUser();
    if (u?.id && !responsibleUserId) {
      setResponsibleUserId(String(u.id));
    }
  }, [allowed, isAnalistaScope, responsibleUserId]);

  useEffect(() => {
    if (!allowed) return;
    const tasks: Promise<void>[] = [];
    if (canPickCompanies) {
      tasks.push(
        companiesService.list({ status: 'activo' }).then(setCompanies).catch(() => setCompanies([])),
      );
    }
    if (canPickUsers) {
      tasks.push(usersService.list().then(setUsers).catch(() => setUsers([])));
    }
    void Promise.all(tasks);
  }, [allowed, canPickCompanies, canPickUsers]);

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        value: String(c.id),
        label: c.business_name || c.ruc || `#${c.id}`,
        searchText: [c.ruc, c.code].filter(Boolean).join(' '),
      })),
    [companies],
  );

  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        value: String(u.id),
        label: u.name || u.username || `#${u.id}`,
        searchText: [u.username, u.email].filter(Boolean).join(' '),
      })),
    [users],
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setData(
        await supervisorsService.dashboard({
          period_ym: periodYm,
          general_status: generalStatus || undefined,
          risk_level: riskLevel || undefined,
          company_id: companyId ? Number(companyId) : undefined,
          responsible_user_id: responsibleUserId ? Number(responsibleUserId) : undefined,
          supervisor_user_id: supervisorUserId ? Number(supervisorUserId) : undefined,
        }),
      );
    } catch {
      setError('No se pudo cargar el dashboard de supervisores');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [periodYm, generalStatus, riskLevel, companyId, responsibleUserId, supervisorUserId]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const chartTotal = useMemo(() => {
    if (!data) return 0;
    return (
      data.controls_al_dia +
      data.controls_pendiente +
      data.controls_vencido +
      data.controls_observado
    );
  }, [data]);

  const hasExtraFilters = Boolean(companyId || responsibleUserId || supervisorUserId);

  const clearExtraFilters = () => {
    setCompanyId('');
    setResponsibleUserId('');
    setSupervisorUserId('');
  };

  if (!allowed) {
    return <p className="p-6 text-center text-slate-600">No tiene permiso para ver el dashboard de supervisores.</p>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Dashboard supervisores</h2>
          <p className="text-sm text-slate-500">Cumplimiento y alertas del período contable.</p>
        </div>
        <div className="flex flex-col gap-3 items-stretch sm:items-end w-full sm:w-auto">
          <div className="flex flex-wrap gap-3 items-end justify-end">
            <label className="text-sm text-slate-600 flex items-center gap-2">
              Período
              <input
                type="month"
                value={periodYm}
                onChange={(e) => setPeriodYm(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm text-slate-600 flex items-center gap-2">
              Estado
              <select
                value={generalStatus}
                onChange={(e) => setGeneralStatus(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Todos</option>
                <option value="al_dia">Al día</option>
                <option value="pendiente">Pendiente</option>
                <option value="vencido">Vencido</option>
                <option value="observado">Observado</option>
              </select>
            </label>
            <label className="text-sm text-slate-600 flex items-center gap-2">
              Riesgo
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Todos</option>
                <option value="bajo">Bajo</option>
                <option value="medio">Medio</option>
                <option value="alto">Alto</option>
                <option value="critico">Crítico</option>
              </select>
            </label>
          </div>
          {isAnalistaScope ? (
            <p className="text-xs text-slate-500 text-right">Vista filtrada a sus controles asignados como responsable.</p>
          ) : null}
          {(canPickCompanies || canPickUsers) && (
            <div className="flex flex-wrap gap-3 items-end justify-end">
              {canPickCompanies ? (
                <label className="text-sm text-slate-600 min-w-[200px] flex-1 sm:flex-none">
                  Empresa
                  <div className="mt-1">
                    <SearchableSelect
                      value={companyId}
                      onChange={setCompanyId}
                      options={[{ value: '', label: 'Todas las empresas' }, ...companyOptions]}
                      placeholder="Filtrar empresa"
                    />
                  </div>
                </label>
              ) : null}
              {canPickUsers ? (
                <>
                  <label className="text-sm text-slate-600 min-w-[200px] flex-1 sm:flex-none">
                    Responsable
                    <div className="mt-1">
                      <SearchableSelect
                        value={responsibleUserId}
                        onChange={setResponsibleUserId}
                        options={[{ value: '', label: 'Todos' }, ...userOptions]}
                        placeholder="Filtrar responsable"
                      />
                    </div>
                  </label>
                  <label className="text-sm text-slate-600 min-w-[200px] flex-1 sm:flex-none">
                    Supervisor
                    <div className="mt-1">
                      <SearchableSelect
                        value={supervisorUserId}
                        onChange={setSupervisorUserId}
                        options={[{ value: '', label: 'Todos' }, ...userOptions]}
                        placeholder="Filtrar supervisor"
                      />
                    </div>
                  </label>
                </>
              ) : null}
              {hasExtraFilters ? (
                <button
                  type="button"
                  onClick={clearExtraFilters}
                  className="px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Limpiar filtros
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard label="Empresas activas" value={data.total_active_companies} icon="fas fa-building" />
            <StatCard label="Empresas al día" value={data.companies_al_dia ?? 0} icon="fas fa-check-circle" />
            <StatCard label="Empresas pendientes" value={data.companies_pendiente ?? 0} icon="fas fa-clock" />
            <StatCard label="Empresas vencidas" value={data.companies_vencido ?? 0} icon="fas fa-exclamation-circle" />
            <StatCard label="Sin control en período" value={data.companies_without_control ?? 0} icon="fas fa-plus-circle" />
            <StatCard label="Cumplimiento %" value={`${data.monthly_compliance_pct}%`} icon="fas fa-percent" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Declaraciones observadas" value={data.declarations_observed} icon="fas fa-exclamation-triangle" />
            <StatCard label="NPS pendientes" value={data.nps_pending} icon="fas fa-receipt" />
            <StatCard label="Pagos pendientes" value={data.payments_pending} icon="fas fa-wallet" />
          </div>
          {chartTotal > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-700 mb-3">Distribución por estado</p>
              <div className="flex h-4 rounded-full overflow-hidden bg-slate-100">
                <div
                  className="bg-emerald-500 h-full"
                  style={{ width: `${(data.controls_al_dia / chartTotal) * 100}%` }}
                  title={controlStatusLabel('al_dia')}
                />
                <div
                  className="bg-amber-400 h-full"
                  style={{ width: `${(data.controls_pendiente / chartTotal) * 100}%` }}
                />
                <div
                  className="bg-red-500 h-full"
                  style={{ width: `${(data.controls_vencido / chartTotal) * 100}%` }}
                />
                <div
                  className="bg-orange-400 h-full"
                  style={{ width: `${(data.controls_observado / chartTotal) * 100}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">Cumplimiento: {data.monthly_compliance_pct}%</p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatusPill label={controlStatusLabel('al_dia')} count={data.controls_al_dia} tone="emerald" />
            <StatusPill label={controlStatusLabel('pendiente')} count={data.controls_pendiente} tone="amber" />
            <StatusPill label={controlStatusLabel('vencido')} count={data.controls_vencido} tone="red" />
            <StatusPill label={controlStatusLabel('observado')} count={data.controls_observado} tone="orange" />
          </div>
          {(data.alerts?.length ?? 0) > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-amber-900">Alertas del período</h3>
              <ul className="space-y-1 text-sm text-amber-950">
                {data.alerts!.map((a, i) => (
                  <li key={`${a.kind}-${i}`} className="flex items-start gap-2">
                    <i className="fas fa-bell mt-0.5 text-amber-600 text-xs" aria-hidden />
                    {a.control_id ? (
                      <Link to={`/supervisors/controls/${a.control_id}`} className="hover:underline">
                        {a.message}
                      </Link>
                    ) : (
                      <span>{a.message}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(data.productivity?.length ?? 0) > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <p className="text-sm font-medium text-slate-700 px-4 pt-4">Productividad por responsable</p>
              <table className="min-w-full text-sm mt-2">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-3">Responsable</th>
                    <th className="text-right px-4 py-3">Controles</th>
                    <th className="text-right px-4 py-3">Al día</th>
                    <th className="text-right px-4 py-3">Cumplimiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.productivity!.map((r) => (
                    <tr key={r.user_id}>
                      <td className="px-4 py-3 font-medium">{r.user_name}</td>
                      <td className="px-4 py-3 text-right">{r.total}</td>
                      <td className="px-4 py-3 text-right">{r.al_dia}</td>
                      <td className="px-4 py-3 text-right">{r.compliance_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3 text-sm">
            <Link to="/supervisors/controls" className="text-primary-700 font-medium">
              → Control mensual
            </Link>
            <Link to="/supervisors/periods" className="text-primary-700 font-medium">
              → Períodos
            </Link>
            <Link to="/supervisors/reports" className="text-primary-700 font-medium">
              → Reportes
            </Link>
            <Link to="/supervisors/notifications" className="text-primary-700 font-medium">
              → Notificaciones
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
};

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
        <i className={icon}></i> {label}
      </div>
      <p className="text-2xl font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function StatusPill({ label, count, tone }: { label: string; count: number; tone: string }) {
  const bg =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-800'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-800'
        : tone === 'red'
          ? 'bg-red-50 text-red-800'
          : 'bg-orange-50 text-orange-800';
  return (
    <div className={`rounded-lg px-4 py-3 ${bg} flex justify-between items-center`}>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-lg font-bold">{count}</span>
    </div>
  );
}

export default SupervisorDashboard;
