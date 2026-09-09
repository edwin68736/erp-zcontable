import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchableSelect from '../../components/SearchableSelect';
import {
  supervisorsService,
  type ComplianceTrendPoint,
  type SupervisorDashboardData,
  type SupervisorPdtTypeSummary,
} from '../../services/supervisors';
import { companiesService } from '../../services/companies';
import { usersService } from '../../services/users';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import type { Company, User } from '../../types/dashboard';
import { controlStatusLabel, previousMonthPeriodYM } from '../../utils/supervisorLabels';
import {
  ComplianceTrendChart,
  ProductivityRanking,
  StatusDistributionDonut,
} from '../../components/supervisors/DashboardCharts';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { extractApiErrorMessage } from '../../utils/apiError';

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

  // Por defecto, el mes calendario anterior: igual que Control PDT 601/621, los controles del
  // dashboard se trabajan "pasando el mes" (en setiembre se controla lo de agosto).
  const [periodYm, setPeriodYm] = useState(previousMonthPeriodYM());
  const [generalStatus, setGeneralStatus] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [supervisorUserId, setSupervisorUserId] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [data, setData] = useState<SupervisorDashboardData | null>(null);
  const [pdtData, setPdtData] = useState<Record<'pdt_601' | 'pdt_621', SupervisorPdtTypeSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdtLoading, setPdtLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdtError, setPdtError] = useState('');
  const [complianceTrend, setComplianceTrend] = useState<ComplianceTrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState('');

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

  const load = useCallback(
    () =>
      supervisorsService.dashboard({
        period_ym: periodYm,
        general_status: generalStatus || undefined,
        risk_level: riskLevel || undefined,
        company_id: companyId ? Number(companyId) : undefined,
        responsible_user_id: responsibleUserId ? Number(responsibleUserId) : undefined,
        supervisor_user_id: supervisorUserId ? Number(supervisorUserId) : undefined,
      }),
    [periodYm, generalStatus, riskLevel, companyId, responsibleUserId, supervisorUserId],
  );

  // Si el usuario cambia de filtro varias veces seguidas, descarta cualquier respuesta que llegue
  // después de que este efecto ya haya sido reemplazado por uno más nuevo — evita que una
  // respuesta vieja y lenta pise en pantalla a una más reciente que ya llegó antes.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void load()
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(extractApiErrorMessage(err, 'No se pudo cargar el dashboard de supervisores'));
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, load]);

  // Antes esta sección se armaba en el navegador (1 listControls + N listDeclarations, hasta
  // ~1800 consultas en el peor caso) y solo escuchaba el período, ignorando el resto de los
  // filtros del panel. Ahora es una sola consulta agrupada en el servidor, con los mismos 5
  // filtros que el resto del dashboard.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setPdtLoading(true);
    setPdtError('');
    void supervisorsService
      .pdtDashboardSummary({
        period_ym: periodYm,
        general_status: generalStatus || undefined,
        risk_level: riskLevel || undefined,
        company_id: companyId ? Number(companyId) : undefined,
        responsible_user_id: responsibleUserId ? Number(responsibleUserId) : undefined,
        supervisor_user_id: supervisorUserId ? Number(supervisorUserId) : undefined,
      })
      .then((res) => {
        if (!cancelled) setPdtData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPdtData(null);
        setPdtError(extractApiErrorMessage(err, 'No se pudo cargar el resumen PDT 601/621.'));
      })
      .finally(() => {
        if (!cancelled) setPdtLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, periodYm, generalStatus, riskLevel, companyId, responsibleUserId, supervisorUserId]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setTrendLoading(true);
    setTrendError('');
    void supervisorsService
      .complianceTrend({
        period_ym: periodYm,
        months: 6,
        general_status: generalStatus || undefined,
        risk_level: riskLevel || undefined,
        company_id: companyId ? Number(companyId) : undefined,
        responsible_user_id: responsibleUserId ? Number(responsibleUserId) : undefined,
        supervisor_user_id: supervisorUserId ? Number(supervisorUserId) : undefined,
      })
      .then((res) => {
        if (!cancelled) setComplianceTrend(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setComplianceTrend([]);
        setTrendError(extractApiErrorMessage(err, 'No se pudo cargar la tendencia de cumplimiento.'));
      })
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, periodYm, generalStatus, riskLevel, companyId, responsibleUserId, supervisorUserId]);

  // Incluye "cerrado" para que el total de la barra sea el MISMO universo que usa el backend
  // para calcular monthly_compliance_pct (antes la barra excluía "cerrado" y el % de al lado sí
  // lo incluía en su base — dos números uno junto al otro que no eran comparables entre sí).
  const chartTotal = useMemo(() => {
    if (!data) return 0;
    return (
      data.controls_al_dia +
      data.controls_pendiente +
      data.controls_vencido +
      data.controls_observado +
      data.controls_cerrado
    );
  }, [data]);

  // El backend limita las alertas individuales de "control vencido" a 8 (Limit(8), para no
  // inundar la lista) — esto cuenta cuántas de esas 8 vinieron, para poder avisar cuando el total
  // real de vencidos (data.controls_vencido) es mayor y quedan más sin mostrar.
  const overdueAlertCount = useMemo(
    () => data?.alerts?.filter((a) => a.kind === 'overdue_control').length ?? 0,
    [data],
  );

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
    <div className={PAGE_WORKSPACE_CLASS}>
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
            <StatCard
              label="Empresas al día"
              value={data.companies_al_dia ?? 0}
              icon="fas fa-check-circle"
              hint="Empresas cuyo control mensual del período está 'Al día' o 'Cerrado' — es decir, el supervisor ya recibió/tramitó su información. No mide pagos ni facturación."
            />
            <StatCard
              label="Empresas pendientes"
              value={data.companies_pendiente ?? 0}
              icon="fas fa-clock"
              hint="Empresas con control mensual en estado 'Pendiente' — aún no se registró recepción de información."
            />
            <StatCard
              label="Empresas vencidas"
              value={data.companies_vencido ?? 0}
              icon="fas fa-exclamation-circle"
              hint="Empresas cuyo control mensual pasó la fecha límite sin quedar al día."
            />
            <StatCard label="Sin control en período" value={data.companies_without_control ?? 0} icon="fas fa-plus-circle" />
            <StatCard
              label="Cumplimiento %"
              value={`${data.monthly_compliance_pct}%`}
              icon="fas fa-percent"
              hint="(Controles al día + cerrados) / total de controles del período."
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Declaraciones observadas" value={data.declarations_observed} icon="fas fa-exclamation-triangle" />
            <StatCard label="NPS pendientes" value={data.nps_pending} icon="fas fa-receipt" />
            <StatCard label="Pagos pendientes" value={data.payments_pending} icon="fas fa-wallet" />
          </div>

          <PdtSummarySection
            loading={pdtLoading}
            error={pdtError}
            summary601={pdtData?.pdt_601}
            summary621={pdtData?.pdt_621}
            workspace="supervisor"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {chartTotal > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-medium text-slate-700 mb-3">Distribución por estado</p>
                <StatusDistributionDonut
                  total={chartTotal}
                  slices={[
                    { label: controlStatusLabel('al_dia'), value: data.controls_al_dia, colorClass: 'stroke-emerald-500' },
                    { label: controlStatusLabel('pendiente'), value: data.controls_pendiente, colorClass: 'stroke-amber-400' },
                    { label: controlStatusLabel('vencido'), value: data.controls_vencido, colorClass: 'stroke-red-500' },
                    { label: controlStatusLabel('observado'), value: data.controls_observado, colorClass: 'stroke-orange-400' },
                    { label: controlStatusLabel('cerrado'), value: data.controls_cerrado, colorClass: 'stroke-slate-400' },
                  ]}
                />
                <p className="text-xs text-slate-500 mt-3">Cumplimiento: {data.monthly_compliance_pct}%</p>
              </div>
            ) : null}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-700 mb-3">Tendencia de cumplimiento (6 meses)</p>
              {trendLoading ? (
                <p className="text-sm text-slate-500">Cargando tendencia…</p>
              ) : trendError ? (
                <p className="text-sm text-red-600">{trendError}</p>
              ) : (
                <ComplianceTrendChart points={complianceTrend} />
              )}
            </div>
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
              {overdueAlertCount > 0 && data.controls_vencido > overdueAlertCount ? (
                <p className="text-xs text-amber-700">
                  Mostrando {overdueAlertCount} de {data.controls_vencido} controles vencidos — revise{' '}
                  <Link to="/supervisors/reports" className="underline">
                    Reportes
                  </Link>{' '}
                  para ver el resto.
                </p>
              ) : null}
            </div>
          ) : null}
          {(data.productivity?.length ?? 0) > 0 ? <ProductivityRanking rows={data.productivity!} /> : null}
          <div className="flex flex-wrap gap-3 text-sm">
            <Link to="/supervisors/activities/pdt-601" className="text-primary-700 font-medium">
              → PDT 601
            </Link>
            <Link to="/supervisors/activities/pdt-621" className="text-primary-700 font-medium">
              → PDT 621
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

function PdtSummarySection({
  loading,
  error,
  summary601,
  summary621,
  workspace,
}: {
  loading: boolean;
  error?: string;
  summary601?: SupervisorPdtTypeSummary;
  summary621?: SupervisorPdtTypeSummary;
  workspace: 'supervisor' | 'assistant';
}) {
  const base = workspace === 'assistant' ? '/assistant/activities' : '/supervisors/activities';

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Declaraciones PDT 601/621</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Resumen por tipo a partir de controles y declaraciones del período.
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-slate-500">Cargando resumen PDT…</p>
      ) : error ? (
        <p className="text-sm text-red-600 flex items-center gap-1.5">
          <i className="fas fa-exclamation-circle text-xs" aria-hidden />
          {error}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PdtTypeCard title="PDT 601" summary={summary601 ?? emptyPdtSummary()} linkTo={`${base}/pdt-601`} />
          <PdtTypeCard title="PDT 621" summary={summary621 ?? emptyPdtSummary()} linkTo={`${base}/pdt-621`} />
        </div>
      )}
    </div>
  );
}

function emptyPdtSummary(): SupervisorPdtTypeSummary {
  return { pendiente: 0, observado: 0, vencido: 0, completado: 0, sin_planilla: 0, suspendida: 0, total: 0 };
}

function PdtTypeCard({
  title,
  summary,
  linkTo,
}: {
  title: string;
  summary: SupervisorPdtTypeSummary;
  linkTo: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <Link to={linkTo} className="text-xs text-primary-700 font-medium">
          Ver módulo →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <PdtMiniStat label="Pendientes" value={summary.pendiente} tone="amber" />
        <PdtMiniStat label="Observadas" value={summary.observado} tone="orange" />
        <PdtMiniStat label="Vencidas" value={summary.vencido} tone="red" />
        <PdtMiniStat label="Completadas" value={summary.completado} tone="emerald" />
        {/* Solo PDT 601 tiene el concepto "sin planilla" (PDT 621 siempre trae 0 acá) — no se
            cuenta como pendiente: la empresa no tiene nada que declarar en el período. */}
        {summary.sin_planilla > 0 ? (
          <PdtMiniStat label="Sin planilla" value={summary.sin_planilla} tone="slate" />
        ) : null}
        {/* "Suspendida" sí aplica a ambos módulos — tampoco cuenta como pendiente/vencido mientras
            la empresa esté suspendida (ver PdtDashboardSummary). */}
        {summary.suspendida > 0 ? (
          <PdtMiniStat label="Suspendida" value={summary.suspendida} tone="purple" />
        ) : null}
      </div>
      <p className="text-[10px] text-slate-400 mt-3">Total en período: {summary.total}</p>
    </div>
  );
}

function PdtMiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'orange' | 'red' | 'emerald' | 'slate' | 'purple';
}) {
  const bg =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-800'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-800'
        : tone === 'red'
          ? 'bg-red-50 text-red-800'
          : tone === 'slate'
            ? 'bg-slate-100 text-slate-700'
            : tone === 'purple'
              ? 'bg-purple-100 text-purple-800'
              : 'bg-orange-50 text-orange-800';
  return (
    <div className={`rounded-lg px-3 py-2 flex justify-between items-center ${bg}`}>
      <span>{label}</span>
      <span className="font-bold text-sm">{value}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: number | string;
  icon: string;
  /** Tooltip explicando qué mide exactamente la tarjeta — para etiquetas ambiguas como "Empresas
   * al día" (no es un indicador de pagos: se calcula sobre el estado del control mensual). */
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" title={hint}>
      <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
        <i className={icon}></i> {label}
        {hint ? <i className="fas fa-circle-info text-[10px] text-slate-300" aria-hidden /> : null}
      </div>
      <p className="text-2xl font-semibold text-slate-800">{value}</p>
    </div>
  );
}


export default SupervisorDashboard;
