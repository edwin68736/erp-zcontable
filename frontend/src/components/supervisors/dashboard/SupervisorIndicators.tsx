import { useEffect, useMemo, useState } from 'react';
import { supervisorsService, type IndicatorDigit, type IndicatorKpi, type IndicatorMailboxRow, type SupervisorIndicators } from '../../../services/supervisors';
import { extractApiErrorMessage } from '../../../utils/apiError';
import { Card, DASH_COLORS } from './DashboardParts';

/**
 * "Indicadores de supervisión": los 5 KPI y los gráficos del libro de Excel que cada supervisora llevaba
 * (INDICADORES DE SUPERVISIÓN CONTABLE), calculados con los datos del sistema y con el mismo alcance y
 * filtros del dashboard — un supervisor ve su cartera; el administrador ve el estudio o filtra por uno.
 */

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const periodLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym}-${ym.slice(0, 4)}`;

const ASSISTANT_COLORS = ['#3B82F6', '#F97316', '#6B7280', '#EAB308', '#6366F1', '#22C55E', '#EC4899', '#14B8A6', '#A855F7', '#84CC16'];

type Tone = { fg: string; bg: string; label: string };
const TONE_GOOD: Tone = { fg: '#0A7A3B', bg: '#DCF5E6', label: 'En meta' };
const TONE_WARN: Tone = { fg: '#B45309', bg: '#FEF3C7', label: 'Cerca de la meta' };
const TONE_BAD: Tone = { fg: '#B91C1C', bg: '#FEE2E2', label: 'Bajo la meta' };
const TONE_NONE: Tone = { fg: '#64748B', bg: '#EEF3F0', label: 'Sin datos' };

/** Verde en meta, ámbar hasta 10 puntos por debajo, rojo más abajo. */
function toneFor(rate: number, meta: number, total: number): Tone {
  if (total <= 0) return TONE_NONE;
  if (rate >= meta) return TONE_GOOD;
  if (rate >= meta - 10) return TONE_WARN;
  return TONE_BAD;
}

const fmtPct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

function KpiCard({ n, title, rate, meta, total, sub }: { n: number; title: string; rate: number; meta: string; total: number; sub?: string }) {
  const tone = toneFor(rate, parseFloat(meta.replace(/[^\d.]/g, '')), total);
  return (
    <div className="flex min-w-[150px] flex-1 flex-col overflow-hidden rounded-2xl border border-[#DCE8E1] bg-white">
      <div className="px-3 pt-[10px] text-center">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#0A5A3A]">KPI {n}</div>
        <div className="mt-[2px] text-[13px] font-extrabold leading-tight text-slate-900">{title}</div>
      </div>
      <div className="mt-2 px-3 py-[10px] text-center" style={{ background: tone.bg }}>
        <div className="text-[30px] font-extrabold leading-none tabular-nums" style={{ color: tone.fg }}>
          {total > 0 ? fmtPct(rate) : '—'}
        </div>
      </div>
      <div className="px-3 pb-[10px] pt-[6px] text-center text-[11px] text-slate-500">
        Meta: {meta}
        {sub ? <div className="mt-px text-[10.5px] text-slate-400">{sub}</div> : null}
      </div>
    </div>
  );
}

function SummaryBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#DCE8E1] bg-white px-3 py-2">
      <span className="text-[12px] font-bold leading-tight text-slate-700">{label}</span>
      <span className="text-[20px] font-extrabold tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

/** Barras agrupadas de buzones: una barra por asistente dentro de cada (buzón × estado). */
function MailboxChart({ rows }: { rows: IndicatorMailboxRow[] }) {
  const groups = [
    { key: 'sunat_ok', mailbox: 'SUNAT', label: 'OK' },
    { key: 'sunat_pending', mailbox: 'SUNAT', label: 'PENDIENTE' },
    { key: 'sunat_late', mailbox: 'SUNAT', label: 'FUERA DE PLAZO' },
    { key: 'sunafil_ok', mailbox: 'SUNAFIL', label: 'OK' },
    { key: 'sunafil_pending', mailbox: 'SUNAFIL', label: 'PENDIENTE' },
    { key: 'sunafil_late', mailbox: 'SUNAFIL', label: 'FUERA DE PLAZO' },
  ] as const;
  const max = Math.max(1, ...rows.flatMap((r) => groups.map((g) => r[g.key])));
  const niceMax = Math.max(4, Math.ceil(max / 2) * 2);
  const W = 640;
  const H = 230;
  const left = 30;
  const top = 14;
  const bottom = 52;
  const plotW = W - left - 8;
  const plotH = H - top - bottom;
  const groupW = plotW / groups.length;
  const barW = Math.min(16, (groupW - 10) / Math.max(rows.length, 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Revisión de buzones por asistente">
        {ticks.map((t) => {
          const y = top + plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line x1={left} x2={W - 8} y1={y} y2={y} stroke={DASH_COLORS.grid} strokeWidth="1" />
              <text x={left - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#64748B">
                {t}
              </text>
            </g>
          );
        })}
        {groups.map((g, gi) => {
          const gx = left + gi * groupW;
          const total = rows.length * barW + (rows.length - 1) * 2;
          const start = gx + (groupW - total) / 2;
          return (
            <g key={g.key}>
              {rows.map((r, ri) => {
                const v = r[g.key];
                const h = (v / niceMax) * plotH;
                const x = start + ri * (barW + 2);
                return (
                  <g key={r.assistant}>
                    <rect x={x} y={top + plotH - h} width={barW} height={Math.max(h, 0)} rx="2" fill={ASSISTANT_COLORS[ri % ASSISTANT_COLORS.length]}>
                      <title>{`${r.assistant} · ${g.mailbox} ${g.label}: ${v}`}</title>
                    </rect>
                    {v > 0 ? (
                      <text x={x + barW / 2} y={top + plotH - h - 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#334155">
                        {v}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              <text x={gx + groupW / 2} y={top + plotH + 14} textAnchor="middle" fontSize="9.5" fill="#475569">
                {g.label}
              </text>
            </g>
          );
        })}
        {[0, 1].map((i) => (
          <g key={i}>
            <line x1={left + i * 3 * groupW + 6} x2={left + (i + 1) * 3 * groupW - 6} y1={top + plotH + 24} y2={top + plotH + 24} stroke="#CBD5E1" />
            <text x={left + i * 3 * groupW + (3 * groupW) / 2} y={top + plotH + 38} textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#0F172A">
              {i === 0 ? 'SUNAT' : 'SUNAFIL'}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-600">
        {rows.map((r, i) => (
          <span key={r.assistant} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: ASSISTANT_COLORS[i % ASSISTANT_COLORS.length] }} />
            {r.assistant}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Dos barras por dígito de RUC: total de empresas y las que cumplieron. */
function DigitColumns({ digits, okLabel }: { digits: IndicatorDigit[]; okLabel: string }) {
  const max = Math.max(1, ...digits.map((d) => d.total));
  const niceMax = Math.max(4, Math.ceil(max / 2) * 2);
  const W = 560;
  const H = 230;
  const left = 28;
  const top = 18;
  const bottom = 30;
  const plotW = W - left - 6;
  const plotH = H - top - bottom;
  const groupW = plotW / digits.length;
  const barW = Math.min(20, (groupW - 8) / 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Entrega de planillas por dígito de RUC">
        {ticks.map((t) => {
          const y = top + plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line x1={left} x2={W - 6} y1={y} y2={y} stroke={DASH_COLORS.grid} strokeWidth="1" />
              <text x={left - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#64748B">
                {t}
              </text>
            </g>
          );
        })}
        {digits.map((d, i) => {
          const gx = left + i * groupW;
          const x0 = gx + (groupW - (barW * 2 + 2)) / 2;
          const hTotal = (d.total / niceMax) * plotH;
          const hOk = (d.on_time / niceMax) * plotH;
          return (
            <g key={d.dig}>
              <rect x={x0} y={top + plotH - hTotal} width={barW} height={hTotal} rx="2" fill="#93B8E8">
                <title>{`RUC ${d.dig}: ${d.total} empresas`}</title>
              </rect>
              <rect x={x0 + barW + 2} y={top + plotH - hOk} width={barW} height={hOk} rx="2" fill="#2F8F46">
                <title>{`RUC ${d.dig}: ${d.on_time} ${okLabel}`}</title>
              </rect>
              {d.total > 0 ? (
                <text x={x0 + barW / 2} y={top + plotH - hTotal - 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#334155">
                  {d.total}
                </text>
              ) : null}
              {d.total > 0 ? (
                <text x={x0 + barW + 2 + barW / 2} y={top + plotH - hOk - 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#166534">
                  {d.on_time}
                </text>
              ) : null}
              <text x={gx + groupW / 2} y={top + plotH + 14} textAnchor="middle" fontSize="9.5" fill="#475569">
                RUC {d.dig}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-[10.5px] text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: '#93B8E8' }} />
          Total
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: '#2F8F46' }} />
          {okLabel}
        </span>
      </div>
    </div>
  );
}

/** Tabla por dígito de RUC con barra de avance en la columna de tasa. */
function DigitTable({ kpi, okHeader, showPending }: { kpi: IndicatorKpi; okHeader: string; showPending?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#DCE8E1]">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-[#E9F4EE] text-[10.5px] uppercase tracking-[0.4px] text-[#0A5A3A]">
            <th className="whitespace-nowrap px-2 py-[7px] text-left">Dig</th>
            <th className="whitespace-nowrap px-2 py-[7px] text-right">Total</th>
            <th className="whitespace-nowrap px-2 py-[7px] text-right">{okHeader}</th>
            {showPending ? <th className="whitespace-nowrap px-2 py-[7px] text-right">Pend.</th> : null}
            <th className="w-[38%] px-2 py-[7px] text-left">{showPending ? 'Tasa' : '% Cumplimiento'}</th>
          </tr>
        </thead>
        <tbody>
          {kpi.by_digit.map((d) => {
            const tone = toneFor(d.rate_pct, kpi.meta_pct, d.total);
            return (
              <tr key={d.dig} className="border-t border-[#EAF1ED]">
                <td className="whitespace-nowrap px-2 py-[5px] font-bold text-slate-800">RUC {d.dig}</td>
                <td className="px-2 py-[5px] text-right tabular-nums">{d.total}</td>
                <td className="px-2 py-[5px] text-right tabular-nums">{d.on_time}</td>
                {showPending ? <td className="px-2 py-[5px] text-right tabular-nums">{d.pending + (d.in_review ?? 0) + (d.observed ?? 0)}</td> : null}
                <td className="px-2 py-[5px]">
                  {d.total > 0 ? (
                    <div className="relative h-[18px] overflow-hidden rounded bg-[#EEF3F0]">
                      <div className="h-full rounded" style={{ width: `${Math.min(d.rate_pct, 100)}%`, background: tone.fg, opacity: 0.85 }} />
                      <span className="absolute inset-0 flex items-center justify-center text-[10.5px] font-extrabold text-slate-900">{fmtPct(d.rate_pct)}</span>
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-[340px] flex-[1_1_340px]">
      <div className="mb-[10px]">
        <h3 className="m-0 text-[13px] font-extrabold text-slate-900">{title}</h3>
        {hint ? <p className="m-0 mt-[2px] text-[10.5px] leading-snug text-slate-500">{hint}</p> : null}
      </div>
      {children}
    </Card>
  );
}

type Props = {
  params: {
    period_ym?: string;
    general_status?: string;
    risk_level?: string;
    company_id?: number;
    responsible_user_id?: number;
    supervisor_user_id?: number;
  };
  reloadKey?: number;
};

const SupervisorIndicatorsPanel = ({ params, reloadKey = 0 }: Props) => {
  const [data, setData] = useState<SupervisorIndicators | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void supervisorsService
      .dashboardIndicators(params)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(extractApiErrorMessage(err, 'No se pudieron cargar los indicadores'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params, reloadKey]);

  const kpi = useMemo(() => {
    const byKey = new Map((data?.kpis ?? []).map((k) => [k.key, k]));
    return (key: IndicatorKpi['key']) => byKey.get(key);
  }, [data]);

  const k2 = kpi('planillas');
  const k3 = kpi('archivadores');
  const k4 = kpi('declaraciones');
  const k5 = kpi('balances');

  const supervisorText = useMemo(() => {
    const sups = data?.supervisors ?? [];
    if (sups.length === 0) return 'Sin supervisor asignado';
    if (sups.length === 1) return `Supervisor(a) ${sups[0].name}`;
    return `${sups.length} supervisores`;
  }, [data]);

  return (
    <section className="flex flex-col gap-3" aria-label="Indicadores de supervisión">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0B2A5B] px-4 py-3 text-white">
        <div>
          <h2 className="m-0 text-[17px] font-extrabold tracking-tight">Indicadores de supervisión contable</h2>
          <p className="m-0 mt-[2px] text-[11.5px] text-blue-100">Los KPI del libro mensual de supervisión, con los datos del sistema.</p>
        </div>
        {data ? (
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold">
            <span className="rounded-lg bg-white/15 px-3 py-[5px]">{supervisorText}</span>
            <span className="rounded-lg bg-[#2F8F46] px-3 py-[5px]">{periodLabel(data.period_ym)}</span>
            <span className="rounded-lg bg-white/15 px-3 py-[5px]">{data.companies} empresas</span>
          </div>
        ) : null}
      </div>

      {loading && !data ? <p className="text-sm text-slate-500">Cargando indicadores…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {data ? (
        <>
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="flex min-w-0 flex-[3_1_620px] flex-wrap gap-3">
              <div
                className="flex min-w-[150px] flex-1 flex-col justify-center rounded-2xl border border-dashed border-[#DCE8E1] bg-[#F8FBF9] px-3 py-4 text-center"
                title="El sistema todavía no registra el tiempo de primera respuesta a los clientes."
              >
                <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-slate-500">KPI 1</div>
                <div className="mt-[2px] text-[13px] font-extrabold leading-tight text-slate-700">Tiempo 1.ª respuesta</div>
                <div className="mt-2 text-[22px] font-extrabold text-slate-400">—</div>
                <div className="mt-1 text-[10.5px] text-slate-400">Aún no se registra · Meta: ≤10 min</div>
              </div>
              <KpiCard n={2} title="Entrega de planillas" rate={k2?.total.rate_pct ?? 0} total={k2?.total.total ?? 0} meta="≥95%" sub={k2 ? `${k2.total.on_time} de ${k2.total.total} a tiempo` : undefined} />
              <KpiCard n={3} title="Entrega de archivadores" rate={k3?.total.rate_pct ?? 0} total={k3?.total.total ?? 0} meta="≥95%" sub={k3 ? `${k3.total.on_time} de ${k3.total.total} a tiempo` : undefined} />
              <KpiCard n={4} title="Declaraciones en plazo" rate={k4?.total.rate_pct ?? 0} total={k4?.total.total ?? 0} meta="≥95%" sub={k4 ? `${k4.total.on_time} de ${k4.total.total} en plazo` : undefined} />
              <KpiCard n={5} title="Revisión de balances" rate={k5?.total.rate_pct ?? 0} total={k5?.total.total ?? 0} meta="100%" sub={k5 ? `${k5.total.on_time} de ${k5.total.total} revisados` : undefined} />
            </div>
            <div className="flex min-w-[260px] flex-[1_1_260px] flex-col gap-2 rounded-2xl border border-[#DCE8E1] bg-[#F8FBF9] p-3">
              <div className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-[#0A5A3A]">Resumen KPI 4</div>
              <div className="grid grid-cols-2 gap-2">
                <SummaryBox label="Empresas dentro de plazo" value={k4?.total.on_time ?? 0} color="#0A7A3B" />
                <SummaryBox label="Empresas fuera de plazo" value={k4?.total.late ?? 0} color="#B91C1C" />
                <SummaryBox label="Empresas “no se envió”" value={k4?.total.missing ?? 0} color="#B45309" />
                <SummaryBox label="Pendientes" value={k4?.total.pending ?? 0} color="#475569" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Section title="Revisión de buzones" hint="Capturas SUNAT y SUNAFIL por asistente: a tiempo, pendientes (incluye vencidas sin subir) y subidas fuera de plazo.">
              {data.mailboxes.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">Sin capturas de buzón configuradas en el calendario de este período.</p>
              ) : (
                <MailboxChart rows={data.mailboxes} />
              )}
            </Section>
            <Section title="KPI 2: Entrega de planillas por RUC" hint="Empresas con planilla por dígito de RUC y cuántas entregaron dentro del plazo del calendario (PDT 601).">
              {k2 && k2.total.total > 0 ? <DigitColumns digits={k2.by_digit} okLabel="Dentro de plazo" /> : <p className="py-8 text-center text-xs text-slate-500">Sin planillas en este período.</p>}
            </Section>
          </div>

          <div className="flex flex-wrap gap-3">
            {k3 ? (
              <Section title="KPI 3: Entrega de archivadores por RUC" hint="1.ª entrega del PDT 621 dentro del plazo interno del estudio.">
                <DigitTable kpi={k3} okHeader="Dentro de plazo" />
              </Section>
            ) : null}
            {k4 ? (
              <Section title="KPI 4: Declaraciones dentro de plazo por RUC" hint="Fecha de declaración PDT 621 frente al cronograma SUNAT de cada dígito.">
                <DigitTable kpi={k4} okHeader="Dentro de plazo" />
              </Section>
            ) : null}
            {k5 ? (
              <Section title="KPI 5: Balances presentados OK por RUC" hint="Siscont balances revisados sobre los que corresponden. Meta: 100%.">
                <DigitTable kpi={k5} okHeader="Revisado, OK" showPending />
              </Section>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
};

export default SupervisorIndicatorsPanel;
