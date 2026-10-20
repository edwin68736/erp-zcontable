import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SearchableSelect from '../../components/SearchableSelect';
import {
  Card,
  ColumnsLegend,
  DASH_COLORS,
  Donut,
  DonutLegend,
  HeroGauge,
  KpiTile,
  RankBars,
  StackedColumns,
  TrendArea,
  type ColumnDatum,
  type DonutSlice,
  type RankDatum,
} from '../../components/supervisors/dashboard/DashboardParts';
import SupervisorIndicatorsPanel from '../../components/supervisors/dashboard/SupervisorIndicators';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { companiesService } from '../../services/companies';
import {
  supervisorsService,
  type ComplianceSummary,
  type ComplianceTrendPoint,
  type DashboardEntityRow,
  type DashboardModuleRow,
  type DashboardOverview,
  type DashboardReviewItem,
  type SupervisorDashboardData,
} from '../../services/supervisors';
import { usersService } from '../../services/users';
import type { Company, User } from '../../types/dashboard';
import { extractApiErrorMessage } from '../../utils/apiError';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';

const MONTH_ABBR = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.slice(5, 7)) - 1] ?? ym;

const MODULE_PATH: Record<string, string> = {
  pdt_601: 'pdt-601',
  pdt_621: 'pdt-621',
  informe_detracciones: 'informe-detracciones',
  siscont_balances: 'siscont-balances',
};

const MODULE_COLORS = ['#2563EB', '#0E8F47', '#F59E0B', '#8B5CF6', '#0891B2', '#DB2777', '#64748B'];
const SUP_COLORS = ['#0E8F47', '#2563EB', '#C2410C', '#7C3AED', '#0891B2', '#DB2777'];

const base = (cs: ComplianceSummary) => cs.total - cs.exempt;
const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const toColumn = (name: string, cs: ComplianceSummary, faded?: boolean): ColumnDatum => {
  const b = base(cs);
  return { name, ok: pctOf(cs.on_time + cs.late, b), pend: pctOf(cs.pending, b), over: pctOf(cs.missing, b), faded };
};
const toRank = (name: string, cs: ComplianceSummary, tone?: RankDatum['tone'], separated?: boolean): RankDatum => ({
  name,
  pct: cs.compliance_pct,
  frac: `${cs.on_time}/${cs.on_time + cs.late + cs.missing}`,
  tone,
  separated,
});
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

function deltaText(series: number[], unit = '', goodWhenUp = true): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } | undefined {
  if (series.length < 2) return undefined;
  const d = series[series.length - 1] - series[series.length - 2];
  if (d === 0) return { text: '= vs. período anterior', tone: 'neutral' };
  const up = d > 0;
  const good = up === goodWhenUp;
  return { text: `${up ? '▲ +' : '▼ −'}${Math.abs(Math.round(d * 10) / 10)}${unit}`, tone: good ? 'good' : 'bad' };
}

type AlertItem = { key: string; title: string; text?: string; color: string; soft: string; icon: string; to?: string };

function FilterChip({ label, children, locked }: { label: string; children: ReactNode; locked?: boolean }) {
  return (
    <label
      className={`flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] px-[10px] py-[3px] text-xs ${locked ? 'bg-slate-100 text-slate-600' : 'bg-white'}`}
    >
      <span className="text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const SELECT_CLS = 'border-0 bg-transparent py-[3px] pr-1 text-xs font-bold text-slate-900 outline-none';

const SupervisorDashboardView = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsDashboardView), []);
  const isStudio = useMemo(() => auth.hasPermission(P.accessStudio), []);
  const canPickCompanies = useMemo(() => auth.hasPermission(P.companiesView), []);
  const canPickUsers = useMemo(() => auth.hasPermission(P.usersView), []);
  const canApprove = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsApprove), []);
  const me = auth.getUser();

  const isAnalistaScope = useMemo(
    () => auth.hasPermission(P.supervisorsControlsUpdate) && !auth.hasPermission(P.supervisorsDeclarationsApprove),
    [],
  );

  const [periodYm, setPeriodYm] = useState(previousMonthPeriodYM());
  const [generalStatus, setGeneralStatus] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [companyId, setCompanyId] = useState('');
  // Un analista (sin aprobación) ve siempre sus propios controles: el filtro nace ya aplicado para no
  // pedir los datos dos veces (una sin filtro y otra con él).
  const [responsibleUserId, setResponsibleUserId] = useState(() => (isAnalistaScope && me?.id ? String(me.id) : ''));
  const [supervisorUserId, setSupervisorUserId] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [data, setData] = useState<SupervisorDashboardData | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [supervisorChips, setSupervisorChips] = useState<DashboardEntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [error, setError] = useState('');
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!allowed) return;
    const tasks: Promise<void>[] = [];
    if (canPickCompanies) tasks.push(companiesService.list({ status: 'activo' }).then(setCompanies).catch(() => setCompanies([])));
    if (canPickUsers) tasks.push(usersService.list().then(setUsers).catch(() => setUsers([])));
    void Promise.all(tasks);
  }, [allowed, canPickCompanies, canPickUsers]);

  const params = useMemo(
    () => ({
      period_ym: periodYm,
      general_status: generalStatus || undefined,
      risk_level: riskLevel || undefined,
      company_id: companyId ? Number(companyId) : undefined,
      responsible_user_id: responsibleUserId ? Number(responsibleUserId) : undefined,
      supervisor_user_id: supervisorUserId ? Number(supervisorUserId) : undefined,
    }),
    [periodYm, generalStatus, riskLevel, companyId, responsibleUserId, supervisorUserId],
  );

  // Dos cargas independientes: los totales (rápidos) aparecen enseguida y el detalle pesado (cola por
  // revisar, módulos, por supervisor/asistente) se completa cuando llega. Se descartan respuestas
  // viejas si los filtros cambian varias veces seguidas.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void supervisorsService
      .dashboard(params)
      .then((d) => {
        if (!cancelled) setData(d);
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
  }, [allowed, params, reloadKey]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setOverviewLoading(true);
    void supervisorsService
      .dashboardOverview(params)
      .then((o) => {
        if (cancelled) return;
        setOverview(o);
        // La lista de supervisores para "Ver como" se toma de la vista sin filtrar por supervisor.
        if (!params.supervisor_user_id && o.by_supervisor.length > 0) setSupervisorChips(o.by_supervisor);
      })
      .catch(() => {
        if (!cancelled) setOverview(null);
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, params, reloadKey]);

  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: String(c.id), label: c.business_name || c.ruc || `#${c.id}`, searchText: [c.ruc, c.code].filter(Boolean).join(' ') })),
    [companies],
  );
  const userOptions = useMemo(
    () => users.map((u) => ({ value: String(u.id), label: u.name || u.username || `#${u.id}`, searchText: [u.username, u.email].filter(Boolean).join(' ') })),
    [users],
  );

  const handleApprove = async (item: DashboardReviewItem) => {
    if (!canApprove || approvingId) return;
    if (!window.confirm(`¿Aprobar la entrega de ${item.company} (${item.module_label})?`)) return;
    try {
      setApprovingId(item.declaration_id);
      setActionMsg('');
      await supervisorsService.approveDeclaration(item.declaration_id);
      setActionMsg(`Entrega de ${item.company} aprobada.`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setActionMsg(extractApiErrorMessage(err, 'No se pudo aprobar.'));
    } finally {
      setApprovingId(null);
    }
  };

  if (!allowed) {
    return <p className="p-6 text-center text-slate-600">No tiene permiso para ver el dashboard de supervisores.</p>;
  }

  // Vista del estudio completo (administrador sin elegir supervisor) o "mi cartera" (un supervisor,
  // o el administrador viendo como un supervisor concreto).
  const studioView = isStudio && !supervisorUserId;
  const viewedSupervisor = supervisorChips.find((s) => String(s.user_id) === supervisorUserId);

  const trend: ComplianceTrendPoint[] = overview?.trend ?? [];
  const studioTrend: ComplianceTrendPoint[] = overview?.studio_trend ?? [];
  const bd = data?.compliance_breakdown;
  const compliancePct = data?.monthly_compliance_pct ?? 0;
  const lastStudio = studioTrend[studioTrend.length - 1];
  const series = (k: 'on_time' | 'pending' | 'missing') => trend.map((t) => t[k] ?? 0);

  const distribution: DonutSlice[] = bd
    ? [
        { label: 'Cumplido a tiempo', value: bd.on_time, color: DASH_COLORS.ok },
        { label: 'Entregado fuera de fecha', value: bd.late, color: DASH_COLORS.late },
        { label: 'Vencido sin entregar', value: bd.missing, color: DASH_COLORS.over },
        { label: 'Pendiente (sin vencer)', value: bd.pending, color: DASH_COLORS.pend },
        { label: 'Exento o no aplica', value: bd.exempt, color: DASH_COLORS.exempt },
      ]
    : [];

  const modules: DashboardModuleRow[] = overview?.modules ?? [];
  const moduleSlices: DonutSlice[] = modules.map((m, i) => ({ label: m.label, value: m.sin_completar, color: MODULE_COLORS[i % MODULE_COLORS.length] }));
  const modulesTotal = modules.reduce((a, m) => a + m.sin_completar, 0);
  const sumMod = (k: 'pendiente' | 'observado' | 'vencido' | 'a_tiempo' | 'fuera_fecha' | 'total') => modules.reduce((a, m) => a + m[k], 0);

  const bySup = overview?.by_supervisor ?? [];
  const byAssist = overview?.by_assistant ?? [];

  const columns: ColumnDatum[] = studioView
    ? bySup.map((s) => toColumn(s.name, s.compliance))
    : [
        ...byAssist.map((a) => toColumn(a.name, a.compliance)),
        ...(lastStudio
          ? [
              toColumn(
                'Estudio',
                { on_time: lastStudio.on_time ?? 0, late: lastStudio.late ?? 0, missing: lastStudio.missing ?? 0, pending: lastStudio.pending ?? 0, exempt: lastStudio.exempt ?? 0, total: lastStudio.total_controls, compliance_pct: lastStudio.compliance_pct },
                true,
              ),
            ]
          : []),
      ];

  const ranking: RankDatum[] = studioView
    ? [...bySup].sort((a, b) => b.compliance.compliance_pct - a.compliance.compliance_pct).map((s) => toRank(s.name, s.compliance))
    : [
        ...[...byAssist].sort((a, b) => b.compliance.compliance_pct - a.compliance.compliance_pct).map((a) => toRank(a.name, a.compliance)),
        ...(bd ? [toRank('Mi cartera', bd, 'mine', true)] : []),
        ...(lastStudio
          ? [
              toRank(
                'Prom. estudio',
                { on_time: lastStudio.on_time ?? 0, late: lastStudio.late ?? 0, missing: lastStudio.missing ?? 0, pending: lastStudio.pending ?? 0, exempt: lastStudio.exempt ?? 0, total: lastStudio.total_controls, compliance_pct: lastStudio.compliance_pct },
                'ref',
              ),
            ]
          : []),
      ];

  const heroDelta = deltaText(trend.map((t) => t.compliance_pct), ' pts');
  const heroLine1 = studioView
    ? `${heroDelta ? `${heroDelta.text} vs. período anterior` : 'Cumplimiento del período'}`
    : lastStudio
      ? `${compliancePct >= lastStudio.compliance_pct ? '▲ +' : '▼ −'}${Math.abs(Math.round((compliancePct - lastStudio.compliance_pct) * 10) / 10)} pts sobre el estudio (${lastStudio.compliance_pct}%)`
      : 'Cumplimiento del período';
  const heroLine2 = studioView ? 'a tiempo ÷ controles sin exentos' : heroDelta ? `${heroDelta.text} vs. período anterior` : undefined;

  const onTimeDelta = deltaText(series('on_time'), '', true);
  const pendingDelta = deltaText(series('pending'), '', false);
  const missingDelta = deltaText(series('missing'), '', false);

  // ---- Alertas ----
  const alerts: AlertItem[] = [];
  const review = overview?.review;
  const scope = overview?.scope;
  if (studioView && scope && scope.without_supervisor > 0) {
    alerts.push({ key: 'sin-sup', title: `${scope.without_supervisor} empresas activas sin supervisor`, text: 'Asígnalas para que aparezcan en algún dashboard.', color: '#DC2626', soft: '#FEF2F2', icon: 'fas fa-exclamation-triangle', to: '/supervisors/companies' });
  }
  if (studioView && bySup.length > 1) {
    const worst = [...bySup].sort((a, b) => b.compliance.missing / Math.max(base(b.compliance), 1) - a.compliance.missing / Math.max(base(a.compliance), 1))[0];
    if (worst && worst.compliance.missing > 0) {
      alerts.push({ key: 'worst', title: `${worst.name}: ${worst.compliance.missing} controles vencidos`, text: `${Math.round(pctOf(worst.compliance.missing, base(worst.compliance)))}% de su cartera, la más alta del estudio.`, color: '#B45309', soft: '#FFF7E6', icon: 'fas fa-clock' });
    }
  }
  if (review && review.over_3_days > 0) {
    alerts.push({ key: 'rev3', title: `${review.over_3_days} entregas por revisar con +3 días`, text: studioView ? 'Llevan varios días sin revisión del supervisor.' : 'Tus asistentes esperan tu visto bueno.', color: '#4338CA', soft: '#EEF2FF', icon: 'fas fa-clipboard-check' });
  }
  if ((data?.declarations_observed ?? 0) > 0) {
    alerts.push({ key: 'obs', title: `${data?.declarations_observed} declaraciones observadas`, text: 'Esperan la corrección del asistente.', color: '#DC2626', soft: '#FEF2F2', icon: 'fas fa-exclamation-circle' });
  }
  if ((data?.companies_without_control ?? 0) > 0) {
    alerts.push({ key: 'noctl', title: `${data?.companies_without_control} empresas sin control en ${periodYm}`, text: 'Abre el control del período para medirlas.', color: '#7C3AED', soft: '#F5F3FF', icon: 'fas fa-plus-circle' });
  }
  (data?.alerts ?? []).slice(0, 2).forEach((a, i) => {
    alerts.push({ key: `be-${i}`, title: a.message, color: '#B45309', soft: '#FFF7E6', icon: 'fas fa-bell', to: a.control_id ? `/supervisors/controls/${a.control_id}` : undefined });
  });

  const maxReview = Math.max(1, ...bySup.map((s) => s.review));
  const topPending = [...byAssist]
    .map((a) => ({ ...a, open: a.compliance.pending + a.compliance.missing, done: a.compliance.on_time + a.compliance.late }))
    .sort((a, b) => b.open - a.open)
    .slice(0, 5);

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      {/* título + filtros en una franja */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-[280px] flex-1">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h1 className="m-0 text-[26px] font-extrabold tracking-tight text-slate-900">Dashboard Supervisores</h1>
            {studioView ? (
              <span className="rounded-full border border-[#BFE5CF] bg-[#E3F5EA] px-[10px] py-[2px] text-[11.5px] font-bold text-[#0A5A3A]">Vista del estudio</span>
            ) : (
              <span className="inline-flex items-center gap-[5px] rounded-full border border-indigo-200 bg-indigo-100 px-[10px] py-[2px] text-[11.5px] font-bold text-indigo-800">
                <i className="fas fa-lock text-[9px]" aria-hidden />
                {isStudio && viewedSupervisor ? `Vista de ${viewedSupervisor.name}` : 'Mi cartera'}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-slate-600">
            {scope ? (
              <>
                <strong className="text-slate-900">
                  {studioView ? `${scope.supervisors} supervisores · ` : ''}
                  {scope.assistants} asistentes · {scope.companies} empresas
                </strong>{' '}
                · período {periodYm}
              </>
            ) : (
              <>Cumplimiento, avance y alertas del período contable.</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip label="Período">
            <input type="month" value={periodYm} onChange={(e) => setPeriodYm(e.target.value)} className={SELECT_CLS} />
          </FilterChip>
          {canPickCompanies ? (
            <FilterChip label="Empresa">
              <div className="min-w-[150px]">
                <SearchableSelect value={companyId} onChange={setCompanyId} options={[{ value: '', label: 'Todas' }, ...companyOptions]} placeholder="Todas" />
              </div>
            </FilterChip>
          ) : null}
          {isStudio ? (
            <FilterChip label="Supervisor">
              <select value={supervisorUserId} onChange={(e) => setSupervisorUserId(e.target.value)} className={SELECT_CLS}>
                <option value="">Todos</option>
                {supervisorChips.map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FilterChip>
          ) : (
            <FilterChip label="Supervisor" locked>
              <strong>{me?.name || me?.username || 'Tú'} (tú)</strong>
              <i className="fas fa-lock text-[9px] text-slate-400" aria-hidden />
            </FilterChip>
          )}
          {canPickUsers ? (
            <FilterChip label="Responsable">
              <div className="min-w-[130px]">
                <SearchableSelect value={responsibleUserId} onChange={setResponsibleUserId} options={[{ value: '', label: 'Todos' }, ...userOptions]} placeholder="Todos" />
              </div>
            </FilterChip>
          ) : null}
          <FilterChip label="Estado">
            <select value={generalStatus} onChange={(e) => setGeneralStatus(e.target.value)} className={SELECT_CLS}>
              <option value="">Todos</option>
              <option value="al_dia">Al día</option>
              <option value="pendiente">Pendiente</option>
              <option value="vencido">Vencido</option>
              <option value="observado">Observado</option>
            </select>
          </FilterChip>
          <FilterChip label="Riesgo">
            <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className={SELECT_CLS}>
              <option value="">Todos</option>
              <option value="bajo">Bajo</option>
              <option value="medio">Medio</option>
              <option value="alto">Alto</option>
              <option value="critico">Crítico</option>
            </select>
          </FilterChip>
        </div>
      </div>

      {/* ver como (solo administrador) / alcance (supervisor) */}
      {isStudio ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DCE8E1] bg-white px-3 py-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.6px] text-slate-500">Ver como</span>
          <button
            type="button"
            aria-pressed={!supervisorUserId}
            onClick={() => setSupervisorUserId('')}
            className={`rounded-lg border px-3 py-[5px] text-xs font-bold ${!supervisorUserId ? 'border-[1.5px] border-[#0E8F47] bg-[#E3F5EA] text-[#0A5A3A]' : 'border-[#DCE8E1] bg-white font-semibold text-slate-700'}`}
          >
            Estudio completo
          </button>
          {supervisorChips.map((s, i) => (
            <button
              key={s.user_id}
              type="button"
              aria-pressed={String(s.user_id) === supervisorUserId}
              onClick={() => setSupervisorUserId(String(s.user_id))}
              className={`flex items-center gap-[7px] rounded-lg border px-[11px] py-[5px] text-xs ${String(s.user_id) === supervisorUserId ? 'border-[1.5px] border-[#0E8F47] bg-[#E3F5EA] font-bold text-[#0A5A3A]' : 'border-[#DCE8E1] bg-white font-semibold text-slate-700'}`}
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9px] font-extrabold text-white" style={{ background: SUP_COLORS[i % SUP_COLORS.length] }}>
                {initials(s.name)}
              </span>
              {s.name}
            </button>
          ))}
          <span className="ml-auto text-[11.5px] text-slate-500">Elegir un supervisor muestra su dashboard tal como él lo ve.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#D9DEFB] bg-[#F3F5FF] px-3 py-2">
          <i className="fas fa-lock text-[12px] text-indigo-800" aria-hidden />
          <span className="text-xs text-indigo-950">
            <strong>Solo ves lo tuyo:</strong> las empresas que el administrador te asignó y el trabajo de tus asistentes. Del resto del estudio solo se muestra el promedio, para compararte.
          </span>
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : data ? (
        <>
          {/* KPIs */}
          <div className="flex flex-wrap gap-3">
            <HeroGauge pct={compliancePct} title={studioView ? 'Cumplimiento general' : 'Tu cumplimiento'} line1={heroLine1} line2={heroLine2} />
            <KpiTile
              label={studioView ? 'Empresas activas' : 'Mis empresas activas'}
              value={data.total_active_companies}
              delta={`${data.companies_without_control ?? 0} sin control`}
              deltaTone={(data.companies_without_control ?? 0) > 0 ? 'warn' : 'neutral'}
              sub="en el período"
              icon="fas fa-building"
              color="#0369A1"
              soft="#FFFFFF"
              tint="#E0F2FE"
              tintBorder="#BAE6FD"
            />
            <KpiTile label="Cumplidos a tiempo" value={bd?.on_time ?? 0} delta={onTimeDelta?.text} deltaTone={onTimeDelta?.tone} sub="controles entregados a tiempo" icon="fas fa-check" color="#12A150" soft="#FFFFFF" tint="#DCFCE7" tintBorder="#BBF7D0" spark={series('on_time')} />
            <KpiTile label="Controles pendientes" value={bd?.pending ?? 0} delta={pendingDelta?.text} deltaTone={pendingDelta?.tone} sub="sin vencer todavía" icon="fas fa-clock" color="#B45309" soft="#FFFFFF" tint="#FEF3C7" tintBorder="#FDE68A" spark={series('pending')} />
            <KpiTile label="Controles vencidos" value={bd?.missing ?? 0} delta={missingDelta?.text} deltaTone={missingDelta?.tone} sub="sin entregar fuera de plazo" icon="fas fa-exclamation-triangle" color="#DC2626" soft="#FFFFFF" tint="#FEE2E2" tintBorder="#FECACA" spark={series('missing')} />
            <KpiTile
              label={studioView ? 'Por revisar' : 'Por revisar (tu cola)'}
              value={overviewLoading ? "…" : (review?.total ?? 0)}
              delta={`${review?.over_3_days ?? 0} con +3 días`}
              deltaTone={(review?.over_3_days ?? 0) > 0 ? 'warn' : 'neutral'}
              sub={`${review?.observed ?? 0} observadas en total`}
              icon="fas fa-clipboard-check"
              color="#4338CA"
              soft="#FFFFFF"
              tint="#E0E7FF"
              tintBorder="#C7D2FE"
            />
          </div>

          <div className="flex flex-wrap items-start gap-[14px]">
            {/* ===== principal ===== */}
            <div className="flex min-w-0 flex-col gap-[14px]" style={{ flex: '2.3 1 600px' }}>
              <Card className="flex flex-wrap gap-x-[22px] gap-y-4">
                <div className="min-w-0" style={{ flex: '1 1 280px' }}>
                  <h2 className="m-0 text-sm font-extrabold">Distribución de cumplimiento</h2>
                  <p className="mb-[10px] mt-[2px] text-[11.5px] text-slate-500">
                    {bd?.total ?? 0} controles · {studioView ? 'todo el estudio' : 'mi cartera'}
                  </p>
                  <div className="flex items-center gap-[14px]">
                    <Donut slices={distribution} center={bd?.total ?? 0} caption="controles" label="Distribución de cumplimiento" />
                    <DonutLegend slices={distribution} />
                  </div>
                </div>
                <div className="min-w-0 border-l border-[#EAF1ED] pl-[22px]" style={{ flex: '1.2 1 320px' }}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="m-0 text-sm font-extrabold">{studioView ? 'Avance por supervisor' : 'Avance por asistente'}</h2>
                      <p className="m-0 mt-[2px] text-[11.5px] text-slate-500">% de controles por estado{studioView ? ' · solo admin' : ' · vs. estudio'}</p>
                    </div>
                  </div>
                  <ColumnsLegend />
                  {columns.length > 0 ? <StackedColumns cols={columns} /> : <p className="py-8 text-center text-xs text-slate-500">{overviewLoading ? "Cargando…" : "Sin datos para este alcance."}</p>}
                </div>
              </Card>

              <Card className="flex flex-wrap gap-x-[22px] gap-y-4">
                <div className="min-w-0" style={{ flex: '1.1 1 320px' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="m-0 text-sm font-extrabold">{studioView ? 'Tendencia de cumplimiento (6 meses)' : 'Mi cumplimiento vs. estudio (6 meses)'}</h2>
                    {heroDelta ? (
                      <span className="rounded-[7px] px-2 py-[2px] text-[11px] font-bold" style={{ background: heroDelta.tone === 'good' ? '#E3F5EA' : '#FEE2E2', color: heroDelta.tone === 'good' ? '#0A5A3A' : '#B91C1C' }}>
                        {heroDelta.text}
                      </span>
                    ) : null}
                  </div>
                  {!studioView ? (
                    <div className="mt-[6px] flex gap-[14px] text-[11px] text-slate-600">
                      <span className="flex items-center gap-[6px]"><span className="h-[3px] w-[18px] rounded bg-[#0E8F47]" />Mi cartera</span>
                      <span className="flex items-center gap-[6px]"><span className="w-[18px] border-t-2 border-dashed border-slate-500" />Promedio del estudio</span>
                    </div>
                  ) : null}
                  <TrendArea
                    points={trend.map((t) => ({ label: monthLabel(t.period_ym), value: t.compliance_pct }))}
                    compare={!studioView ? studioTrend.map((t) => t.compliance_pct) : undefined}
                  />
                </div>
                <div className="min-w-0 border-l border-[#EAF1ED] pl-[22px]" style={{ flex: '1 1 280px' }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="m-0 text-sm font-extrabold">{studioView ? 'Top supervisores por cumplimiento' : 'Mis asistentes por cumplimiento'}</h2>
                    <span className="text-[10.5px] text-slate-500">Cumplimiento</span>
                  </div>
                  {ranking.length > 0 ? <RankBars rows={ranking} /> : <p className="py-8 text-center text-xs text-slate-500">{overviewLoading ? "Cargando…" : "Sin datos para este alcance."}</p>}
                  {studioView && bd ? (
                    <p className="mb-0 mt-[14px] border-t border-[#EAF1ED] pt-2 text-[11px] text-slate-500">
                      Promedio del estudio: <strong className="text-slate-900">{compliancePct}%</strong>
                    </p>
                  ) : null}
                </div>
              </Card>

              <Card className="flex flex-wrap gap-x-[22px] gap-y-4">
                <div className="min-w-[230px]" style={{ flex: '0 1 250px' }}>
                  <h2 className="m-0 text-sm font-extrabold">Sin completar por módulo</h2>
                  <p className="mb-[10px] mt-[2px] text-[11.5px] text-slate-500">Pendientes, observados y vencidos</p>
                  <div className="flex justify-center">
                    <Donut slices={moduleSlices} size={112} center={modulesTotal.toLocaleString('es-PE')} caption="sin completar" label="Controles sin completar por módulo" />
                  </div>
                  <div className="mt-3">
                    <DonutLegend slices={moduleSlices} showPct small />
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden" style={{ flex: '1 1 340px' }}>
                  <h2 className="mb-[10px] mt-0 text-sm font-extrabold">Resumen por módulo</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[340px] border-collapse text-[11.5px]">
                      <thead>
                        <tr className="text-center text-[10px] uppercase tracking-[0.2px] text-slate-500">
                          <th scope="col" className="rounded-l-md bg-[#F1F6F3] px-[6px] py-[6px] text-left">Módulo</th>
                          <th scope="col" className="bg-amber-100 px-[3px] py-[6px] text-amber-800">Pend.</th>
                          <th scope="col" className="bg-orange-100 px-[3px] py-[6px] text-orange-800">Obs.</th>
                          <th scope="col" className="bg-red-100 px-[3px] py-[6px] text-red-800">Venc.</th>
                          <th scope="col" className="bg-green-100 px-[3px] py-[6px] text-green-800">A tiem.</th>
                          <th scope="col" className="bg-blue-100 px-[3px] py-[6px] text-blue-800">Fuera</th>
                          <th scope="col" className="rounded-r-md bg-[#F1F6F3] px-[6px] py-[6px]">Total</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {modules.length === 0 ? (
                          <tr><td colSpan={7} className="py-6 text-center text-slate-500">{overviewLoading ? "Cargando…" : "Sin datos para este alcance."}</td></tr>
                        ) : null}
                        {modules.map((m) => (
                          <tr key={m.key} className="border-b border-[#EAF1ED] text-center">
                            <th scope="row" className="px-[6px] py-[7px] text-left font-bold">{m.label}</th>
                            <td className="px-[3px] py-[7px] font-bold text-amber-700">{m.pendiente}</td>
                            <td className="px-[3px] py-[7px] font-bold text-orange-700">{m.observado}</td>
                            <td className="px-[3px] py-[7px] font-bold text-red-700">{m.vencido}</td>
                            <td className="px-[3px] py-[7px] font-bold text-green-700">{m.a_tiempo}</td>
                            <td className="px-[3px] py-[7px] font-bold text-blue-700">{m.fuera_fecha}</td>
                            <td className="px-[6px] py-[7px] font-extrabold">{m.total}</td>
                          </tr>
                        ))}
                        <tr className="bg-[#F6FAF8] text-center font-extrabold">
                          <th scope="row" className="px-[6px] py-2 text-left">Total</th>
                          <td className="px-[3px] py-2">{sumMod('pendiente')}</td>
                          <td className="px-[3px] py-2">{sumMod('observado')}</td>
                          <td className="px-[3px] py-2">{sumMod('vencido')}</td>
                          <td className="px-[3px] py-2">{sumMod('a_tiempo')}</td>
                          <td className="px-[3px] py-2">{sumMod('fuera_fecha')}</td>
                          <td className="px-[6px] py-2">{sumMod('total')}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>
            </div>

            {/* ===== riel lateral ===== */}
            <aside className="flex min-w-0 max-w-[380px] flex-col gap-[14px]" style={{ flex: '1 1 300px' }}>
              {!studioView ? (
                <Card accent="#4338CA">
                  <div className="mb-1 flex items-center justify-between">
                    <h2 className="m-0 text-sm font-extrabold">
                      Por revisar ahora <span className="ml-[5px] rounded-[7px] bg-indigo-100 px-2 py-px text-[11.5px] text-indigo-800">{review?.total ?? 0}</span>
                    </h2>
                  </div>
                  <p className="mb-2 mt-0 text-[11px] text-slate-500">Entregas de tus asistentes esperando tu visto bueno.</p>
                  {actionMsg ? <p className="mb-2 text-[11px] font-semibold text-[#0A5A3A]">{actionMsg}</p> : null}
                  {(review?.items.length ?? 0) === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-500">{overviewLoading ? "Cargando…" : "No hay entregas por revisar."}</p>
                  ) : (
                    <div className="flex flex-col">
                      {review?.items.map((q) => {
                        const slug = MODULE_PATH[q.module_key];
                        const to = slug ? `/supervisors/activities/${slug}/${q.company_id}?period_ym=${encodeURIComponent(periodYm)}` : undefined;
                        const tl = q.timeliness === 'on_time' ? { t: 'A tiempo', c: '#0A5A3A' } : q.timeliness === 'late' ? { t: 'Fuera de fecha', c: '#1D4ED8' } : { t: 'Sin regla', c: '#64748B' };
                        return (
                          <div key={q.declaration_id} className="flex items-center gap-2 border-t border-[#EAF1ED] py-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-bold" title={q.company}>{q.company}</div>
                              <div className="mt-px text-[10.5px] text-slate-500">
                                {q.module_label} · {q.assistant || '—'} ·{' '}
                                <span className={q.age_days > 3 ? 'font-bold text-amber-700' : ''}>{q.age_days === 0 ? 'hoy' : `hace ${q.age_days} d`}</span> ·{' '}
                                <span className="font-bold" style={{ color: tl.c }}>{tl.t}</span>
                              </div>
                            </div>
                            {to ? (
                              <Link to={to} className="rounded-[7px] border border-slate-300 bg-white px-[9px] py-[5px] text-[11px] font-bold text-slate-700 hover:bg-slate-50">Ver</Link>
                            ) : null}
                            {canApprove ? (
                              <button
                                type="button"
                                disabled={approvingId === q.declaration_id}
                                onClick={() => void handleApprove(q)}
                                className="rounded-[7px] border border-[#0E8F47] bg-[#0E8F47] px-[9px] py-[5px] text-[11px] font-bold text-white hover:bg-[#0A7A3B] disabled:opacity-50"
                              >
                                {approvingId === q.declaration_id ? '…' : 'Aprobar'}
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              ) : null}

              <Card>
                <div className="mb-[10px] flex items-center justify-between">
                  <h2 className="m-0 text-sm font-extrabold">Alertas del período</h2>
                  <Link to="/supervisors/reports" className="rounded-[7px] bg-[#E3F5EA] px-2 py-[3px] text-[10.5px] font-bold text-[#0A5A3A]">Ver reportes →</Link>
                </div>
                {alerts.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">Sin alertas para este período.</p>
                ) : (
                  <div className="flex flex-col gap-[7px]">
                    {alerts.slice(0, 5).map((a) => {
                      const inner = (
                        <>
                          <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] text-white" style={{ background: a.color }}>
                            <i className={`${a.icon} text-[10px]`} aria-hidden />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold leading-tight">{a.title}</div>
                            {a.text ? <div className="mt-px text-[11px] text-slate-600">{a.text}</div> : null}
                          </div>
                        </>
                      );
                      return a.to ? (
                        <Link key={a.key} to={a.to} className="flex items-start gap-[9px] rounded-[10px] px-[10px] py-2 hover:opacity-90" style={{ background: a.soft }}>{inner}</Link>
                      ) : (
                        <div key={a.key} className="flex items-start gap-[9px] rounded-[10px] px-[10px] py-2" style={{ background: a.soft }}>{inner}</div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {studioView ? (
                <>
                  <Card accent="#4338CA">
                    <div className="mb-[10px] flex items-center justify-between">
                      <h2 className="m-0 text-sm font-extrabold">
                        Por revisar <span className="ml-[5px] rounded-[7px] bg-indigo-100 px-2 py-px text-[11.5px] text-indigo-800">{review?.total ?? 0}</span>
                      </h2>
                      <span className="text-[10.5px] font-bold text-amber-700">{review?.over_3_days ?? 0} con +3 días</span>
                    </div>
                    {bySup.length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-500">{overviewLoading ? "Cargando…" : "Sin supervisores en este alcance."}</p>
                    ) : (
                      <div className="flex flex-col gap-[10px]">
                        {bySup.map((s, i) => (
                          <div key={s.user_id} className="flex items-center gap-[9px]">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9.5px] font-extrabold text-white" style={{ background: SUP_COLORS[i % SUP_COLORS.length] }}>{initials(s.name)}</div>
                            <div className="w-[76px] shrink-0 truncate text-xs font-bold" title={s.name}>{s.name}</div>
                            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-[#EEF3F0]"><div className="h-full rounded bg-indigo-500" style={{ width: `${(s.review / maxReview) * 100}%` }} /></div>
                            <div className="w-[22px] shrink-0 text-right text-[12.5px] font-extrabold tabular-nums">{s.review}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card>
                    <div className="mb-[10px] flex items-center justify-between">
                      <h2 className="m-0 text-sm font-extrabold">Asistentes con más pendientes</h2>
                      <span className="text-[10.5px] text-slate-500">pend. + vencidos</span>
                    </div>
                    {topPending.length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-500">{overviewLoading ? "Cargando…" : "Sin asistentes en este alcance."}</p>
                    ) : (
                      <div className="flex flex-col gap-[10px]">
                        {topPending.map((a) => {
                          const tot = a.open + a.done || 1;
                          return (
                            <div key={a.user_id}>
                              <div className="mb-[3px] flex justify-between text-xs">
                                <span><strong>{a.name}</strong> <span className="text-slate-500">· sup. {a.supervisor_name || '—'}</span></span>
                                <span className="tabular-nums"><strong className="text-amber-700">{a.open}</strong> <span className="text-slate-500">/ {a.open + a.done}</span></span>
                              </div>
                              <div className="flex h-[7px] overflow-hidden rounded bg-[#EEF3F0]">
                                <div style={{ width: `${(a.open / tot) * 100}%`, background: DASH_COLORS.pend }} />
                                <div style={{ width: `${(a.done / tot) * 100}%`, background: DASH_COLORS.ok }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-[10px] flex gap-3 text-[10.5px] text-slate-500">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: DASH_COLORS.pend }} />Sin completar</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: DASH_COLORS.ok }} />Completado</span>
                    </div>
                  </Card>
                </>
              ) : (
                <Card>
                  <div className="mb-[10px] flex items-center justify-between">
                    <h2 className="m-0 text-sm font-extrabold">Vencen pronto</h2>
                    <span className="text-[10.5px] text-slate-500">mis empresas sin entregar</span>
                  </div>
                  {overviewLoading ? (
                    <p className="py-3 text-center text-xs text-slate-500">Cargando…</p>
                  ) : (overview?.upcoming?.length ?? 0) === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-500">No hay vencimientos próximos con empresas pendientes.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {(overview?.upcoming ?? []).map((u) => {
                        const overdue = u.days_left < 0;
                        const soon = u.days_left <= 3;
                        const tone = overdue || u.days_left === 0 ? { c: '#B91C1C', s: '#FEE2E2' } : soon ? { c: '#B45309', s: '#FEF3C7' } : { c: '#1D4ED8', s: '#DBEAFE' };
                        const when = u.days_left === 0 ? 'Hoy' : u.days_left === 1 ? 'Mañana' : overdue ? `−${Math.abs(u.days_left)}` : String(u.days_left);
                        const unit = u.days_left <= 1 && u.days_left >= 0 ? '' : overdue ? 'días' : 'días';
                        return (
                          <div key={`${u.module_key}-${u.due_date}-${u.detail}`} className="flex items-center gap-[10px] rounded-[10px] border border-[#EAF1ED] px-[10px] py-[7px]">
                            <div className="w-[54px] shrink-0 rounded-lg px-[2px] py-[5px] text-center" style={{ background: tone.s, color: tone.c }}>
                              <div className="text-[13px] font-extrabold leading-tight">{when}</div>
                              {unit ? <div className="text-[9px] font-bold uppercase tracking-[0.3px]">{unit}</div> : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold">{u.label}</div>
                              <div className="text-[10.5px] text-slate-500">{u.detail ? `${u.detail} · ` : ''}{u.due_date}</div>
                            </div>
                            <div className="text-base font-extrabold tabular-nums">{u.pending}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              )}
            </aside>
          </div>
        </>
      ) : null}

      {/* Indicadores del libro mensual de supervisión (KPI por dígito de RUC y buzones por asistente) */}
      <SupervisorIndicatorsPanel params={params} reloadKey={reloadKey} />
    </div>
  );
};

export default SupervisorDashboardView;
