import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import SearchableSelect from '../../components/SearchableSelect';
import PageHeading from '../../components/ui/PageHeading';
import {
  supervisorsService,
  type ComplianceTrendPoint,
  type SupervisorDashboardData,
  type SupervisorPdtTypeSummary,
  type SupervisorPdtAssistantSummary,
  type SupervisorPdtBucketCompany,
} from '../../services/supervisors';
import { companiesService } from '../../services/companies';
import { usersService } from '../../services/users';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import type { Company, User } from '../../types/dashboard';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
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
  const [pdtAssistantData, setPdtAssistantData] = useState<SupervisorPdtAssistantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdtLoading, setPdtLoading] = useState(false);
  const [pdtAssistantLoading, setPdtAssistantLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdtError, setPdtError] = useState('');
  const [pdtAssistantError, setPdtAssistantError] = useState('');
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

  // Desempeño por asistente (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §12.3) — mismos
  // filtros que el resumen de arriba, solo tiene sentido en este dashboard (el del supervisor).
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setPdtAssistantLoading(true);
    setPdtAssistantError('');
    void supervisorsService
      .pdtAssistantPerformance({
        period_ym: periodYm,
        general_status: generalStatus || undefined,
        risk_level: riskLevel || undefined,
        company_id: companyId ? Number(companyId) : undefined,
        responsible_user_id: responsibleUserId ? Number(responsibleUserId) : undefined,
        supervisor_user_id: supervisorUserId ? Number(supervisorUserId) : undefined,
      })
      .then((res) => {
        if (!cancelled) setPdtAssistantData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPdtAssistantData([]);
        setPdtAssistantError(extractApiErrorMessage(err, 'No se pudo cargar el desempeño por asistente.'));
      })
      .finally(() => {
        if (!cancelled) setPdtAssistantLoading(false);
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

  // Mismo universo que monthly_compliance_pct (docs/diseno-limpieza-control-detail-2026-09-16.md
  // §5.9.3) — 5 categorías en vivo de compliance_breakdown, ya no general_status.
  const chartTotal = data?.compliance_breakdown?.total ?? 0;

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
          <PageHeading>Dashboard supervisores</PageHeading>
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
              label="Cumplimiento (PDT 601/621, Detracciones, Buzón SOL)"
              value={`${data.monthly_compliance_pct}%`}
              icon="fas fa-percent"
              hint="Cumplido a tiempo / (cumplido a tiempo + fuera de fecha + vencido sin entregar), sobre PDT 601, PDT 621, Detracciones y Buzón SOL del período — pendientes (sin vencer todavía) y exentos/no aplica quedan fuera del cálculo."
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Declaraciones observadas" value={data.declarations_observed} icon="fas fa-exclamation-triangle" />
          </div>

          <PdtSummarySection
            loading={pdtLoading}
            error={pdtError}
            summary601={pdtData?.pdt_601}
            summary621={pdtData?.pdt_621}
            workspace="supervisor"
            assistantPerformance={pdtAssistantData}
            assistantPerformanceLoading={pdtAssistantLoading}
            assistantPerformanceError={pdtAssistantError}
            filters={{
              periodYm,
              companyId: companyId || undefined,
              generalStatus: generalStatus || undefined,
              riskLevel: riskLevel || undefined,
              responsibleUserId: responsibleUserId || undefined,
              supervisorUserId: supervisorUserId || undefined,
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {chartTotal > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-medium text-slate-700 mb-3">Distribución de cumplimiento (PDT 601/621, Detracciones, Buzón SOL)</p>
                {/* 5 categorías en vivo (§5.9.3) — reemplaza al donut viejo de general_status
                    (al_dia/pendiente/vencido/observado/cerrado, sin relación con esto). "Entregado
                    fuera de fecha" y "Vencido sin entregar" quedan separados a propósito: son
                    situaciones distintas para decidir a quién presionar. */}
                <StatusDistributionDonut
                  total={chartTotal}
                  slices={[
                    { label: 'Cumplido a tiempo', value: data.compliance_breakdown.on_time, colorClass: 'stroke-primary-500' },
                    { label: 'Entregado fuera de fecha', value: data.compliance_breakdown.late, colorClass: 'stroke-orange-400' },
                    { label: 'Vencido sin entregar', value: data.compliance_breakdown.missing, colorClass: 'stroke-red-500' },
                    { label: 'Pendiente (sin vencer)', value: data.compliance_breakdown.pending, colorClass: 'stroke-amber-400' },
                    { label: 'Exento o no aplica', value: data.compliance_breakdown.exempt, colorClass: 'stroke-slate-400' },
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

/** Filtros vigentes del dashboard — se reenvían tal cual al pedir la lista de empresas de un
 * bucket, para que esa lista siempre calce con el número ya mostrado en la tarjeta. */
export type PdtDashboardFilters = {
  periodYm: string;
  companyId?: string;
  generalStatus?: string;
  riskLevel?: string;
  responsibleUserId?: string;
  supervisorUserId?: string;
};

type OpenBucket = { declarationType: 'pdt_601' | 'pdt_621'; bucket: string; label: string };

export function PdtSummarySection({
  loading,
  error,
  summary601,
  summary621,
  workspace,
  assistantPerformance,
  assistantPerformanceLoading,
  assistantPerformanceError,
  filters,
}: {
  loading: boolean;
  error?: string;
  summary601?: SupervisorPdtTypeSummary;
  summary621?: SupervisorPdtTypeSummary;
  workspace: 'supervisor' | 'assistant';
  /** Solo se pasa desde el dashboard del supervisor (docs/diseno-estados-pdt601-pdt621-2026-09-
   * 16.md §12.3) — el del asistente no la necesita, ahí solo hay una persona. */
  assistantPerformance?: SupervisorPdtAssistantSummary[];
  assistantPerformanceLoading?: boolean;
  assistantPerformanceError?: string;
  filters: PdtDashboardFilters;
}) {
  const base = workspace === 'assistant' ? '/assistant/activities' : '/supervisors/activities';
  const [openBucket, setOpenBucket] = useState<OpenBucket | null>(null);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Declaraciones PDT 601/621</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Resumen por tipo a partir de controles y declaraciones del período. Haga clic en un estado para ver las
          empresas.
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
          <PdtTypeCard
            title="PDT 601"
            summary={summary601 ?? emptyPdtSummary()}
            linkTo={`${base}/pdt-601`}
            onOpenBucket={(bucket, label) => setOpenBucket({ declarationType: 'pdt_601', bucket, label })}
          />
          <PdtTypeCard
            title="PDT 621"
            summary={summary621 ?? emptyPdtSummary()}
            linkTo={`${base}/pdt-621`}
            onOpenBucket={(bucket, label) => setOpenBucket({ declarationType: 'pdt_621', bucket, label })}
          />
        </div>
      )}
      {openBucket ? (
        <PdtBucketCompaniesModal
          open={openBucket}
          filters={filters}
          base={base}
          onClose={() => setOpenBucket(null)}
        />
      ) : null}
      {workspace === 'supervisor' ? (
        <PdtAssistantPerformanceTable
          loading={!!assistantPerformanceLoading}
          error={assistantPerformanceError}
          rows={assistantPerformance ?? []}
        />
      ) : null}
    </div>
  );
}

function emptyPdtSummary(): SupervisorPdtTypeSummary {
  return {
    pendiente: 0,
    observado: 0,
    vencido: 0,
    completado: 0,
    sin_planilla: 0,
    suspendida: 0,
    total: 0,
    entregado_a_tiempo: 0,
    entregado_fuera_de_fecha: 0,
  };
}

const PDT_DECLARATION_TYPE_LABEL: Record<string, string> = { pdt_601: 'PDT 601', pdt_621: 'PDT 621' };

/** "¿Cómo viene cada uno de mis asistentes?" — no solo el total del portafolio (§12.3). Una fila
 * por (asistente, tipo), agrupadas visualmente por asistente ya que la API las devuelve ordenadas
 * por username. */
function PdtAssistantPerformanceTable({
  loading,
  error,
  rows,
}: {
  loading: boolean;
  error?: string;
  rows: SupervisorPdtAssistantSummary[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-800">Desempeño por asistente</h3>
      {loading ? (
        <p className="text-sm text-slate-500">Cargando desempeño por asistente…</p>
      ) : error ? (
        <p className="text-sm text-red-600 flex items-center gap-1.5">
          <i className="fas fa-exclamation-circle text-xs" aria-hidden />
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Sin empresas con asistente asignado en este período/alcance.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Asistente</th>
                <th className="px-3 py-2 text-left">Módulo</th>
                <th className="px-3 py-2 text-right">Pendiente</th>
                <th className="px-3 py-2 text-right">Observado</th>
                <th className="px-3 py-2 text-right">Vencido</th>
                <th className="px-3 py-2 text-right">Entregado a tiempo</th>
                <th className="px-3 py-2 text-right">Entregado fuera de fecha</th>
                {/* Sin planilla/Suspendida son buckets propios (docs/diseno-estados-pdt601-pdt621-
                    2026-09-16.md §6/§12.1), no "pendiente" — sin estas dos columnas, Pendiente +
                    Observado + Vencido + Entregado (a tiempo/fuera de fecha) no sumaba el Total de la
                    fila cuando el asistente tenía alguna empresa sin planilla o suspendida. */}
                <th className="px-3 py-2 text-right">Sin planilla</th>
                <th className="px-3 py-2 text-right">Suspendida</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={`${r.assistant_user_id}-${r.declaration_type}`} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2 text-slate-800 font-medium">{r.assistant_username || `Usuario #${r.assistant_user_id}`}</td>
                  <td className="px-3 py-2 text-slate-600">{PDT_DECLARATION_TYPE_LABEL[r.declaration_type] ?? r.declaration_type}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.pendiente}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.observado}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">{r.vencido}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-primary-700">{r.entregado_a_tiempo}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-700">{r.entregado_fuera_de_fecha}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.sin_planilla}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-purple-700">{r.suspendida}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PdtTypeCard({
  title,
  summary,
  linkTo,
  onOpenBucket,
}: {
  title: string;
  summary: SupervisorPdtTypeSummary;
  linkTo: string;
  onOpenBucket: (bucket: string, label: string) => void;
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
        <PdtMiniStat label="Pendientes" value={summary.pendiente} tone="amber" onClick={() => onOpenBucket('pendiente', 'Pendientes')} />
        <PdtMiniStat label="Observadas" value={summary.observado} tone="orange" onClick={() => onOpenBucket('observado', 'Observadas')} />
        <PdtMiniStat label="Vencidas" value={summary.vencido} tone="red" onClick={() => onOpenBucket('vencido', 'Vencidas')} />
        <PdtMiniStat label="Completadas" value={summary.completado} tone="emerald" onClick={() => onOpenBucket('completado', 'Completadas')} />
        {/* Apertura de "Completadas" por puntualidad (docs/diseno-estados-pdt601-pdt621-2026-09-
            16.md §12.1) — suman exactamente el total de arriba, calculado contra el calendario
            interno del estudio. Solo se muestran si hay algo que desglosar. */}
        {summary.entregado_a_tiempo > 0 ? (
          <PdtMiniStat
            label="Entregado a tiempo"
            value={summary.entregado_a_tiempo}
            tone="emerald"
            onClick={() => onOpenBucket('entregado_a_tiempo', 'Entregado a tiempo')}
          />
        ) : null}
        {summary.entregado_fuera_de_fecha > 0 ? (
          <PdtMiniStat
            label="Entregado fuera de fecha"
            value={summary.entregado_fuera_de_fecha}
            tone="orange"
            onClick={() => onOpenBucket('entregado_fuera_de_fecha', 'Entregado fuera de fecha')}
          />
        ) : null}
        {/* Solo PDT 601 tiene el concepto "sin planilla" (PDT 621 siempre trae 0 acá) — no se
            cuenta como pendiente: la empresa no tiene nada que declarar en el período. */}
        {summary.sin_planilla > 0 ? (
          <PdtMiniStat
            label="Sin planilla"
            value={summary.sin_planilla}
            tone="slate"
            onClick={() => onOpenBucket('sin_planilla', 'Sin planilla')}
          />
        ) : null}
        {/* "Suspendida" sí aplica a ambos módulos — tampoco cuenta como pendiente/vencido mientras
            la empresa esté suspendida (ver PdtDashboardSummary). */}
        {summary.suspendida > 0 ? (
          <PdtMiniStat
            label="Suspendida"
            value={summary.suspendida}
            tone="purple"
            onClick={() => onOpenBucket('suspendida', 'Suspendida')}
          />
        ) : null}
      </div>
      <p className="text-2xs text-slate-400 mt-3">Total en período: {summary.total}</p>
    </div>
  );
}

function PdtMiniStat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'orange' | 'red' | 'emerald' | 'slate' | 'purple';
  onClick: () => void;
}) {
  const bg =
    tone === 'emerald'
      ? 'bg-primary-50 text-primary-800'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-800'
        : tone === 'red'
          ? 'bg-red-50 text-red-800'
          : tone === 'slate'
            ? 'bg-slate-100 text-slate-700'
            : tone === 'purple'
              ? 'bg-purple-100 text-purple-800'
              : 'bg-orange-50 text-orange-800';
  if (value === 0) {
    return (
      <div className={`rounded-lg px-3 py-2 flex justify-between items-center ${bg} opacity-60`}>
        <span>{label}</span>
        <span className="font-bold text-sm">{value}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 flex justify-between items-center ${bg} hover:ring-2 hover:ring-offset-1 hover:ring-primary-400 transition-shadow cursor-pointer text-left`}
    >
      <span>{label}</span>
      <span className="font-bold text-sm">{value}</span>
    </button>
  );
}

function useBucketModalDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const BUCKET_MODAL_PAGE_SIZE = 20;

/** Lista de empresas detrás de un bucket de una tarjeta PDT (clic en "Vencidas", "Pendientes",
 * etc.) — reusa los mismos filtros del dashboard para que la lista siempre calce con el número
 * ya mostrado en la tarjeta (ver ListPdtBucketCompanies en el backend). Con búsqueda por
 * razón social/RUC y paginación, igual que los listados de PDT 601/621. */
function PdtBucketCompaniesModal({
  open,
  filters,
  base,
  onClose,
}: {
  open: OpenBucket;
  filters: PdtDashboardFilters;
  base: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SupervisorPdtBucketCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debouncedQ = useBucketModalDebouncedValue(q, 400);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, open.declarationType, open.bucket]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    supervisorsService
      .pdtBucketCompanies({
        period_ym: filters.periodYm,
        declaration_type: open.declarationType,
        bucket: open.bucket,
        general_status: filters.generalStatus,
        risk_level: filters.riskLevel,
        company_id: filters.companyId ? Number(filters.companyId) : undefined,
        responsible_user_id: filters.responsibleUserId ? Number(filters.responsibleUserId) : undefined,
        supervisor_user_id: filters.supervisorUserId ? Number(filters.supervisorUserId) : undefined,
        q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
        page,
        per_page: BUCKET_MODAL_PAGE_SIZE,
      })
      .then(({ items, pagination }) => {
        if (!active) return;
        setRows(items);
        setTotal(pagination?.total ?? items.length);
      })
      .catch((err) => {
        if (active) setError(extractApiErrorMessage(err, 'No se pudo cargar la lista de empresas.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    open.declarationType,
    open.bucket,
    filters.periodYm,
    filters.generalStatus,
    filters.riskLevel,
    filters.companyId,
    filters.responsibleUserId,
    filters.supervisorUserId,
    debouncedQ,
    page,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const declarationLabel = open.declarationType === 'pdt_601' ? 'PDT 601' : 'PDT 621';
  const detailSlug = open.declarationType === 'pdt_601' ? 'pdt-601' : 'pdt-621';
  const totalPages = Math.max(1, Math.ceil(total / BUCKET_MODAL_PAGE_SIZE));

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${declarationLabel} — ${open.label}`}
        className="relative flex w-full max-w-3xl h-[min(85vh,820px)] flex-col rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-800">
              {declarationLabel} — {open.label}
            </p>
            <p className="text-xs text-slate-500">
              Período {filters.periodYm} · {total} {total === 1 ? 'empresa' : 'empresas'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>
        <div className="shrink-0 px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por RUC o razón social…"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-slate-500">Cargando empresas…</p>
          ) : error ? (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <i className="fas fa-exclamation-circle text-xs" aria-hidden />
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {q.trim().length >= 2 ? 'No hay empresas que coincidan con la búsqueda.' : 'No hay empresas en este estado.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.company_id} className="py-2.5">
                  <Link
                    to={`${base}/${detailSlug}/${row.company_id}?period_ym=${filters.periodYm}`}
                    onClick={onClose}
                    className="flex items-center justify-between gap-3 text-sm text-slate-700 hover:text-primary-700"
                  >
                    <span className="min-w-0 truncate">{row.business_name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{row.ruc}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!loading && !error && total > BUCKET_MODAL_PAGE_SIZE ? (
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              Página {page} de {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
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
        {hint ? <i className="fas fa-circle-info text-2xs text-slate-300" aria-hidden /> : null}
      </div>
      <p className="text-2xl font-semibold text-slate-800">{value}</p>
    </div>
  );
}


export default SupervisorDashboard;
