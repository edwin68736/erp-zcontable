import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ModulePendingModal from '../../components/assistant/ModulePendingModal';
import { Card, HeroGauge, TrendArea } from '../../components/supervisors/dashboard/DashboardParts';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { MODULE_SLUG, workModuleLabel } from '../../navigation/moduleSlugs';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import {
  supervisorsService,
  type AssistantOverview,
  type AssistantProgress,
  type AssistantStudioInfo,
  type AssistantWorkItem,
} from '../../services/supervisors';
import { extractApiErrorMessage } from '../../utils/apiError';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { STATE_STYLE, dueText, shortDate, stateLabel } from './assistantUi';

const MONTH_ABBR = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.slice(5, 7)) - 1] ?? ym;

type Tab = 'todas' | 'vencidas' | 'semana' | 'observadas' | 'revisar';

/** Cada pestaña lleva su color: el mismo del estado que filtra (rojo vencidas, ámbar por vencer, naranja observadas, índigo en revisión). */
const TAB_STYLE: Record<Tab, { on: string; off: string; badgeOn: string; badgeOff: string }> = {
  todas: {
    on: 'border-[1.5px] border-slate-700 bg-slate-100 font-bold text-slate-900',
    off: 'border border-slate-200 bg-white font-semibold text-slate-700',
    badgeOn: 'bg-slate-700 text-white',
    badgeOff: 'bg-slate-100 text-slate-600',
  },
  vencidas: {
    on: 'border-[1.5px] border-red-500 bg-red-50 font-bold text-red-800',
    off: 'border border-red-100 bg-white font-semibold text-red-700',
    badgeOn: 'bg-red-600 text-white',
    badgeOff: 'bg-red-100 text-red-700',
  },
  semana: {
    on: 'border-[1.5px] border-amber-500 bg-amber-50 font-bold text-amber-900',
    off: 'border border-amber-100 bg-white font-semibold text-amber-800',
    badgeOn: 'bg-amber-500 text-white',
    badgeOff: 'bg-amber-100 text-amber-800',
  },
  observadas: {
    on: 'border-[1.5px] border-orange-500 bg-orange-50 font-bold text-orange-900',
    off: 'border border-orange-100 bg-white font-semibold text-orange-800',
    badgeOn: 'bg-orange-600 text-white',
    badgeOff: 'bg-orange-100 text-orange-800',
  },
  revisar: {
    on: 'border-[1.5px] border-indigo-500 bg-indigo-50 font-bold text-indigo-900',
    off: 'border border-indigo-100 bg-white font-semibold text-indigo-800',
    badgeOn: 'bg-indigo-600 text-white',
    badgeOff: 'bg-indigo-100 text-indigo-800',
  },
};

/** Colores de los estados de una tarea (barra de estado). */
const SEG = {
  onTime: '#12A150',
  late: '#2563EB',
  review: '#6366F1',
  pending: '#CBD5E1',
  overdue: '#DC2626',
  observed: '#EA580C',
} as const;

/** Barra apilada con el estado de todas las tareas que aplican del periodo. */
const TaskStateBar = ({ p }: { p: AssistantProgress }) => {
  const segs = [
    { label: 'Completadas a tiempo', value: p.on_time, color: SEG.onTime },
    { label: 'Completadas fuera de fecha', value: p.late, color: SEG.late },
    { label: 'En revisión del supervisor', value: p.in_review, color: SEG.review },
    { label: 'Pendientes (sin vencer)', value: p.pending, color: SEG.pending },
    { label: 'Vencidas', value: p.overdue, color: SEG.overdue },
    { label: 'Observadas', value: p.observed, color: SEG.observed },
  ];
  const total = p.total;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#EEF3F0]" role="img" aria-label="Estado de las tareas del periodo">
        {total > 0
          ? segs
              .filter((s) => s.value > 0)
              .map((s) => <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`} />)
          : null}
      </div>
      <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-x-6 gap-y-[6px] p-0 sm:grid-cols-2">
        {segs.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[12px]">
            <span className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-slate-600">{s.label}</span>
            <span className="font-extrabold tabular-nums text-slate-900">{s.value.toLocaleString('es-PE')}</span>
            <span className="w-10 text-right text-[11px] tabular-nums text-slate-500">{total > 0 ? `${Math.round((s.value / total) * 100)} %` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Panel del asistente. Responde «¿qué tengo que hacer hoy y cuánto llevo?». Todo sale de una sola lista de tareas del
 * servidor: el avance (tareas completadas ÷ tareas que aplican del periodo), los totales por actividad, las pestañas y la
 * lista de trabajo. Para asistentes y supervisores es sobre SUS empresas; el administrador ve el estudio completo y
 * puede filtrar por asistente y supervisor.
 */
const AssistantWorkspace = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsControlsView), []);
  const me = auth.getUser();
  const firstName = (me?.name || me?.username || '').split(/\s+/)[0] || '';

  const [periodYm, setPeriodYm] = useState(previousMonthPeriodYM());
  const [moduleFilter, setModuleFilter] = useState('');
  const [assistantId, setAssistantId] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [tab, setTab] = useState<Tab>('todas');
  const [showAll, setShowAll] = useState(false);
  /** Módulo cuyo modal de empresas pendientes está abierto. */
  const [moduleModalKey, setModuleModalKey] = useState<string | null>(null);
  const [data, setData] = useState<AssistantOverview | null>(null);
  // Opciones de los filtros: se guardan aparte para que sigan a la vista aunque una consulta falle.
  const [studio, setStudio] = useState<AssistantStudioInfo | null>(null);
  const [moduleOptions, setModuleOptions] = useState<Array<{ key: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void supervisorsService
      .assistantOverview({
        period_ym: periodYm,
        ...(moduleFilter ? { module_key: moduleFilter } : {}),
        ...(assistantId ? { assistant_user_id: Number(assistantId) } : {}),
        ...(supervisorId ? { supervisor_user_id: Number(supervisorId) } : {}),
      })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        if (res.studio) setStudio(res.studio);
        if (res.module_options?.length) setModuleOptions(res.module_options);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(extractApiErrorMessage(err, 'No se pudo cargar su panel.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, periodYm, moduleFilter, assistantId, supervisorId]);

  const work = useMemo(() => data?.work ?? [], [data]);
  const counts = data?.counts;
  const shown = useMemo(() => {
    const list = work.filter((w) => {
      if (tab === 'vencidas') return w.state === 'vencida';
      if (tab === 'observadas') return w.state === 'observada';
      if (tab === 'semana') return w.state === 'pendiente' && (w.days_left ?? 99) >= 0 && (w.days_left ?? 99) <= 7;
      if (tab === 'revisar') return w.state === 'por_revisar';
      return true;
    });
    return showAll ? list : list.slice(0, 8);
  }, [work, tab, showAll]);

  const detailPath = (w: AssistantWorkItem) => {
    const slug = MODULE_SLUG[w.module_key];
    if (!slug) return '/assistant';
    const entrega = w.slot ? `/${w.slot}` : '';
    const semana = w.week_start ? `&week_start=${encodeURIComponent(w.week_start)}` : '';
    return `/assistant/activities/${slug}/${w.company_id}${entrega}?period_ym=${encodeURIComponent(periodYm)}${semana}`;
  };

  if (!allowed) {
    return <p className="p-6 text-center text-slate-600">Sin permiso para el panel de asistente.</p>;
  }

  // Administrador: el panel es del estudio completo (con filtros por asistente y supervisor); el resto ve solo lo suyo.
  const isStudio = studio != null;
  const mineOr = (mine: string, all: string) => (isStudio ? all : mine);
  const filtered = Boolean(assistantId || supervisorId);
  const pr = data?.progress;
  const supervisors = data?.supervisors ?? [];
  // Solo los meses con alguna tarea completada: antes de que se usara el sistema no hay registros y mostrarlos como 0 % haría
  // parecer que la empresa empeoró cuando en realidad no había nada que medir.
  const trendPoints = (data?.trend ?? []).filter((t) => t.completed > 0);
  const tabTotals: Record<Tab, number> = {
    todas: counts?.all ?? 0,
    vencidas: counts?.overdue ?? 0,
    semana: counts?.due_this_week ?? 0,
    observadas: counts?.observed ?? 0,
    revisar: counts?.in_review ?? 0,
  };
  const tabTotal = tabTotals[tab];
  const returned = work.filter((w) => w.state === 'observada').slice(0, 3);
  const waiting = work.filter((w) => w.state === 'por_revisar').slice(0, 4);
  const firstUrgent = work.find((w) => w.state !== 'por_revisar');
  const moduleName = moduleFilter ? moduleOptions.find((m) => m.key === moduleFilter)?.label : '';

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'todas', label: 'Todas' },
    { id: 'vencidas', label: 'Vencidas' },
    { id: 'semana', label: 'Vencen esta semana' },
    { id: 'observadas', label: 'Observadas' },
    { id: 'revisar', label: 'Por revisar' },
  ];

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-[280px] flex-1">
          <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900">{firstName ? `Hola, ${firstName}` : 'Mi panel'}</h1>
          <p className="mt-1 text-[13px] text-slate-600">
            {data && counts ? (
              <>
                {mineOr('Tienes', 'Hay')} <strong className="text-red-700">{counts.overdue} {counts.overdue === 1 ? 'entrega vencida' : 'entregas vencidas'}</strong> y{' '}
                <strong className="text-amber-700">{counts.due_this_week} que {counts.due_this_week === 1 ? 'vence' : 'vencen'} esta semana</strong> ·{' '}
                {data.companies} {mineOr('empresas asignadas', filtered ? 'empresas con este filtro' : 'empresas del estudio')}
              </>
            ) : (
              mineOr('Lo que tienes que hacer en el periodo.', 'Lo que hay por hacer en el estudio en el periodo.')
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[3px] text-xs">
            <span className="text-slate-500">Periodo</span>
            <input type="month" value={periodYm} onChange={(e) => setPeriodYm(e.target.value)} className="border-0 bg-transparent py-[3px] pr-1 text-xs font-bold outline-none" />
          </label>
          {studio ? (
            <>
              <label className="flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[3px] text-xs">
                <span className="text-slate-500">Asistente</span>
                <select value={assistantId} onChange={(e) => setAssistantId(e.target.value)} className="max-w-[170px] border-0 bg-transparent py-[3px] pr-1 text-xs font-bold outline-none" aria-label="Filtrar por asistente">
                  <option value="">Todos</option>
                  {studio.assistants.map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.name} ({a.companies})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[3px] text-xs">
                <span className="text-slate-500">Supervisor</span>
                <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="max-w-[170px] border-0 bg-transparent py-[3px] pr-1 text-xs font-bold outline-none" aria-label="Filtrar por supervisor">
                  <option value="">Todos</option>
                  {studio.supervisors.map((s) => (
                    <option key={s.user_id} value={s.user_id}>
                      {s.name} ({s.companies})
                    </option>
                  ))}
                </select>
              </label>
              {filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setAssistantId('');
                    setSupervisorId('');
                  }}
                  className="rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[7px] text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Quitar filtros
                </button>
              ) : null}
            </>
          ) : null}
          <label className="flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[3px] text-xs">
            <span className="text-slate-500">Módulo</span>
            <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="max-w-[190px] border-0 bg-transparent py-[3px] pr-1 text-xs font-bold outline-none" aria-label="Filtrar por módulo">
              <option value="">Todos</option>
              {moduleOptions.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <Link to="/assistant/dashboard" className="rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[7px] text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Resumen PDT 601/621
          </Link>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : data && pr ? (
        <>
          {/* Empresas y supervisores: lo primero que se ve del panel. */}
          <div className="flex flex-wrap gap-3">
            <Link
              to="/assistant/companies"
              className="flex min-w-0 items-center gap-4 rounded-2xl border px-5 py-4 no-underline hover:shadow-sm"
              style={{ flex: '1 1 300px', background: '#E0F2FE', borderColor: '#BAE6FD', color: 'inherit' }}
              aria-label={`${mineOr('Empresas asignadas', 'Empresas del estudio')}: ${data.companies}. Ver empresas`}
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-[24px] text-sky-700">
                <i className="fas fa-building" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-sky-800">{mineOr('Empresas asignadas', 'Empresas del estudio')}</span>
                <span className="block text-[46px] font-extrabold leading-none tabular-nums text-slate-900">{data.companies}</span>
                <span className="mt-1 block text-[12px] font-semibold text-sky-800">{mineOr('a tu cargo · ver mis empresas →', filtered ? 'con el filtro elegido · ver empresas →' : 'activas · ver empresas →')}</span>
              </span>
            </Link>
            <div className="flex min-w-0 items-center gap-4 rounded-2xl border px-5 py-4" style={{ flex: '1 1 300px', background: '#DCFCE7', borderColor: '#BBF7D0' }}>
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-[24px] text-green-700">
                <i className="fas fa-user-check" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-green-800">
                  {isStudio || supervisors.length > 1 ? mineOr('Mis supervisores', 'Supervisores') : 'Mi supervisor'}
                </span>
                {supervisors.length === 0 ? (
                  <span className="mt-1 block text-[16px] font-bold text-slate-700">Sin supervisor asignado</span>
                ) : supervisors.length === 1 ? (
                  <>
                    <span className="block break-words text-[20px] font-extrabold leading-tight text-slate-900" title={supervisors[0].name}>
                      {supervisors[0].name}
                    </span>
                    <span className="mt-1 block text-[12px] font-semibold text-green-800">
                      revisa {isStudio ? 'las' : 'tus'} {supervisors[0].companies} {supervisors[0].companies === 1 ? 'empresa' : 'empresas'}
                    </span>
                  </>
                ) : (
                  <ul className="m-0 mt-1 max-h-[7.5rem] list-none space-y-[2px] overflow-y-auto p-0">
                    {supervisors.map((sv) => (
                      <li key={sv.user_id} className="flex items-baseline gap-2 text-[14px] font-bold text-slate-900">
                        <span className="truncate" title={sv.name}>{sv.name}</span>
                        <span className="shrink-0 text-[12px] font-semibold text-green-800">{sv.companies} {sv.companies === 1 ? 'empresa' : 'empresas'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            </div>
          </div>

          {/* Avance del periodo: tareas completadas ÷ tareas que aplican. */}
          <div className="flex flex-wrap gap-3">
            <HeroGauge
              pct={pr.pct}
              title={`${mineOr('Mi avance', 'Avance')}${moduleName ? ` · ${moduleName}` : ''}`}
              line1={`${pr.completed.toLocaleString('es-PE')} de ${pr.total.toLocaleString('es-PE')} tareas completadas`}
              line2={`${pr.not_applicable.toLocaleString('es-PE')} no aplican (suspendidas o sin planilla)`}
            />
            <Card className="min-w-0" accent="#12A150">
              <div style={{ flex: '2 1 360px' }}>
                <div className="mb-[10px] flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="m-0 text-sm font-extrabold">Estado de las tareas</h2>
                  <span className="text-[11.5px] text-slate-500">{periodYm} · {pr.total.toLocaleString('es-PE')} tareas que aplican</span>
                </div>
                <TaskStateBar p={pr} />
              </div>
            </Card>
          </div>

          <div className="flex flex-wrap items-start gap-[14px]">
            <div className="flex min-w-0 flex-col gap-[14px]" style={{ flex: '2.3 1 600px' }}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="m-0 text-[15px] font-extrabold">{mineOr('Mis módulos', 'Módulos')}</h2>
                  <span className="text-[11.5px] text-slate-500">tareas completadas de las que aplican</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-[22px] gap-y-[10px]">
                  {data.modules.map((m) => {
                    const left = m.total - m.completed;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setModuleModalKey(m.key)}
                        className="block min-w-0 cursor-pointer rounded-xl border border-[#EAF1ED] bg-transparent px-3 py-[10px] text-left text-inherit hover:bg-slate-50/60"
                        style={{ flex: '1 1 280px' }}
                        aria-label={`${m.label}: ver las empresas con tareas por hacer`}
                      >
                        <div className="mb-[6px] flex items-center justify-between gap-2">
                          <strong className="text-[12.5px]">
                            {m.label}
                            {m.owner === 'supervisor' ? <span className="ml-2 rounded-md bg-violet-50 px-[6px] py-px text-[10px] font-bold text-violet-800">Supervisor</span> : null}
                          </strong>
                          <span className="flex items-center gap-2">
                            {left > 0 ? <span className="rounded-[7px] bg-amber-100 px-[7px] py-px text-[10.5px] font-extrabold text-amber-800">{left.toLocaleString('es-PE')} por hacer</span> : null}
                            <span className="text-[11px] font-bold text-[#0A5A3A]">Ver pendientes →</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-[10px]">
                          <div className="h-2 flex-1 overflow-hidden rounded bg-[#EEF3F0]">
                            <div className="h-full rounded" style={{ width: `${m.pct}%`, background: m.pct >= 75 ? '#12A150' : m.pct >= 50 ? '#F59E0B' : '#DC2626' }} />
                          </div>
                          <span className="w-[112px] text-right text-[11.5px] font-extrabold tabular-nums">{m.completed.toLocaleString('es-PE')} / {m.total.toLocaleString('es-PE')} · {Math.round(m.pct)}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>

              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="m-0 text-[15px] font-extrabold">{mineOr('Mi lista de trabajo', 'Lista de trabajo')}</h2>
                    <p className="m-0 mt-[2px] text-[11.5px] text-slate-500">Ordenada por urgencia: lo vencido primero, luego lo que te devolvieron y lo que vence antes.</p>
                  </div>
                  {firstUrgent ? (
                    <Link to={detailPath(firstUrgent)} className="rounded-[9px] border border-[#0E8F47] bg-[#0E8F47] px-[14px] py-[7px] text-xs font-bold text-white hover:bg-[#0A7A3B]">
                      Empezar por lo más urgente →
                    </Link>
                  ) : null}
                </div>
                <div role="tablist" aria-label="Filtrar lista" className="mb-1 mt-3 flex flex-wrap gap-[6px]">
                  {TABS.map((t) => {
                    const sel = tab === t.id;
                    const st = TAB_STYLE[t.id];
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={sel}
                        onClick={() => {
                          setTab(t.id);
                          setShowAll(false);
                        }}
                        className={`flex items-center gap-[6px] rounded-[9px] px-3 py-[6px] text-xs ${sel ? st.on : st.off}`}
                      >
                        {t.label}
                        <span className={`rounded-[7px] px-[6px] text-[10.5px] font-extrabold ${sel ? st.badgeOn : st.badgeOff}`}>{tabTotals[t.id].toLocaleString('es-PE')}</span>
                      </button>
                    );
                  })}
                </div>
                {work.some((w) => w.module_key === 'sunat_inbox' && w.state === 'vencida') ? (
                  <p className="m-0 mt-2 text-[11px] text-slate-500">
                    El Buzón SOL se agrupa: una fila por empresa con todas sus capturas vencidas. Los totales de arriba cuentan cada captura (cada semana, SUNAT y SUNAFIL por separado).
                  </p>
                ) : null}
                {shown.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-500">
                    {tabTotals.todas === 0
                      ? mineOr('¡Todo al día! No tienes entregas pendientes en este periodo.', '¡Todo al día! No hay entregas pendientes en este periodo.')
                      : 'No hay entregas en esta pestaña.'}
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {shown.map((w) => {
                      const st = STATE_STYLE[w.state];
                      const due = dueText(w);
                      const supervisorTask = w.owner === 'supervisor';
                      const btn = supervisorTask ? { label: 'Ver', bg: '#fff', fg: '#334155', border: '#CBD5E1' } : { label: st.btn, bg: st.btnBg, fg: st.btnFg, border: st.btnBorder };
                      return (
                        <div key={`${w.module_key}-${w.company_id}-${w.slot ?? 0}-${w.week_start ?? ''}-${w.detail ?? ''}`} className="flex items-start gap-3 border-t border-[#EAF1ED] py-[11px]">
                          <div className="w-1 shrink-0 self-stretch rounded" style={{ background: st.stripe }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-[13px]">{w.company}</strong>
                              <span className="rounded-md bg-slate-100 px-[7px] py-px text-[10.5px] font-bold text-slate-700">{workModuleLabel(w.module_label, w.slot, w.detail)}</span>
                              <span className="rounded-md px-[7px] py-px text-[10.5px] font-extrabold" style={{ background: st.bg, color: st.fg }}>{stateLabel(w)}</span>
                              {supervisorTask ? (
                                <span className="rounded-md bg-violet-50 px-[7px] py-px text-[10.5px] font-bold text-violet-800" title="Esta tarea es del supervisor">
                                  <i className="fas fa-user-tie mr-1 text-[9px]" aria-hidden />
                                  Supervisor
                                </span>
                              ) : null}
                              {w.assistant ? (
                                <span className="rounded-md bg-sky-50 px-[7px] py-px text-[10.5px] font-bold text-sky-800" title="Asistente de la empresa">
                                  <i className="fas fa-user mr-1 text-[9px]" aria-hidden />
                                  {w.assistant}
                                </span>
                              ) : null}
                            </div>
                            <div className={`mt-[3px] text-[11.5px] ${due.urgent ? 'font-bold text-red-700' : 'text-slate-600'}`}>{due.text}</div>
                            {w.hint ? <div className="mt-[2px] text-[11px] text-slate-500">{w.hint}</div> : null}
                            {w.state === 'observada' && w.note ? (
                              <div className="mt-[7px] rounded-[9px] border border-orange-200 bg-orange-50 px-[10px] py-[7px] text-[11.5px] text-orange-950">
                                <strong>{w.note_by || 'Supervisor'}:</strong> {w.note}
                              </div>
                            ) : null}
                          </div>
                          <Link
                            to={detailPath(w)}
                            className="shrink-0 whitespace-nowrap rounded-[9px] border px-[14px] py-[7px] text-xs font-bold hover:opacity-90"
                            style={{ background: btn.bg, color: btn.fg, borderColor: btn.border }}
                          >
                            {btn.label}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
                {tabTotal > 8 ? (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full border-t border-[#EAF1ED] pb-2 pt-[10px] text-center text-xs font-bold text-[#0A5A3A]">
                    {showAll ? 'Ver menos' : `Ver las ${tabTotal.toLocaleString('es-PE')} →`}
                  </button>
                ) : null}
                {data.work_truncated ? <p className="m-0 pt-1 text-center text-[11px] text-slate-500">La lista muestra las más urgentes; los totales de arriba son de todo.</p> : null}
              </Card>

              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="m-0 text-sm font-extrabold">{mineOr('Mi avance', 'Avance')} (6 meses)</h2>
                  <span className="text-[11px] text-slate-500">mismo cálculo que el avance del periodo</span>
                </div>
                {trendPoints.length >= 2 ? (
                  <TrendArea points={trendPoints.map((t) => ({ label: monthLabel(t.period_ym), value: t.pct }))} />
                ) : (
                  <p className="py-6 text-center text-xs text-slate-500">Todavía no hay suficientes meses con entregas registradas.</p>
                )}
              </Card>
            </div>

            <aside className="flex min-w-0 max-w-[380px] flex-col gap-[14px]" style={{ flex: '1 1 300px' }}>
              <Card accent="#F59E0B">
                <div className="mb-[10px] flex items-center justify-between">
                  <h2 className="m-0 text-sm font-extrabold">Vencimientos de la semana</h2>
                  <span className="text-[10.5px] text-slate-500">{mineOr('mis empresas sin entregar', 'empresas sin entregar')}</span>
                </div>
                {data.upcoming.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">No hay vencimientos próximos con empresas pendientes.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.upcoming.map((u) => {
                      const overdue = u.days_left < 0;
                      const tone = overdue || u.days_left === 0 ? { c: '#B91C1C', s: '#FEE2E2' } : u.days_left <= 3 ? { c: '#B45309', s: '#FEF3C7' } : { c: '#1D4ED8', s: '#DBEAFE' };
                      const when = u.days_left === 0 ? 'Hoy' : u.days_left === 1 ? 'Mañana' : overdue ? `−${Math.abs(u.days_left)}` : String(u.days_left);
                      return (
                        <div key={`${u.module_key}-${u.due_date}-${u.detail}`} className="flex items-center gap-[10px] rounded-[10px] border border-[#EAF1ED] px-[10px] py-[7px]">
                          <div className="w-[54px] shrink-0 rounded-lg px-[2px] py-[5px] text-center" style={{ background: tone.s, color: tone.c }}>
                            <div className="text-[13px] font-extrabold leading-tight">{when}</div>
                            {u.days_left > 1 || overdue ? <div className="text-[9px] font-bold uppercase tracking-[0.3px]">días</div> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold">{u.label}</div>
                            <div className="text-[10.5px] text-slate-500">{u.detail ? `${u.detail} · ` : ''}{shortDate(u.due_date)}</div>
                          </div>
                          <div className="text-base font-extrabold tabular-nums">{u.pending}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card accent="#EA580C">
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="m-0 text-sm font-extrabold">{mineOr('Lo que te devolvió el supervisor', 'Devueltas por supervisores')}</h2>
                  <span className="rounded-[7px] bg-orange-100 px-2 py-px text-[11.5px] font-extrabold text-orange-800">{(counts?.observed ?? 0).toLocaleString('es-PE')}</span>
                </div>
                <p className="mb-2 mt-0 text-[11px] text-slate-500">Corrige y vuelve a cargar: reemplaza el archivo anterior.</p>
                {returned.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">{mineOr('No tienes entregas devueltas.', 'No hay entregas devueltas.')}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {returned.map((r) => (
                      <div key={`${r.module_key}-${r.company_id}-${r.detail ?? ''}`} className="rounded-[11px] border border-orange-200 bg-orange-50 px-[11px] py-[9px]">
                        <div className="flex justify-between gap-2 text-xs"><strong>{r.company}</strong><span className="font-bold text-orange-800">{r.module_label}</span></div>
                        {r.note ? <div className="mt-1 text-[11.5px] text-orange-950">“{r.note}”</div> : null}
                        <div className="mt-[7px] flex items-center justify-between">
                          <span className="text-[10.5px] text-orange-800">{r.note_by || 'Supervisor'}</span>
                          <Link to={detailPath(r)} className="rounded-[7px] border border-orange-600 bg-orange-600 px-[11px] py-[5px] text-[11px] font-bold text-white hover:bg-orange-700">Corregir</Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="m-0 text-sm font-extrabold">Esperando al supervisor</h2>
                  <span className="rounded-[7px] bg-indigo-100 px-2 py-px text-[11.5px] font-extrabold text-indigo-800">{(counts?.in_review ?? 0).toLocaleString('es-PE')}</span>
                </div>
                {waiting.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">Nada pendiente de revisión.</p>
                ) : (
                  <div className="flex flex-col">
                    {waiting.map((q) => (
                      <div key={`${q.module_key}-${q.company_id}-${q.slot ?? 0}`} className="flex items-center gap-2 border-t border-[#EAF1ED] py-[7px]">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold" title={q.company}>{q.company}</div>
                          <div className="text-[10.5px] text-slate-500">{q.module_label}{q.assistant ? ` · ${q.assistant}` : ''}</div>
                        </div>
                        <span className="rounded-md bg-indigo-100 px-[7px] py-[2px] text-[10.5px] font-extrabold text-indigo-800">Por revisar</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </aside>
          </div>
        </>
      ) : null}

      <ModulePendingModal
        module={data?.modules.find((m) => m.key === moduleModalKey) ?? null}
        items={work.filter((w) => w.module_key === moduleModalKey)}
        periodYm={periodYm}
        truncated={data?.work_truncated}
        detailPath={detailPath}
        onClose={() => setModuleModalKey(null)}
      />
    </div>
  );
};

export default AssistantWorkspace;
