import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  DASH_COLORS,
  Donut,
  DonutLegend,
  HeroGauge,
  KpiTile,
  TrendArea,
  type DonutSlice,
} from '../../components/supervisors/dashboard/DashboardParts';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { MODULE_SLUG } from '../../navigation/moduleSlugs';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { supervisorsService, type AssistantOverview, type AssistantWorkItem } from '../../services/supervisors';
import { extractApiErrorMessage } from '../../utils/apiError';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';

const MONTH_ABBR = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.slice(5, 7)) - 1] ?? ym;

type Tab = 'todas' | 'vencidas' | 'observadas' | 'semana' | 'revisar';

const STATE_STYLE: Record<AssistantWorkItem['state'], { stripe: string; fg: string; bg: string; btn: string; btnBg: string; btnFg: string; btnBorder: string }> = {
  vencida: { stripe: '#DC2626', fg: '#991B1B', bg: '#FEE2E2', btn: 'Cargar', btnBg: '#0E8F47', btnFg: '#fff', btnBorder: '#0E8F47' },
  observada: { stripe: '#EA580C', fg: '#9A3412', bg: '#FFEDD5', btn: 'Corregir', btnBg: '#EA580C', btnFg: '#fff', btnBorder: '#EA580C' },
  pendiente: { stripe: '#F59E0B', fg: '#92400E', bg: '#FEF3C7', btn: 'Cargar', btnBg: '#0E8F47', btnFg: '#fff', btnBorder: '#0E8F47' },
  por_revisar: { stripe: '#6366F1', fg: '#3730A3', bg: '#E0E7FF', btn: 'Ver', btnBg: '#fff', btnFg: '#334155', btnBorder: '#CBD5E1' },
};

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}

function stateLabel(w: AssistantWorkItem): string {
  if (w.state === 'vencida') return 'Vencida';
  if (w.state === 'observada') return 'Observada';
  if (w.state === 'por_revisar') return 'Por revisar';
  if (w.days_left === 0) return 'Vence hoy';
  if (w.days_left === 1) return 'Vence mañana';
  return 'Pendiente';
}

function dueText(w: AssistantWorkItem): { text: string; urgent: boolean } {
  const d = w.days_left;
  const date = shortDate(w.due_date);
  if (w.state === 'por_revisar') return { text: 'Enviada — esperando la revisión del supervisor', urgent: false };
  if (d === undefined || d === null) {
    return { text: w.state === 'observada' ? 'Corrige y vuelve a cargar' : 'Sin fecha límite configurada', urgent: w.state === 'observada' };
  }
  if (d < 0) {
    const ago = d === -1 ? 'ayer' : `hace ${Math.abs(d)} días`;
    return { text: `Venció ${ago}${date ? ` (${date})` : ''}${w.state === 'observada' ? ' — corrige y vuelve a cargar' : ''}`, urgent: true };
  }
  if (d === 0) return { text: 'Vence hoy', urgent: true };
  if (d === 1) return { text: `Vence mañana${date ? ` (${date})` : ''}`, urgent: true };
  return { text: `En ${d} días${date ? ` (${date})` : ''}`, urgent: d <= 3 };
}

/**
 * "Mi panel" del asistente: responde "¿qué tengo que hacer hoy?". Una sola lista de trabajo con todo lo
 * que le falta en todos los módulos (ordenada por urgencia), lo que le devolvió el supervisor con su
 * comentario, y su avance — todo sobre SUS empresas asignadas.
 */
const AssistantWorkspace = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsControlsView), []);
  const me = auth.getUser();
  const firstName = (me?.name || me?.username || '').split(/\s+/)[0] || '';

  const [periodYm, setPeriodYm] = useState(previousMonthPeriodYM());
  const [moduleFilter, setModuleFilter] = useState('');
  const [tab, setTab] = useState<Tab>('todas');
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState<AssistantOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void supervisorsService
      .assistantOverview({ period_ym: periodYm })
      .then((res) => {
        if (!cancelled) setData(res);
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
  }, [allowed, periodYm]);

  const work = useMemo(() => (data?.work ?? []).filter((w) => !moduleFilter || w.module_key === moduleFilter), [data, moduleFilter]);
  const counts = useMemo(
    () => ({
      todas: work.length,
      vencidas: work.filter((w) => w.state === 'vencida').length,
      observadas: work.filter((w) => w.state === 'observada').length,
      semana: work.filter((w) => w.state === 'pendiente' && (w.days_left ?? 99) >= 0 && (w.days_left ?? 99) <= 7).length,
      revisar: work.filter((w) => w.state === 'por_revisar').length,
    }),
    [work],
  );
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
  const tabTotal = counts[tab];

  const detailPath = (w: AssistantWorkItem) => {
    const slug = MODULE_SLUG[w.module_key];
    return slug ? `/assistant/activities/${slug}/${w.company_id}?period_ym=${encodeURIComponent(periodYm)}` : '/assistant';
  };

  if (!allowed) {
    return <p className="p-6 text-center text-slate-600">Sin permiso para el panel de asistente.</p>;
  }

  const cs = data?.compliance;
  const trend = data?.trend ?? [];
  const pctSeries = trend.map((t) => t.compliance_pct);
  const trendDelta = pctSeries.length >= 2 ? Math.round((pctSeries[pctSeries.length - 1] - pctSeries[pctSeries.length - 2]) * 10) / 10 : null;
  const slices: DonutSlice[] = cs
    ? [
        { label: 'Cumplido a tiempo', value: cs.on_time, color: DASH_COLORS.ok },
        { label: 'Entregado fuera de fecha', value: cs.late, color: DASH_COLORS.late },
        { label: 'Vencido sin entregar', value: cs.missing, color: DASH_COLORS.over },
        { label: 'Pendiente (sin vencer)', value: cs.pending, color: DASH_COLORS.pend },
        { label: 'Exento o no aplica', value: cs.exempt, color: DASH_COLORS.exempt },
      ]
    : [];
  const returned = (data?.work ?? []).filter((w) => w.state === 'observada').slice(0, 3);
  const waiting = (data?.work ?? []).filter((w) => w.state === 'por_revisar').slice(0, 4);
  const modulesPresent = Array.from(new Map((data?.work ?? []).map((w) => [w.module_key, w.module_label])).entries());

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'todas', label: 'Todas' },
    { id: 'vencidas', label: 'Vencidas' },
    { id: 'observadas', label: 'Observadas' },
    { id: 'semana', label: 'Vencen esta semana' },
    { id: 'revisar', label: 'Por revisar' },
  ];

  const firstUrgent = (data?.work ?? []).find((w) => w.state !== 'por_revisar');

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-[280px] flex-1">
          <h1 className="m-0 text-[26px] font-extrabold tracking-tight text-slate-900">{firstName ? `Hola, ${firstName}` : 'Mi panel'}</h1>
          <p className="mt-1 text-[13px] text-slate-600">
            {data ? (
              <>
                Tienes <strong className="text-red-700">{data.counts.overdue} {data.counts.overdue === 1 ? 'entrega vencida' : 'entregas vencidas'}</strong> y{' '}
                <strong className="text-amber-700">{data.counts.due_this_week} que {data.counts.due_this_week === 1 ? 'vence' : 'vencen'} esta semana</strong> · {data.companies} empresas asignadas
              </>
            ) : (
              'Lo que tienes que hacer en el período.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[3px] text-xs">
            <span className="text-slate-500">Período</span>
            <input type="month" value={periodYm} onChange={(e) => setPeriodYm(e.target.value)} className="border-0 bg-transparent py-[3px] pr-1 text-xs font-bold outline-none" />
          </label>
          <label className="flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[3px] text-xs">
            <span className="text-slate-500">Módulo</span>
            <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="border-0 bg-transparent py-[3px] pr-1 text-xs font-bold outline-none">
              <option value="">Todos</option>
              {modulesPresent.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
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
      ) : data ? (
        <>
          <div className="flex flex-wrap gap-3">
            <HeroGauge
              pct={cs?.compliance_pct ?? 0}
              title="Mi cumplimiento"
              line1={trendDelta === null ? 'Cumplimiento del período' : `${trendDelta >= 0 ? '▲ +' : '▼ −'}${Math.abs(trendDelta)} pts vs. período anterior`}
              line2={cs ? `${cs.on_time} a tiempo de ${cs.on_time + cs.late + cs.missing} que cuentan` : undefined}
            />
            <KpiTile label="Por entregar" value={data.counts.to_deliver} delta="pendientes + vencidas" deltaTone="warn" icon="fas fa-clock" color="#B45309" soft="#FFFFFF" tint="#FEF3C7" tintBorder="#FDE68A" />
            <KpiTile label="Vencidas" value={data.counts.overdue} delta={`${data.counts.overdue_over_3_days} con más de 3 días`} deltaTone="bad" icon="fas fa-exclamation-triangle" color="#DC2626" soft="#FFFFFF" tint="#FEE2E2" tintBorder="#FECACA" />
            <KpiTile label="Observadas" value={data.counts.observed} delta="te las devolvieron" deltaTone="warn" icon="fas fa-comment-dots" color="#C2410C" soft="#FFFFFF" tint="#FFEDD5" tintBorder="#FED7AA" />
            <KpiTile label="Por revisar" value={data.counts.in_review} delta="esperan al supervisor" deltaTone="neutral" icon="fas fa-clipboard-check" color="#4338CA" soft="#FFFFFF" tint="#E0E7FF" tintBorder="#C7D2FE" />
          </div>

          <div className="flex flex-wrap items-start gap-[14px]">
            <div className="flex min-w-0 flex-col gap-[14px]" style={{ flex: '2.3 1 600px' }}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="m-0 text-[15px] font-extrabold">Mi lista de trabajo</h2>
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
                        className={`flex items-center gap-[6px] rounded-[9px] px-3 py-[6px] text-xs ${sel ? 'border-[1.5px] border-[#0E8F47] bg-[#E3F5EA] font-bold text-[#0A5A3A]' : 'border border-[#DCE8E1] bg-white font-semibold text-slate-700'}`}
                      >
                        {t.label}
                        <span className={`rounded-[7px] px-[6px] text-[10.5px] font-extrabold ${sel ? 'bg-[#0E8F47] text-white' : 'bg-[#EEF3F0] text-slate-600'}`}>{counts[t.id]}</span>
                      </button>
                    );
                  })}
                </div>
                {shown.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-500">
                    {counts.todas === 0 ? '¡Todo al día! No tienes entregas pendientes en este período.' : 'No hay entregas en esta pestaña.'}
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {shown.map((w) => {
                      const st = STATE_STYLE[w.state];
                      const due = dueText(w);
                      return (
                        <div key={`${w.module_key}-${w.company_id}`} className="flex items-start gap-3 border-t border-[#EAF1ED] py-[11px]">
                          <div className="w-1 shrink-0 self-stretch rounded" style={{ background: st.stripe }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-[13px]">{w.company}</strong>
                              <span className="rounded-md bg-slate-100 px-[7px] py-px text-[10.5px] font-bold text-slate-700">{w.module_label}</span>
                              <span className="rounded-md px-[7px] py-px text-[10.5px] font-extrabold" style={{ background: st.bg, color: st.fg }}>{stateLabel(w)}</span>
                            </div>
                            <div className={`mt-[3px] text-[11.5px] ${due.urgent ? 'font-bold text-red-700' : 'text-slate-600'}`}>{due.text}</div>
                            {w.state === 'observada' && w.note ? (
                              <div className="mt-[7px] rounded-[9px] border border-orange-200 bg-orange-50 px-[10px] py-[7px] text-[11.5px] text-orange-950">
                                <strong>{w.note_by || 'Supervisor'}:</strong> {w.note}
                              </div>
                            ) : null}
                          </div>
                          <Link
                            to={detailPath(w)}
                            className="shrink-0 whitespace-nowrap rounded-[9px] border px-[14px] py-[7px] text-xs font-bold hover:opacity-90"
                            style={{ background: st.btnBg, color: st.btnFg, borderColor: st.btnBorder }}
                          >
                            {st.btn}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
                {tabTotal > 8 ? (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full border-t border-[#EAF1ED] pb-2 pt-[10px] text-center text-xs font-bold text-[#0A5A3A]">
                    {showAll ? 'Ver menos' : `Ver las ${tabTotal} →`}
                  </button>
                ) : null}
              </Card>

              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="m-0 text-[15px] font-extrabold">Mis módulos</h2>
                  <span className="text-[11.5px] text-slate-500">avance de mis {data.companies} empresas</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-[22px] gap-y-[10px]">
                  {data.modules.map((m) => {
                    const done = m.a_tiempo + m.fuera_fecha;
                    const pct = m.total > 0 ? Math.round((done / m.total) * 100) : 0;
                    const slug = MODULE_SLUG[m.key];
                    return (
                      <Link key={m.key} to={slug ? `/assistant/activities/${slug}?period_ym=${encodeURIComponent(periodYm)}` : '/assistant'} className="block min-w-0 rounded-xl border border-[#EAF1ED] px-3 py-[10px] text-inherit no-underline hover:bg-slate-50/60" style={{ flex: '1 1 280px' }}>
                        <div className="mb-[6px] flex items-center justify-between gap-2">
                          <strong className="text-[12.5px]">{m.label}</strong>
                          <span className="flex items-center gap-2">
                            {m.sin_completar > 0 ? <span className="rounded-[7px] bg-amber-100 px-[7px] py-px text-[10.5px] font-extrabold text-amber-800">{m.sin_completar} por hacer</span> : null}
                            <span className="text-[11px] font-bold text-[#0A5A3A]">Abrir →</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-[10px]">
                          <div className="h-2 flex-1 overflow-hidden rounded bg-[#EEF3F0]">
                            <div className="h-full rounded" style={{ width: `${pct}%`, background: pct >= 75 ? '#12A150' : pct >= 50 ? '#F59E0B' : '#DC2626' }} />
                          </div>
                          <span className="w-[92px] text-right text-[11.5px] font-extrabold tabular-nums">{done} / {m.total} · {pct}%</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </Card>

              <Card className="flex flex-wrap gap-x-[22px] gap-y-4">
                <div className="min-w-0" style={{ flex: '1 1 280px' }}>
                  <h2 className="m-0 text-sm font-extrabold">Cómo van mis empresas</h2>
                  <p className="mb-[10px] mt-[2px] text-[11.5px] text-slate-500">{data.companies} empresas · {periodYm}</p>
                  <div className="flex items-center gap-[14px]">
                    <Donut slices={slices} size={112} center={data.companies} caption="empresas" label="Estado de mis empresas" />
                    <DonutLegend slices={slices} />
                  </div>
                </div>
                <div className="min-w-0 border-l border-[#EAF1ED] pl-[22px]" style={{ flex: '1.2 1 320px' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="m-0 text-sm font-extrabold">Mi cumplimiento (6 meses)</h2>
                    {trendDelta !== null ? (
                      <span className="rounded-[7px] px-2 py-[2px] text-[11px] font-bold" style={{ background: trendDelta >= 0 ? '#E3F5EA' : '#FEE2E2', color: trendDelta >= 0 ? '#0A5A3A' : '#B91C1C' }}>
                        {trendDelta >= 0 ? '▲' : '▼'} {Math.abs(trendDelta)} pts
                      </span>
                    ) : null}
                  </div>
                  <TrendArea points={trend.map((t) => ({ label: monthLabel(t.period_ym), value: t.compliance_pct }))} />
                </div>
              </Card>
            </div>

            <aside className="flex min-w-0 max-w-[380px] flex-col gap-[14px]" style={{ flex: '1 1 300px' }}>
              <Card accent="#F59E0B">
                <div className="mb-[10px] flex items-center justify-between">
                  <h2 className="m-0 text-sm font-extrabold">Vencimientos de la semana</h2>
                  <span className="text-[10.5px] text-slate-500">mis empresas sin entregar</span>
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
                  <h2 className="m-0 text-sm font-extrabold">Lo que te devolvió el supervisor</h2>
                  <span className="rounded-[7px] bg-orange-100 px-2 py-px text-[11.5px] font-extrabold text-orange-800">{data.counts.observed}</span>
                </div>
                <p className="mb-2 mt-0 text-[11px] text-slate-500">Corrige y vuelve a cargar: reemplaza el archivo anterior.</p>
                {returned.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">No tienes entregas devueltas.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {returned.map((r) => (
                      <div key={`${r.module_key}-${r.company_id}`} className="rounded-[11px] border border-orange-200 bg-orange-50 px-[11px] py-[9px]">
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
                  <span className="rounded-[7px] bg-indigo-100 px-2 py-px text-[11.5px] font-extrabold text-indigo-800">{data.counts.in_review}</span>
                </div>
                {waiting.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">Nada pendiente de revisión.</p>
                ) : (
                  <div className="flex flex-col">
                    {waiting.map((q) => (
                      <div key={`${q.module_key}-${q.company_id}`} className="flex items-center gap-2 border-t border-[#EAF1ED] py-[7px]">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold" title={q.company}>{q.company}</div>
                          <div className="text-[10.5px] text-slate-500">{q.module_label}</div>
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
    </div>
  );
};

export default AssistantWorkspace;
