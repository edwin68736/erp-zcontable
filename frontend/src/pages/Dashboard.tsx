import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import client from '../api/client';
import { Card, HeroGauge, KpiTile } from '../components/supervisors/dashboard/DashboardParts';
import { P } from '../rbac/codes';
import { auth } from '../services/auth';
import type { FinanceOverview } from '../types/dashboard';
import { extractApiErrorMessage } from '../utils/apiError';
import { periodDebtMoraBadge } from '../utils/periodDebtScore';

const money = (n: number) => `S/ ${Math.round(n).toLocaleString('es-PE')}`;
const money2 = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS_ES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'set.', 'oct.', 'nov.', 'dic.'];
const periodLabel = (ym?: string) => {
  if (!ym || ym.length < 7) return '—';
  return `${MONTHS_ES[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;
};
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
const shortDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
};
const ago = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
};
const SUP_COLORS = ['#0E8F47', '#2563EB', '#C2410C', '#7C3AED', '#0891B2', '#DB2777'];
const AGING_COLORS = ['#12A150', '#F59E0B', '#F97316', '#DC2626'];

/** Escala "bonita" del eje: el máximo sube al múltiplo redondo siguiente. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const step = mag / 2;
  return Math.ceil(max / step) * step;
}
const kFmt = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })}k` : String(Math.round(n)));

const MORA_TABS = [
  { value: '', label: 'Todas' },
  { value: '1', label: '≥ 1 mes' },
  { value: '2', label: '≥ 2 meses' },
  { value: '3', label: '≥ 3 meses' },
];

const Dashboard = () => {
  const canViewDashboard = auth.hasPermission(P.dashboardView);
  const canPay = auth.hasPermission(P.paymentsCreate);
  const canDebt = auth.hasPermission(P.documentsCreate);
  const canReports = auth.hasPermission(P.reportsFinancialView);
  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState(currentYear);
  const [minOverdue, setMinOverdue] = useState('');
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!canViewDashboard) return;
    let cancelled = false;
    if (loadedOnce.current) setRefreshing(true);
    else setLoading(true);
    void client
      .get<{ data: FinanceOverview }>('/dashboard/overview', { params: { year, min_overdue_months: minOverdue || undefined } })
      .then((res) => {
        if (cancelled) return;
        setData(res.data.data);
        setError('');
        loadedOnce.current = true;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(extractApiErrorMessage(err, 'No se pudo cargar el dashboard'));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewDashboard, year, minOverdue]);

  if (!canViewDashboard) return <Navigate to="/" replace />;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex animate-pulse items-center gap-2 font-medium text-primary-700">
          <i className="fas fa-spinner fa-spin" /> Cargando dashboard...
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
        <p className="mb-2 font-bold">Error</p>
        <p>{error || 'No se pudieron cargar los datos'}</p>
        <button onClick={() => window.location.reload()} className="mt-4 rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-red-50">
          Reintentar
        </button>
      </div>
    );
  }

  const studio = data.studio;
  const todayText = new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
  const overduePct = data.balance > 0 ? Math.round((data.overdue / data.balance) * 100) : 0;
  const debtCompanyPct = data.companies > 0 ? ((data.companies_with_debt / data.companies) * 100).toFixed(1) : '0.0';

  // Cobrado del mes frente al mismo día del mes anterior (comparación justa: no mes parcial vs. entero).
  const monthDelta =
    data.collected_prev_month_to_day > 0
      ? Math.round(((data.collected_this_month - data.collected_prev_month_to_day) / data.collected_prev_month_to_day) * 100)
      : null;

  // Hero: cobranza del año. Estudio → vs. año anterior; cartera → vs. promedio del estudio.
  const heroDiff = studio
    ? data.prev_year_collection_pct > 0
      ? Math.round((data.year_collection_pct - data.prev_year_collection_pct) * 10) / 10
      : null
    : data.studio_year_pct !== undefined && data.studio_year_pct > 0
      ? Math.round((data.year_collection_pct - data.studio_year_pct) * 10) / 10
      : null;
  const heroLine1 =
    heroDiff === null
      ? 'Sin año anterior para comparar'
      : studio
        ? `${heroDiff >= 0 ? '▲ +' : '▼ −'}${Math.abs(heroDiff)} pts vs. ${data.year - 1} a esta fecha`
        : `${heroDiff >= 0 ? '▲ +' : '▼ −'}${Math.abs(heroDiff)} pts ${heroDiff >= 0 ? 'sobre' : 'bajo'} el estudio (${data.studio_year_pct}%)`;

  // Gráfico facturado vs cobrado
  const maxVal = niceMax(Math.max(0, ...data.months.map((m) => Math.max(m.billed, m.collected))));
  const ticks = [maxVal, (maxVal * 2) / 3, maxVal / 3, 0];
  const agingTotal = data.aging.reduce((a, b) => a + b.amount, 0);

  // Alertas derivadas
  type Alert = { key: string; title: string; text: string; color: string; soft: string; icon: string };
  const alerts: Alert[] = [];
  if (data.companies_lag_3_plus > 0) {
    alerts.push({
      key: 'lag3',
      title: `${data.companies_lag_3_plus} empresas con 3 meses o más de atraso`,
      text: `Suman ${money(data.lag_3_plus_amount)} — el ${data.balance > 0 ? Math.round((data.lag_3_plus_amount / data.balance) * 100) : 0}% del saldo.`,
      color: '#DC2626', soft: '#FEF2F2', icon: 'fas fa-exclamation-triangle',
    });
  }
  if (data.overdue_docs > 0) {
    alerts.push({
      key: 'overdue',
      title: `${data.overdue_docs} documentos vencidos`,
      text: `${money(data.overdue)} (${overduePct}% del saldo) con fecha de vencimiento ya pasada.`,
      color: '#B45309', soft: '#FFF7E6', icon: 'fas fa-clock',
    });
  }
  if (data.due_next_30_docs > 0) {
    alerts.push({
      key: 'due30',
      title: `${data.due_next_30_docs} documentos vencen en 30 días`,
      text: `${money(data.due_next_30)} que hoy están al día.`,
      color: '#4338CA', soft: '#EEF2FF', icon: 'fas fa-calendar-day',
    });
  }
  if (monthDelta !== null && monthDelta < -20 && data.current_day >= 7) {
    alerts.push({
      key: 'pace',
      title: 'Cobranza del mes por debajo del ritmo anterior',
      text: `${money(data.collected_this_month)} cobrados vs. ${money(data.collected_prev_month_to_day)} a esta misma fecha del mes pasado.`,
      color: '#7C3AED', soft: '#F5F3FF', icon: 'fas fa-chart-line',
    });
  }

  const maxOwner = Math.max(1, ...data.owners.map((o) => o.balance));
  const cmpMonths = data.months.filter((m) => m.billed > 0).slice(-5);

  return (
    <div className="space-y-[14px] pt-2">
      {/* encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-[280px] flex-1">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h1 className="m-0 text-[26px] font-extrabold tracking-tight text-slate-900">Dashboard financiero</h1>
            {studio ? (
              <span className="rounded-full border border-[#BFE5CF] bg-[#E3F5EA] px-[10px] py-[2px] text-[11.5px] font-bold text-[#0A5A3A]">Vista del estudio</span>
            ) : (
              <span className="inline-flex items-center gap-[5px] rounded-full border border-indigo-200 bg-indigo-100 px-[10px] py-[2px] text-[11.5px] font-bold text-indigo-800">
                <i className="fas fa-lock text-[9px]" aria-hidden /> Mi cartera
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-slate-600">
            <strong className="text-slate-900">{data.companies} {studio ? 'empresas' : 'empresas asignadas'}</strong> · {data.documents_count.toLocaleString('es-PE')} deudas · {data.payments_count.toLocaleString('es-PE')} pagos · al {todayText}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-[6px] rounded-[9px] border border-[#DCE8E1] bg-white px-[10px] py-[3px] text-xs">
            <span className="text-slate-500">Año</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border-0 bg-transparent py-[3px] pr-1 text-xs font-bold outline-none">
              {[0, 1, 2, 3].map((d) => (
                <option key={d} value={currentYear - d}>
                  {currentYear - d}
                </option>
              ))}
            </select>
          </label>
          {canPay ? (
            <Link to="/payments/new" className="rounded-[9px] border border-[#0E8F47] bg-[#0E8F47] px-[14px] py-2 text-xs font-bold text-white hover:bg-[#0A7A3B]">+ Registrar pago</Link>
          ) : null}
          {canDebt ? (
            <Link to="/documents/new" className="rounded-[9px] border border-[#0E8F47] bg-white px-[14px] py-2 text-xs font-bold text-[#0A5A3A] hover:bg-[#E3F5EA]">+ Nueva deuda</Link>
          ) : null}
          {canReports ? (
            <Link to="/reports/financial" className="rounded-[9px] border border-[#DCE8E1] bg-white px-[14px] py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Reportes</Link>
          ) : null}
        </div>
      </div>

      {!studio ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#D9DEFB] bg-[#F3F5FF] px-3 py-2">
          <i className="fas fa-lock text-[12px] text-indigo-800" aria-hidden />
          <span className="text-xs text-indigo-950">
            <strong>Solo ves lo tuyo:</strong> las deudas y pagos de tus empresas asignadas. Del resto del estudio solo se muestra el promedio de cobranza, para compararte.
          </span>
        </div>
      ) : null}

      {/* totales */}
      <div className="flex flex-wrap gap-3">
        <HeroGauge pct={data.year_collection_pct} title={studio ? 'Cobranza del año' : 'Cobranza de mi cartera'} line1={heroLine1} line2={`${money(data.year_collected)} cobrados de ${money(data.year_billed)} facturados`} />
        <KpiTile label="Saldo por cobrar" value={money(data.balance)} sub={`deudas ${money(data.total_docs)} · pagos ${money(data.total_pays)}`} icon="fas fa-coins" color="#0369A1" soft="#FFFFFF" tint="#E0F2FE" tintBorder="#BAE6FD" />
        <KpiTile label="Vencido" value={money(data.overdue)} delta={`${overduePct}% del saldo`} deltaTone={data.overdue > 0 ? 'bad' : 'neutral'} sub={`${data.overdue_docs} documentos con fecha ya pasada`} icon="fas fa-exclamation-triangle" color="#DC2626" soft="#FFFFFF" tint="#FEE2E2" tintBorder="#FECACA" />
        <KpiTile label="Por vencer (30 días)" value={money(data.due_next_30)} delta={`${data.due_next_30_docs} documentos`} deltaTone="warn" sub="pasa a vencido si no se cobra" icon="fas fa-clock" color="#B45309" soft="#FFFFFF" tint="#FEF3C7" tintBorder="#FDE68A" />
        <KpiTile
          label={`Cobrado en ${new Date().toLocaleDateString('es-PE', { month: 'long' })}`}
          value={money(data.collected_this_month)}
          delta={monthDelta === null ? 'sin cobros a esta fecha del mes pasado' : `${monthDelta >= 0 ? '▲ +' : '▼ −'}${Math.abs(monthDelta)}% vs. mismo día del mes pasado`}
          deltaTone={monthDelta === null ? 'neutral' : monthDelta >= 0 ? 'good' : 'bad'}
          sub={`mes anterior completo: ${money(data.collected_prev_month_full)}`}
          icon="fas fa-check" color="#12A150" soft="#FFFFFF" tint="#DCFCE7" tintBorder="#BBF7D0"
        />
        <KpiTile label="Empresas con deuda" value={data.companies_with_debt} delta={`${debtCompanyPct}% de ${data.companies} empresas`} deltaTone="neutral" sub={`${data.companies_lag_3_plus} con 3 meses o más de atraso`} icon="fas fa-building" color="#4338CA" soft="#FFFFFF" tint="#E0E7FF" tintBorder="#C7D2FE" />
      </div>

      <div className="flex flex-wrap items-start gap-[14px]">
        <div className="flex min-w-0 flex-col gap-[14px]" style={{ flex: '2.3 1 600px' }}>
          {/* facturado vs cobrado */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="m-0 text-[15px] font-extrabold">Facturado vs. cobrado por mes</h2>
                <p className="m-0 mt-[2px] text-[11.5px] text-slate-500">Año {data.year} · soles · debajo de cada mes, el % cobrado</p>
              </div>
              <div className="flex gap-3 text-[11px] text-slate-600">
                <span className="flex items-center gap-[5px]"><span className="h-[10px] w-[10px] rounded-sm bg-slate-300" />Facturado</span>
                <span className="flex items-center gap-[5px]"><span className="h-[10px] w-[10px] rounded-sm bg-[#0E8F47]" />Cobrado</span>
              </div>
            </div>
            <div className="mt-3 flex h-[178px] gap-[6px]">
              <div className="flex w-[34px] flex-col justify-between pb-[34px] text-right text-[9.5px] text-slate-500">
                {ticks.map((t, i) => (
                  <span key={i}>{kFmt(t)}</span>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="relative flex-1">
                  {[0, 33.3, 66.6].map((t) => (
                    <div key={t} className="absolute left-0 right-0 h-px bg-[#E4EDE8]" style={{ top: `${t}%` }} />
                  ))}
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-[#CFE0D6]" />
                  <div className="absolute inset-0 flex items-end justify-around gap-[6px] px-1">
                    {data.months.map((m) => (
                      <div key={m.month} className="flex h-full max-w-[46px] flex-1 items-end justify-center gap-[3px]">
                        <div className="flex-1 rounded-t bg-slate-300" style={{ height: `${(m.billed / maxVal) * 100}%` }} title={`${m.label}: facturado ${money(m.billed)}`} />
                        <div className="flex-1 rounded-t bg-[#0E8F47]" style={{ height: `${(m.collected / maxVal) * 100}%` }} title={`${m.label}: cobrado ${money(m.collected)}`} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex h-[34px] justify-around gap-[6px] px-1 pt-[5px]">
                  {data.months.map((m) => {
                    const pct = m.billed > 0 ? Math.round((m.collected / m.billed) * 100) : null;
                    return (
                      <div key={m.month} className="min-w-0 max-w-[46px] flex-1 text-center leading-tight">
                        <div className="text-[9.5px] font-bold text-slate-700">{m.label}</div>
                        <div className="text-[9.5px] font-extrabold" style={{ color: pct === null ? '#94A3B8' : pct >= 90 ? '#0A5A3A' : pct >= 85 ? '#B45309' : '#B91C1C' }}>
                          {pct === null ? '—' : `${pct}%`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          {/* antigüedad + responsables / comparación */}
          <Card className="flex flex-wrap gap-x-[22px] gap-y-4">
            <div className="min-w-0" style={{ flex: '1.1 1 340px' }}>
              <h2 className="m-0 text-[15px] font-extrabold">Antigüedad de la deuda</h2>
              <p className="mb-3 mt-[2px] text-[11.5px] text-slate-500">{money(agingTotal)} por cobrar, según los meses de atraso del período de cada cargo</p>
              <div className="flex h-[18px] gap-[2px] overflow-hidden rounded-[9px] bg-[#EEF3F0]" role="img" aria-label="Distribución de la deuda por antigüedad">
                {data.aging.map((a, i) => (
                  <div key={a.key} style={{ width: `${agingTotal > 0 ? (a.amount / agingTotal) * 100 : 0}%`, background: AGING_COLORS[i] }} />
                ))}
              </div>
              <div className="mt-[14px] grid grid-cols-2 gap-[10px]">
                {data.aging.map((a, i) => (
                  <div key={a.key} className="rounded-xl border border-[#EAF1ED] px-[11px] py-[9px]">
                    <div className="flex items-center gap-[7px] text-[11.5px] text-slate-700">
                      <span className="h-[9px] w-[9px] rounded-full" style={{ background: AGING_COLORS[i] }} />
                      {a.label}
                    </div>
                    <div className="mt-[3px] text-[17px] font-extrabold tabular-nums">{money(a.amount)}</div>
                    <div className="text-[10.5px] text-slate-500">
                      {agingTotal > 0 ? ((a.amount / agingTotal) * 100).toFixed(1) : '0.0'}% · {a.companies} empresas
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0 border-l border-[#EAF1ED] pl-[22px]" style={{ flex: '1 1 280px' }}>
              {studio ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="m-0 text-[15px] font-extrabold">Deuda por responsable</h2>
                      <p className="m-0 mt-[2px] text-[11.5px] text-slate-500">saldo por cobrar · parte vencida · por supervisor</p>
                    </div>
                    <span className="rounded-md bg-[#0A5A3A] px-[7px] py-[3px] text-[10px] font-extrabold tracking-[0.5px] text-white">SOLO ADMIN</span>
                  </div>
                  <div className="mt-[14px] flex flex-col gap-[14px]">
                    {data.owners.length === 0 ? <p className="text-xs text-slate-500">Sin deuda por responsable.</p> : null}
                    {data.owners.map((o, i) => (
                      <div key={o.user_id}>
                        <div className="mb-1 flex items-baseline justify-between text-xs">
                          <span className="flex items-center gap-[7px] font-bold">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-extrabold text-white" style={{ background: o.user_id === 0 ? '#94A3B8' : SUP_COLORS[i % SUP_COLORS.length] }}>
                              {initialsOf(o.name)}
                            </span>
                            {o.name}
                          </span>
                          <span className="tabular-nums"><strong>{money(o.balance)}</strong> <span className="font-bold text-red-700">· {money(o.overdue)} venc.</span></span>
                        </div>
                        <div className="relative h-[9px] overflow-hidden rounded-[5px] bg-[#EEF3F0]">
                          <div className="h-full rounded-[5px] bg-red-300" style={{ width: `${(o.balance / maxOwner) * 100}%` }} />
                          <div className="absolute left-0 top-0 h-full rounded-[5px] bg-red-600" style={{ width: `${(o.overdue / maxOwner) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h2 className="m-0 text-[15px] font-extrabold">Mi cobranza vs. estudio</h2>
                  <p className="mb-[14px] mt-[2px] text-[11.5px] text-slate-500">% cobrado de lo facturado, por mes</p>
                  <div className="flex flex-col gap-3">
                    {cmpMonths.map((m) => {
                      const mine = m.billed > 0 ? Math.round((m.collected / m.billed) * 100) : 0;
                      const st = Math.round(m.studio_pct ?? 0);
                      return (
                        <div key={m.month} className="flex items-center gap-[10px]">
                          <div className="w-[38px] shrink-0 text-[11px] font-bold text-slate-700">{m.label}</div>
                          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                            <div className="h-2 overflow-hidden rounded bg-[#EEF3F0]"><div className="h-full rounded bg-[#0E8F47]" style={{ width: `${mine}%` }} /></div>
                            <div className="h-2 overflow-hidden rounded bg-[#EEF3F0]"><div className="h-full rounded bg-slate-400" style={{ width: `${st}%` }} /></div>
                          </div>
                          <div className="w-[78px] shrink-0 text-right text-[11px] tabular-nums"><strong className="text-[#0A5A3A]">{mine}%</strong> <span className="text-slate-500">/ {st}%</span></div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex gap-3 text-[10.5px] text-slate-600">
                    <span className="flex items-center gap-[5px]"><span className="h-[9px] w-[9px] rounded-sm bg-[#0E8F47]" />Mi cartera</span>
                    <span className="flex items-center gap-[5px]"><span className="h-[9px] w-[9px] rounded-sm bg-slate-400" />Promedio del estudio</span>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* empresas por cobrar */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-[10px]">
              <div>
                <h2 className="m-0 text-[15px] font-extrabold">{studio ? 'Empresas por cobrar' : 'Mis empresas por cobrar'}</h2>
                <p className="m-0 mt-[2px] text-[11.5px] text-slate-500">Las de mayor saldo · {data.companies_with_debt} empresas tienen deuda</p>
              </div>
              <div role="group" aria-label="Atraso mínimo" className="flex gap-[6px]">
                {MORA_TABS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={minOverdue === t.value}
                    disabled={refreshing}
                    onClick={() => setMinOverdue(t.value)}
                    className={`rounded-[9px] px-[11px] py-[6px] text-[11.5px] ${minOverdue === t.value ? 'border-[1.5px] border-[#0E8F47] bg-[#E3F5EA] font-bold text-[#0A5A3A]' : 'border border-[#DCE8E1] bg-white font-semibold text-slate-700'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={`mt-2 overflow-x-auto ${refreshing ? 'pointer-events-none opacity-60' : ''}`}>
              <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-[0.4px] text-slate-500">
                    <th scope="col" className="py-2 pr-2 font-bold">Empresa</th>
                    <th scope="col" className="p-2 font-bold">Período más antiguo</th>
                    <th scope="col" className="p-2 font-bold">Atraso</th>
                    <th scope="col" className="p-2 text-right font-bold">Saldo</th>
                    <th scope="col" className="py-2 pl-2 text-right font-bold">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.debtors.length === 0 ? (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-500">{minOverdue ? 'Ninguna empresa con saldo cumple ese atraso mínimo.' : 'No hay empresas con saldo pendiente. 🎉'}</td></tr>
                  ) : null}
                  {data.debtors.map((d) => {
                    const mora = periodDebtMoraBadge(d.max_overdue_months, d.max_overdue_months > 0);
                    return (
                      <tr key={d.company_id} className="border-t border-[#EAF1ED]">
                        <th scope="row" className="py-[10px] pr-2 text-left font-bold">
                          <div className="flex items-center gap-[9px]">
                            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#E3F5EA] text-[10px] font-extrabold text-[#0A5A3A]">{initialsOf(d.trade_name || d.business_name)}</span>
                            <span>
                              {d.business_name}
                              <span className="block text-[10.5px] font-medium text-slate-500">Cód. {d.code} · RUC {d.ruc}</span>
                            </span>
                          </div>
                        </th>
                        <td className="p-[10px] text-slate-600">{periodLabel(d.oldest_open_debt_period)}</td>
                        <td className="p-[10px]"><span className={`whitespace-nowrap rounded-md px-2 py-[2px] text-[11px] font-extrabold ${mora.cls}`}>{mora.label}</span></td>
                        <td className={`p-[10px] text-right font-extrabold tabular-nums ${d.balance > 5000 ? 'text-red-600' : d.balance > 2000 ? 'text-amber-600' : 'text-slate-900'}`}>{money2(d.balance)}</td>
                        <td className="whitespace-nowrap py-[10px] pl-2 text-right">
                          <Link to={`/companies/${d.company_id}/statement`} className="rounded-lg border border-slate-300 bg-white px-[10px] py-[6px] text-[11.5px] font-bold text-slate-700 hover:bg-slate-50">Estado de cuenta</Link>
                          {canPay ? (
                            <Link to={`/payments/new?company_id=${d.company_id}`} className="ml-1 rounded-lg border border-[#0E8F47] bg-[#0E8F47] px-[10px] py-[6px] text-[11.5px] font-bold text-white hover:bg-[#0A7A3B]">Registrar pago</Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-1 border-t border-[#EAF1ED] pt-[10px] text-center text-xs font-bold text-[#0A5A3A]">
              <Link to="/companies">Ver las {data.companies_with_debt} empresas con deuda →</Link>
            </div>
          </Card>
        </div>

        {/* riel */}
        <aside className="flex min-w-0 max-w-[380px] flex-col gap-[14px]" style={{ flex: '1 1 300px' }}>
          <Card accent="#F59E0B">
            <div className="mb-[10px] flex items-center justify-between">
              <h2 className="m-0 text-sm font-extrabold">Para cobrar esta semana</h2>
              <span className="text-[10.5px] text-slate-500">próximos 7 días</span>
            </div>
            {data.due_soon.length === 0 ? (
              <p className="py-3 text-center text-xs text-slate-500">No hay documentos por vencer esta semana.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.due_soon.map((w) => {
                  const tone = w.days_left === 0 ? { c: '#B91C1C', s: '#FEE2E2' } : w.days_left <= 2 ? { c: '#B45309', s: '#FEF3C7' } : { c: '#1D4ED8', s: '#DBEAFE' };
                  return (
                    <div key={w.document_id} className="flex items-center gap-[10px] rounded-[10px] border border-[#EAF1ED] px-[10px] py-[7px]">
                      <div className="w-[54px] shrink-0 rounded-lg px-[2px] py-[5px] text-center" style={{ background: tone.s, color: tone.c }}>
                        <div className="text-[13px] font-extrabold leading-tight">{w.days_left === 0 ? 'Hoy' : w.days_left === 1 ? 'Mañana' : `${w.days_left} d`}</div>
                        <div className="text-[9px] font-bold uppercase">{shortDate(w.due_date)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold" title={w.company}>{w.company}</div>
                        <div className="text-[10.5px] text-slate-500">{w.document_type} · {w.number}</div>
                      </div>
                      <div className="text-[12.5px] font-extrabold tabular-nums">{money(w.balance)}</div>
                    </div>
                  );
                })}
                <div className="mt-1 flex justify-between text-[11.5px] text-slate-700"><span>Total de la semana</span><strong>{money(data.due_soon_total)}</strong></div>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-[10px] flex items-center justify-between">
              <h2 className="m-0 text-sm font-extrabold">Alertas de cobranza</h2>
              {canReports ? <Link to="/reports/financial" className="rounded-[7px] bg-[#E3F5EA] px-2 py-[3px] text-[10.5px] font-bold text-[#0A5A3A]">Ver reportes →</Link> : null}
            </div>
            {alerts.length === 0 ? (
              <p className="py-3 text-center text-xs text-slate-500">Sin alertas de cobranza.</p>
            ) : (
              <div className="flex flex-col gap-[7px]">
                {alerts.slice(0, 4).map((a) => (
                  <div key={a.key} className="flex items-start gap-[9px] rounded-[10px] px-[10px] py-2" style={{ background: a.soft }}>
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] text-white" style={{ background: a.color }}>
                      <i className={`${a.icon} text-[10px]`} aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold leading-tight">{a.title}</div>
                      <div className="mt-px text-[11px] text-slate-600">{a.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="m-0 mb-1 text-sm font-extrabold">Movimientos recientes</h2>
            <p className="mb-2 mt-0 text-[11px] text-slate-500">{studio ? 'Pagos y deudas, lo más nuevo primero' : 'Pagos y deudas de mis empresas'}</p>
            {data.movements.length === 0 ? (
              <p className="py-3 text-center text-xs text-slate-500">Sin movimientos.</p>
            ) : (
              <div className="flex flex-col">
                {data.movements.map((m, i) => {
                  const pay = m.kind === 'pago';
                  return (
                    <div key={`${m.kind}-${i}`} className="flex items-center gap-[10px] border-t border-[#EAF1ED] py-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-sm font-extrabold" style={{ background: pay ? '#DCFCE7' : '#FEF3C7', color: pay ? '#0A5A3A' : '#B45309' }}>{pay ? '+' : '−'}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold" title={m.company}>{m.company || 'Sin empresa'}</div>
                        <div className="text-[10.5px] text-slate-500">{m.what} · {ago(m.date)}</div>
                      </div>
                      <div className="text-[12.5px] font-extrabold tabular-nums" style={{ color: pay ? '#0A5A3A' : '#B45309' }}>{pay ? '+ ' : ''}{money(m.amount)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
};

export default Dashboard;
