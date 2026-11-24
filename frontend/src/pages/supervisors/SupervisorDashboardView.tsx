import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ModuleCards from '../../components/assistant/ModuleCards';
import ModulePendingModal from '../../components/assistant/ModulePendingModal';
import { NO_FILTER, type DigitFilter } from '../../components/assistant/moduleDigits';
import SearchableSelect from '../../components/SearchableSelect';
import CompanyListModal, { type CompanyListItem } from '../../components/supervisors/dashboard/CompanyListModal';
import { Card, DASH_COLORS, HeroGauge, KpiTile, RankBars, type RankDatum } from '../../components/supervisors/dashboard/DashboardParts';
import { AvanceColumns, KpiCard, MailboxBars, Section, SummaryBox } from '../../components/supervisors/dashboard/ProgressSections';
import { groupTrend, mailboxCompanies, moduleKpi, type MailboxKind, type ModuleKpi, type TrendMode } from '../../components/supervisors/dashboard/progressUi';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { MODULE_SLUG } from '../../navigation/moduleSlugs';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { companiesService } from '../../services/companies';
import {
  supervisorsService,
  type AssistantModuleProgress,
  type AssistantModuleRow,
  type AssistantWorkItem,
  type DashboardEntityRow,
  type DashboardOverview,
  type DashboardProgress,
  type DashboardReviewItem,
  type IndicatorMailboxRow,
} from '../../services/supervisors';
import type { Company } from '../../types/dashboard';
import { extractApiErrorMessage } from '../../utils/apiError';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { confirmDialog } from '../../utils/confirmDialog';
import { notify } from '../../utils/notify';

const MODULE_PATH: Record<string, string> = {
  pdt_601: 'pdt-601',
  pdt_621: 'pdt-621',
  informe_detracciones: 'informe-detracciones',
  siscont_balances: 'siscont-balances',
};

const SUP_COLORS = ['#0E8F47', '#2563EB', '#C2410C', '#7C3AED', '#0891B2', '#DB2777'];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

type AlertItem = { key: string; title: string; text?: string; color: string; soft: string; icon: string; to?: string };

function FilterChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[3px] text-xs">
      <span className="text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const SELECT_CLS = 'border-0 bg-transparent py-[3px] pr-1 text-xs font-bold text-slate-900 outline-none';

/** «117 de 138 a tiempo · 40 por vencer»: lo que ya se puede medir y, aparte, lo que aún no vence. */
const kpiSub = (k: ModuleKpi, word: string): string | undefined => (k.total === 0 ? undefined : `${k.onTime} de ${k.due} ${word}${k.upcoming > 0 ? ` · ${k.upcoming} por vencer` : ''}`);

const TREND_MODES: { id: TrendMode; label: string }[] = [
  { id: 'mensual', label: 'Mensual' },
  { id: 'trimestral', label: 'Trimestral' },
  { id: 'semestral', label: 'Semestral' },
];

/**
 * Dashboard del supervisor. Mide con las MISMAS tareas y reglas que el panel del asistente (avance = tareas completadas ÷ tareas
 * que aplican; tablas por último dígito del RUC con dentro/fuera de plazo y pendientes), sobre su cartera. El administrador ve el
 * estudio completo o mira como un supervisor concreto.
 */
const SupervisorDashboardView = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsDashboardView), []);
  const isStudio = useMemo(() => auth.hasPermission(P.accessStudio), []);
  const canPickCompanies = useMemo(() => auth.hasPermission(P.companiesView), []);
  const canApprove = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsApprove), []);

  const [periodYm, setPeriodYm] = useState(previousMonthPeriodYM());
  const [companyId, setCompanyId] = useState('');
  const [supervisorUserId, setSupervisorUserId] = useState('');
  const [assistantUserId, setAssistantUserId] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [progress, setProgress] = useState<DashboardProgress | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [supervisorChips, setSupervisorChips] = useState<DashboardEntityRow[]>([]);
  const [assistantChips, setAssistantChips] = useState<DashboardEntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [error, setError] = useState('');
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [trendMode, setTrendMode] = useState<TrendMode>('mensual');
  /** Actividad cuyo modal de empresas está abierto, con el número que se pulsó (dígito y/o categoría). */
  const [moduleModal, setModuleModal] = useState<{ module: AssistantModuleProgress; filter: DigitFilter } | null>(null);
  const [listModal, setListModal] = useState<{ title: string; subtitle?: string; items: CompanyListItem[]; empty?: string } | null>(null);

  useEffect(() => {
    if (!allowed || !canPickCompanies) return;
    void companiesService
      .list({ status: 'activo' })
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [allowed, canPickCompanies]);

  const params = useMemo(
    () => ({
      period_ym: periodYm,
      company_id: companyId ? Number(companyId) : undefined,
      supervisor_user_id: supervisorUserId ? Number(supervisorUserId) : undefined,
      assistant_user_id: assistantUserId ? Number(assistantUserId) : undefined,
    }),
    [periodYm, companyId, supervisorUserId, assistantUserId],
  );

  // Dos cargas independientes: el avance (lo principal) y la cola por revisar con sus alertas. Se descartan respuestas viejas si los
  // filtros cambian varias veces seguidas.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void supervisorsService
      .dashboardProgress(params)
      .then((d) => {
        if (!cancelled) setProgress(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(extractApiErrorMessage(err, 'No se pudo cargar el dashboard de supervisores'));
        setProgress(null);
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
        if (!params.supervisor_user_id && !params.assistant_user_id && o.by_supervisor.length > 0) setSupervisorChips(o.by_supervisor);
        // Los asistentes del alcance (el del supervisor elegido, o los míos), sin filtrar por asistente para que elegir uno no borre a los demás.
        if (!params.assistant_user_id) setAssistantChips(o.by_assistant);
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

  const modules = useMemo(() => new Map((progress?.modules ?? []).map((m) => [m.key, m])), [progress]);
  const mPlanillas = modules.get('pdt_601');
  const mArchivadores = modules.get('pdt_621');
  const mDeclaracion = modules.get('pdt_621_declaracion');
  const mBalances = modules.get('siscont_balances');
  const k2 = useMemo(() => moduleKpi(mPlanillas), [mPlanillas]);
  const k3 = useMemo(() => moduleKpi(mArchivadores), [mArchivadores]);
  const k4 = useMemo(() => moduleKpi(mDeclaracion), [mDeclaracion]);
  const k5 = useMemo(() => moduleKpi(mBalances, { unusedWhenEmpty: true }), [mBalances]);
  const trendBars = useMemo(() => groupTrend(progress?.trend ?? [], trendMode), [progress, trendMode]);

  const closeModuleModal = useCallback(() => setModuleModal(null), []);
  const openModule = useCallback((module: AssistantModuleProgress | undefined, filter: DigitFilter) => {
    if (module) setModuleModal({ module, filter });
  }, []);
  const fetchDetail = useCallback(
    (moduleKey: string): Promise<AssistantModuleRow[]> => supervisorsService.dashboardModuleDetail({ ...params, period_ym: periodYm, module_key: moduleKey }).then((r) => r.rows),
    [params, periodYm],
  );
  const detailPath = (w: AssistantWorkItem) => {
    const slug = MODULE_SLUG[w.module_key];
    if (!slug) return '/supervisors/dashboard';
    return `/supervisors/activities/${slug}/${w.company_id}?period_ym=${encodeURIComponent(periodYm)}`;
  };

  const openMailbox = (row: IndicatorMailboxRow, kind: MailboxKind, state: 'late' | 'pending') => {
    const label = kind === 'sunat' ? 'SUNAT' : 'SUNAFIL';
    const what = state === 'late' ? 'subidas fuera de plazo' : 'pendientes';
    const list = mailboxCompanies(row, kind, state);
    setListModal({
      title: `Buzón ${label} · ${state === 'late' ? 'fuera de plazo' : 'pendientes'}`,
      subtitle: `${row.assistant} · ${list.length} ${list.length === 1 ? 'empresa' : 'empresas'} · periodo ${periodYm}`,
      items: list.map(({ company, count }) => ({
        key: company.company_id,
        company: company.company,
        ruc: company.ruc,
        detail: `${count} ${count === 1 ? 'captura' : 'capturas'} ${what}`,
        to: `/supervisors/activities/sunat-inbox/${company.company_id}?period_ym=${encodeURIComponent(periodYm)}`,
      })),
    });
  };

  const openSuspended = () => {
    const list = progress?.suspended ?? [];
    setListModal({
      title: 'Empresas suspendidas',
      subtitle: `${list.length} ${list.length === 1 ? 'empresa' : 'empresas'} · periodo ${periodYm}. No aplican en ninguna actividad.`,
      items: list.map((s) => ({ key: s.company_id, company: s.company, ruc: s.ruc, assistant: s.assistant })),
      empty: 'No hay empresas suspendidas en este periodo.',
    });
  };

  const handleApprove = async (item: DashboardReviewItem) => {
    if (!canApprove || approvingId) return;
    if (!(await confirmDialog({ message: `¿Aprobar la entrega de ${item.company} (${item.module_label})?`, confirmLabel: 'Aprobar' }))) return;
    try {
      setApprovingId(item.declaration_id);
      await supervisorsService.approveDeclaration(item.declaration_id);
      notify.fromMessage('success', `Entrega de ${item.company} aprobada.`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      notify.fromMessage('error', extractApiErrorMessage(err, 'No se pudo aprobar.'));
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
  const scope = overview?.scope;
  const review = overview?.review;
  const bySup = overview?.by_supervisor ?? [];
  const pr = progress?.progress;

  const ranking: RankDatum[] = (progress?.by_assistant ?? []).filter((a) => a.total > 0).map((a) => ({ name: a.name, pct: a.pct, frac: `${a.completed}/${a.total}` }));
  // Asistentes con más tareas sin completar (las que aplican y aún no se entregan).
  const topOpen = (progress?.by_assistant ?? [])
    .map((a) => ({ ...a, open: a.total - a.completed }))
    .filter((a) => a.total > 0)
    .sort((a, b) => b.open - a.open)
    .slice(0, 5);

  // ---- Alertas ----
  const alerts: AlertItem[] = [];
  if (studioView && scope && scope.without_supervisor > 0) {
    alerts.push({ key: 'sin-sup', title: `${scope.without_supervisor} empresas activas sin supervisor`, text: 'Asígnalas para que aparezcan en algún dashboard.', color: '#DC2626', soft: '#FEF2F2', icon: 'fas fa-exclamation-triangle', to: '/supervisors/companies' });
  }
  if (review && review.over_3_days > 0) {
    alerts.push({ key: 'rev3', title: `${review.over_3_days} entregas por revisar con +3 días`, text: studioView ? 'Llevan varios días sin revisión del supervisor.' : 'Tus asistentes esperan tu visto bueno.', color: '#4338CA', soft: '#EEF2FF', icon: 'fas fa-clipboard-check' });
  }
  if (review && review.observed > 0) {
    alerts.push({ key: 'obs', title: `${review.observed} entregas observadas`, text: 'Esperan la corrección del asistente.', color: '#DC2626', soft: '#FEF2F2', icon: 'fas fa-exclamation-circle' });
  }

  const maxReview = Math.max(1, ...bySup.map((s) => s.review));

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      {/* título + filtros en una franja */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-[280px] flex-1">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900">Dashboard Supervisores</h1>
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
                · periodo {periodYm}
              </>
            ) : (
              <>Avance y alertas del periodo contable.</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip label="Periodo">
            <input type="month" value={periodYm} onChange={(e) => setPeriodYm(e.target.value)} className={SELECT_CLS} />
          </FilterChip>
          {canPickCompanies ? (
            <FilterChip label="Empresa">
              <div className="min-w-[150px]">
                <SearchableSelect value={companyId} onChange={setCompanyId} options={[{ value: '', label: 'Todas' }, ...companyOptions]} placeholder="Todas" />
              </div>
            </FilterChip>
          ) : null}
          {assistantChips.length > 1 || assistantUserId ? (
            <FilterChip label="Asistente">
              <select value={assistantUserId} onChange={(e) => setAssistantUserId(e.target.value)} className={SELECT_CLS} aria-label="Filtrar por asistente">
                <option value="">Todos</option>
                {assistantChips.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.name} ({a.companies})
                  </option>
                ))}
              </select>
            </FilterChip>
          ) : null}
        </div>
      </div>

      {/* ver como (solo administrador) / alcance (supervisor) */}
      {isStudio ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DCE8E1] bg-white px-3 py-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.6px] text-slate-500">Ver como</span>
          <button
            type="button"
            aria-pressed={!supervisorUserId}
            onClick={() => {
              setSupervisorUserId('');
              setAssistantUserId('');
            }}
            className={`rounded-lg border px-3 py-[5px] text-xs font-bold ${!supervisorUserId ? 'border-[1.5px] border-[#0E8F47] bg-[#E3F5EA] text-[#0A5A3A]' : 'border-[#DCE8E1] bg-white font-semibold text-slate-700'}`}
          >
            Estudio completo
          </button>
          {supervisorChips.map((s, i) => (
            <button
              key={s.user_id}
              type="button"
              aria-pressed={String(s.user_id) === supervisorUserId}
              onClick={() => {
                setSupervisorUserId(String(s.user_id));
                setAssistantUserId('');
              }}
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
            <strong>Solo ves lo tuyo:</strong> las empresas que el administrador te asignó y el trabajo de tus asistentes.
          </span>
        </div>
      )}

      {loading && !progress ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : progress && pr ? (
        <>
          {/* Empresas y avance del periodo: tareas completadas ÷ tareas que aplican (igual que el panel del asistente). */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
            <KpiTile
              label={studioView ? 'Empresas activas' : 'Mis empresas activas'}
              value={progress.companies}
              delta={progress.suspended.length > 0 ? `${progress.suspended.length} suspendidas` : undefined}
              deltaTone="neutral"
              sub="en el periodo"
              icon="fas fa-building"
              color="#0369A1"
              soft="#FFFFFF"
              tint="#E0F2FE"
              tintBorder="#BAE6FD"
            />
            <HeroGauge
              pct={pr.pct}
              title={studioView ? 'Avance' : 'Avance de mi cartera'}
              line1={`${pr.completed.toLocaleString('es-PE')} de ${pr.total.toLocaleString('es-PE')} tareas completadas`}
              line2={`${pr.not_applicable.toLocaleString('es-PE')} no aplican (suspendidas o sin planilla)`}
            />
          </div>

          <div className="flex flex-wrap items-start gap-[14px]">
            {/* ===== principal ===== */}
            <div className="flex min-w-0 flex-col gap-[14px]" style={{ flex: '2.3 1 600px' }}>
              {/* KPI 1 a 5 y resumen del KPI 4 */}
              <div className="flex flex-wrap items-stretch gap-3">
                <div className="flex min-w-0 flex-[3_1_520px] flex-wrap gap-3">
                  <div className="flex min-w-[150px] flex-1 flex-col justify-center rounded-2xl border border-dashed border-[#DCE8E1] bg-[#F8FBF9] px-3 py-4 text-center" title="El sistema todavía no registra el tiempo de primera respuesta a los clientes.">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-slate-500">KPI 1</div>
                    <div className="mt-[2px] text-[13px] font-extrabold leading-tight text-slate-700">Tiempo 1.ª respuesta</div>
                    <div className="mt-2 text-[22px] font-extrabold text-slate-400">—</div>
                    <div className="mt-1 text-[10.5px] text-slate-400">Aún no se registra · Meta: ≤10 min</div>
                  </div>
                  <KpiCard n={2} title="Entrega de planillas" pct={k2.pct} meta={95} sub={kpiSub(k2, 'a tiempo')} />
                  <KpiCard n={3} title="Entrega de archivadores" pct={k3.pct} meta={95} sub={kpiSub(k3, 'a tiempo')} />
                  <KpiCard n={4} title="Declaraciones en plazo" pct={k4.pct} meta={95} sub={kpiSub(k4, 'en plazo')} />
                  <KpiCard n={5} title="Revisión de balances" pct={k5.pct} meta={100} unused={k5.unused} sub={kpiSub(k5, 'revisados')} />
                </div>
                <div className="flex min-w-[250px] flex-[1_1_250px] flex-col gap-2 rounded-2xl border border-[#DCE8E1] bg-[#F8FBF9] p-3">
                  <div className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-[#0A5A3A]">Resumen KPI 4</div>
                  <div className="grid grid-cols-2 gap-2">
                    <SummaryBox label="Dentro de plazo" value={k4.onTime} color="#0A7A3B" onClick={() => openModule(mDeclaracion, { digit: null, bucket: 'dentro' })} />
                    <SummaryBox label="Fuera de plazo" value={mDeclaracion?.late ?? 0} color="#C2410C" onClick={() => openModule(mDeclaracion, { digit: null, bucket: 'fuera' })} />
                    <SummaryBox label="Pendientes" value={k4.pending} color="#475569" onClick={() => openModule(mDeclaracion, { digit: null, bucket: 'pendiente' })} />
                    <SummaryBox label="Suspendidas" value={progress.suspended.length} color="#7C3AED" onClick={openSuspended} />
                  </div>
                  <p className="m-0 text-[10.5px] text-slate-500">Declaración del PDT 621. Pulse una cifra para ver las empresas.</p>
                </div>
              </div>

              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="m-0 text-[15px] font-extrabold">{studioView ? 'Módulos' : 'Mis módulos'}</h2>
                  <span className="text-[11.5px] text-slate-500">tareas completadas de las que aplican · pulse un módulo para ver su detalle</span>
                </div>
                <ModuleCards modules={progress.modules} onOpen={(m) => openModule(m, NO_FILTER)} />
              </Card>

              <Section title="Revisión de buzones" hint="Capturas SUNAT y SUNAFIL por asistente: a tiempo, fuera de plazo y pendientes (incluye lo vencido sin subir).">
                {progress.mailboxes.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">Sin capturas de buzón configuradas en el calendario de este periodo.</p>
                ) : (
                  <MailboxBars rows={progress.mailboxes} onPick={openMailbox} />
                )}
              </Section>

              {/* Avance de los últimos meses y asistentes */}
              <Card className="flex flex-wrap gap-x-[22px] gap-y-4">
                <div className="min-w-0" style={{ flex: '1.1 1 320px' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="m-0 text-sm font-extrabold">Avance (6 meses)</h2>
                    <div className="flex gap-1" role="group" aria-label="Agrupar el avance">
                      {TREND_MODES.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          aria-pressed={trendMode === m.id}
                          onClick={() => setTrendMode(m.id)}
                          className={`rounded-lg border px-[10px] py-[3px] text-[11px] ${trendMode === m.id ? 'border-[1.5px] border-[#0E8F47] bg-[#E3F5EA] font-bold text-[#0A5A3A]' : 'border-[#DCE8E1] bg-white font-semibold text-slate-600 hover:bg-slate-50'}`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="m-0 mt-[2px] text-[11.5px] text-slate-500">Tareas completadas ÷ tareas que aplican{trendMode === 'mensual' ? ' en cada mes' : ' en todo el tramo'}.</p>
                  <AvanceColumns bars={trendBars} />
                </div>
                <div className="min-w-0 border-l border-[#EAF1ED] pl-[22px]" style={{ flex: '1 1 280px' }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="m-0 text-sm font-extrabold">{studioView ? 'Asistentes por cumplimiento' : 'Mis asistentes por cumplimiento'}</h2>
                    <span className="text-[10.5px] text-slate-500">Avance</span>
                  </div>
                  {ranking.length > 0 ? <RankBars rows={ranking} max={100} /> : <p className="py-8 text-center text-xs text-slate-500">Sin datos para este alcance.</p>}
                  <p className="mb-0 mt-[14px] border-t border-[#EAF1ED] pt-2 text-[11px] text-slate-500">Tareas completadas ÷ tareas que aplican a cada asistente.</p>
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
                  {(review?.items.length ?? 0) === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-500">{overviewLoading ? 'Cargando…' : 'No hay entregas por revisar.'}</p>
                  ) : (
                    <div className="flex flex-col">
                      {review?.items.map((q) => {
                        const slug = MODULE_PATH[q.module_key];
                        const to = slug ? `/supervisors/activities/${slug}/${q.company_id}?period_ym=${encodeURIComponent(periodYm)}` : undefined;
                        const tl = q.timeliness === 'on_time' ? { t: 'A tiempo', c: '#0A5A3A' } : q.timeliness === 'late' ? { t: 'Fuera de plazo', c: '#C2410C' } : { t: 'Sin regla', c: '#64748B' };
                        return (
                          <div key={q.declaration_id} className="flex items-center gap-2 border-t border-[#EAF1ED] py-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-bold" title={q.company}>
                                {q.company}
                              </div>
                              <div className="mt-px text-[10.5px] text-slate-500">
                                {q.module_label} · {q.assistant || '—'} ·{' '}
                                <span className={q.age_days > 3 ? 'font-bold text-amber-700' : ''}>{q.age_days === 0 ? 'hoy' : `hace ${q.age_days} d`}</span> ·{' '}
                                <span className="font-bold" style={{ color: tl.c }}>
                                  {tl.t}
                                </span>
                              </div>
                            </div>
                            {to ? (
                              <Link to={to} className="rounded-[7px] border border-slate-300 bg-white px-[9px] py-[5px] text-[11px] font-bold text-slate-700 hover:bg-slate-50">
                                Ver
                              </Link>
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
                  <h2 className="m-0 text-sm font-extrabold">Alertas del periodo</h2>
                  <Link to="/supervisors/reports" className="rounded-[7px] bg-[#E3F5EA] px-2 py-[3px] text-[10.5px] font-bold text-[#0A5A3A]">
                    Ver reportes →
                  </Link>
                </div>
                {alerts.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">{overviewLoading ? 'Cargando…' : 'Sin alertas para este periodo.'}</p>
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
                        <Link key={a.key} to={a.to} className="flex items-start gap-[9px] rounded-[10px] px-[10px] py-2 hover:opacity-90" style={{ background: a.soft }}>
                          {inner}
                        </Link>
                      ) : (
                        <div key={a.key} className="flex items-start gap-[9px] rounded-[10px] px-[10px] py-2" style={{ background: a.soft }}>
                          {inner}
                        </div>
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
                      <p className="py-3 text-center text-xs text-slate-500">{overviewLoading ? 'Cargando…' : 'Sin supervisores en este alcance.'}</p>
                    ) : (
                      <div className="flex flex-col gap-[10px]">
                        {bySup.map((s, i) => (
                          <div key={s.user_id} className="flex items-center gap-[9px]">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9.5px] font-extrabold text-white" style={{ background: SUP_COLORS[i % SUP_COLORS.length] }}>
                              {initials(s.name)}
                            </div>
                            <div className="w-[76px] shrink-0 truncate text-xs font-bold" title={s.name}>
                              {s.name}
                            </div>
                            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-[#EEF3F0]">
                              <div className="h-full rounded bg-indigo-500" style={{ width: `${(s.review / maxReview) * 100}%` }} />
                            </div>
                            <div className="w-[22px] shrink-0 text-right text-[12.5px] font-extrabold tabular-nums">{s.review}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card>
                    <div className="mb-[10px] flex items-center justify-between">
                      <h2 className="m-0 text-sm font-extrabold">Asistentes con más pendientes</h2>
                      <span className="text-[10.5px] text-slate-500">tareas sin completar</span>
                    </div>
                    {topOpen.length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-500">Sin asistentes en este alcance.</p>
                    ) : (
                      <div className="flex flex-col gap-[10px]">
                        {topOpen.map((a) => (
                          <div key={a.user_id}>
                            <div className="mb-[3px] flex justify-between text-xs">
                              <span>
                                <strong>{a.name}</strong> <span className="text-slate-500">· sup. {a.supervisor_name || '—'}</span>
                              </span>
                              <span className="tabular-nums">
                                <strong className="text-amber-700">{a.open}</strong> <span className="text-slate-500">/ {a.total}</span>
                              </span>
                            </div>
                            <div className="flex h-[7px] overflow-hidden rounded bg-[#EEF3F0]">
                              <div style={{ width: `${(a.open / a.total) * 100}%`, background: DASH_COLORS.pend }} />
                              <div style={{ width: `${(a.completed / a.total) * 100}%`, background: DASH_COLORS.ok }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-[10px] flex gap-3 text-[10.5px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm" style={{ background: DASH_COLORS.pend }} />
                        Sin completar
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm" style={{ background: DASH_COLORS.ok }} />
                        Completado
                      </span>
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
                        const unit = u.days_left <= 1 && u.days_left >= 0 ? '' : 'días';
                        return (
                          <div key={`${u.module_key}-${u.due_date}-${u.detail}`} className="flex items-center gap-[10px] rounded-[10px] border border-[#EAF1ED] px-[10px] py-[7px]">
                            <div className="w-[54px] shrink-0 rounded-lg px-[2px] py-[5px] text-center" style={{ background: tone.s, color: tone.c }}>
                              <div className="text-[13px] font-extrabold leading-tight">{when}</div>
                              {unit ? <div className="text-[9px] font-bold uppercase tracking-[0.3px]">{unit}</div> : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold">{u.label}</div>
                              <div className="text-[10.5px] text-slate-500">
                                {u.detail ? `${u.detail} · ` : ''}
                                {u.due_date}
                              </div>
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

      <ModulePendingModal
        module={moduleModal?.module ?? null}
        items={[]}
        periodYm={periodYm}
        detailPath={detailPath}
        onClose={closeModuleModal}
        fetchDetail={fetchDetail}
        initialFilter={moduleModal?.filter}
        moduleHref={(slug) => `/supervisors/activities/${slug}?period_ym=${encodeURIComponent(periodYm)}`}
      />
      {listModal ? <CompanyListModal title={listModal.title} subtitle={listModal.subtitle} items={listModal.items} empty={listModal.empty} onClose={() => setListModal(null)} /> : null}
    </div>
  );
};

export default SupervisorDashboardView;
