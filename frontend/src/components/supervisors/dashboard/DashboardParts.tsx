import type { ReactNode } from 'react';

/** Paleta semántica del dashboard — la misma que el diseño aprobado (propuesta B). */
export const DASH_COLORS = {
  ok: '#12A150',
  late: '#2563EB',
  over: '#DC2626',
  pend: '#F59E0B',
  exempt: '#8B5CF6',
  grid: '#E4EDE8',
  track: '#EEF3F0',
} as const;

const CIRC = 2 * Math.PI * 46;

export type DonutSlice = { label: string; value: number; color: string };

/** Anillo (solo SVG, sin texto) con el total en el centro y leyenda aparte: sin texto dentro del
 * SVG el tamaño no depende del ancho de la tarjeta. */
export function Donut({
  slices,
  size = 118,
  center,
  caption,
  label,
}: {
  slices: DonutSlice[];
  size?: number;
  center: ReactNode;
  caption: string;
  label: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label}>
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r="46" fill="none" stroke={DASH_COLORS.track} strokeWidth="17" />
          {total > 0
            ? slices.map((s) => {
                const len = (s.value / total) * CIRC;
                const dash = `${Math.max(len - 1.6, 0.1).toFixed(2)} ${(CIRC - len + 1.6).toFixed(2)}`;
                const off = (-acc).toFixed(2);
                acc += len;
                return s.value > 0 ? (
                  <circle
                    key={s.label}
                    cx="60"
                    cy="60"
                    r="46"
                    fill="none"
                    stroke={s.color}
                    strokeWidth="17"
                    strokeDasharray={dash}
                    strokeDashoffset={off}
                  />
                ) : null;
              })
            : null}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
        <strong className="text-[18px] font-extrabold text-slate-900">{center}</strong>
        <span className="text-[9.5px] text-slate-500">{caption}</span>
      </div>
    </div>
  );
}

export function DonutLegend({ slices, showPct = false, small = false }: { slices: DonutSlice[]; showPct?: boolean; small?: boolean }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <ul className={`m-0 flex min-w-0 flex-1 list-none flex-col p-0 ${small ? 'gap-[5px]' : 'gap-[7px]'}`}>
      {slices.map((s) => (
        <li key={s.label} className={`flex items-center gap-[7px] ${small ? 'text-[11.5px]' : 'text-xs'}`}>
          <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: s.color }} />
          <span className="flex-1 text-slate-700">{s.label}</span>
          <strong className="tabular-nums">{s.value.toLocaleString('es-PE')}</strong>
          {showPct ? (
            <span className="w-[46px] text-right tabular-nums text-slate-500">
              ({total > 0 ? ((s.value / total) * 100).toFixed(1) : '0.0'}%)
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export type ColumnDatum = { name: string; ok: number; pend: number; over: number; faded?: boolean };

/** Columnas apiladas (completadas / pendientes / vencidas) en % — alto fijo de 150 px. */
export function StackedColumns({ cols }: { cols: ColumnDatum[] }) {
  const lab = (v: number) => (v >= 11 ? String(Math.round(v)) : '');
  return (
    <div className="flex h-[150px] gap-[6px]">
      <div className="flex w-[22px] flex-col justify-between pb-5 text-right text-[9.5px] text-slate-500">
        {[100, 75, 50, 25, 0].map((v) => (
          <span key={v}>{v}</span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex-1">
          {[0, 25, 50, 75].map((t) => (
            <div key={t} className="absolute left-0 right-0 h-px" style={{ top: `${t}%`, background: DASH_COLORS.grid }} />
          ))}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-[#CFE0D6]" />
          <div className="absolute inset-0 flex items-end justify-around gap-2 px-[6px]">
            {cols.map((c) => (
              <div
                key={c.name}
                className="flex h-full max-w-[46px] flex-1 flex-col-reverse overflow-hidden rounded-t-[5px]"
                style={{ opacity: c.faded ? 0.5 : 1 }}
                role="img"
                aria-label={`${c.name}: ${Math.round(c.ok)}% completadas, ${Math.round(c.pend)}% pendientes, ${Math.round(c.over)}% vencidas`}
              >
                <div className="flex items-center justify-center text-[10px] font-bold text-white" style={{ height: `${c.ok}%`, background: DASH_COLORS.ok }}>
                  {lab(c.ok)}
                </div>
                <div className="flex items-center justify-center text-[10px] font-bold text-slate-800" style={{ height: `${c.pend}%`, background: DASH_COLORS.pend }}>
                  {lab(c.pend)}
                </div>
                <div className="flex items-center justify-center text-[10px] font-bold text-white" style={{ height: `${c.over}%`, background: DASH_COLORS.over }}>
                  {lab(c.over)}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex h-5 justify-around gap-2 px-[6px] pt-[5px]">
          {cols.map((c) => (
            <div
              key={c.name}
              className="min-w-0 max-w-[46px] flex-1 truncate text-center text-[9.5px] font-bold uppercase"
              style={{ color: c.faded ? '#64748B' : '#334155' }}
              title={c.name}
            >
              {c.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ColumnsLegend() {
  return (
    <div className="my-2 flex gap-3 text-[11px] text-slate-600">
      {[
        ['Completadas', DASH_COLORS.ok],
        ['Pendientes', DASH_COLORS.pend],
        ['Vencidas', DASH_COLORS.over],
      ].map(([l, c]) => (
        <span key={l} className="flex items-center gap-1">
          <span className="h-[9px] w-[9px] rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

export type TrendPoint = { label: string; value: number };

/** Área de tendencia (alto fijo 168 px): línea y área en SVG sin texto; puntos, valores y meses en
 * HTML, así los números siempre se ven nítidos. `compare` dibuja una segunda línea punteada. */
export function TrendArea({ points, compare }: { points: TrendPoint[]; compare?: number[] }) {
  const MAX = 60;
  const n = Math.max(points.length, 1);
  const X = (i: number) => ((i + 0.5) / n) * 100;
  const Y = (v: number) => Math.max(0, Math.min(100, 100 - (v / MAX) * 100));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(p.value).toFixed(2)}`).join(' ');
  const area = points.length ? `${line} L${X(points.length - 1).toFixed(2)} 100 L${X(0).toFixed(2)} 100 Z` : '';
  const cmp = compare && compare.length ? compare.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(v).toFixed(2)}`).join(' ') : '';
  return (
    <div className="relative h-[168px] pb-5 pl-[30px] pr-[6px] pt-3">
      <div className="relative h-full">
        {[60, 40, 20, 0].map((v) => (
          <div key={v}>
            <div className="absolute left-0 right-0 h-px" style={{ top: `${Y(v)}%`, background: DASH_COLORS.grid }} />
            <div className="absolute w-6 -translate-y-1/2 text-right text-[9.5px] text-slate-500" style={{ left: -30, top: `${Y(v)}%` }}>
              {v}
            </div>
          </div>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          {area ? <path d={area} fill={DASH_COLORS.ok} fillOpacity="0.13" /> : null}
          {cmp ? (
            <path d={cmp} fill="none" stroke="#64748B" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ) : null}
          {line ? (
            <path d={line} fill="none" stroke="#0E8F47" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
        {points.map((p, i) => {
          const last = i === points.length - 1;
          return (
            <div key={`${p.label}-${i}`}>
              <div
                className="absolute rounded-full border-[2.4px] border-[#0E8F47]"
                style={{ left: `${X(i)}%`, top: `${Y(p.value)}%`, width: last ? 13 : 9, height: last ? 13 : 9, background: last ? '#fff' : '#0E8F47', transform: 'translate(-50%,-50%)' }}
              />
              <div className="absolute whitespace-nowrap text-[10px] font-bold" style={{ left: `${X(i)}%`, top: `${Y(p.value)}%`, transform: 'translate(-50%,-190%)' }}>
                {p.value}%
              </div>
            </div>
          );
        })}
      </div>
      <div className="absolute bottom-0 left-[30px] right-[6px] flex">
        {points.map((p, i) => (
          <div key={`${p.label}-x-${i}`} className="flex-1 text-center text-[9.5px] text-slate-500">
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export type RankDatum = { name: string; pct: number; frac: string; tone?: 'main' | 'mine' | 'ref'; separated?: boolean };

export function RankBars({ rows, max = 60 }: { rows: RankDatum[]; max?: number }) {
  return (
    <div className="mt-[14px] flex flex-col gap-[13px]">
      {rows.map((r) => {
        const bar = r.tone === 'mine' ? '#0E8F47' : r.tone === 'ref' ? '#94A3B8' : '#34C27A';
        const nameColor = r.tone === 'mine' ? '#0A5A3A' : r.tone === 'ref' ? '#64748B' : '#334155';
        return (
          <div key={r.name} className={`flex items-center gap-[10px] ${r.separated ? 'border-t border-[#EAF1ED] pt-3' : ''}`}>
            <div className="w-[96px] shrink-0 truncate text-[11px] font-bold uppercase tracking-[0.2px]" style={{ color: nameColor }} title={r.name}>
              {r.name}
            </div>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-[#EEF3F0]">
              <div className="h-full rounded" style={{ width: `${Math.min((r.pct / max) * 100, 100)}%`, background: bar }} />
            </div>
            <div className="w-11 shrink-0 text-right text-[12.5px] font-extrabold tabular-nums">{r.pct}%</div>
            <div className="w-[52px] shrink-0 text-right text-[11px] tabular-nums text-slate-500">{r.frac}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Mini-línea de las tarjetas de KPI. */
export function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="h-[22px] w-16" />;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const rg = mx - mn || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 100).toFixed(1)} ${(22 - ((v - mn) / rg) * 20).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 24" width="64" height="22" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function KpiTile({
  label,
  value,
  delta,
  deltaTone = 'good',
  sub,
  icon,
  color,
  soft,
  tint,
  tintBorder,
  spark,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  deltaTone?: 'good' | 'warn' | 'bad' | 'neutral';
  sub?: string;
  icon: string;
  color: string;
  soft: string;
  /** Fondo pastel de toda la tarjeta y su borde, según el significado del indicador. */
  tint: string;
  tintBorder: string;
  spark?: number[];
}) {
  const deltaColor = deltaTone === 'good' ? '#0A5A3A' : deltaTone === 'warn' ? '#B45309' : deltaTone === 'bad' ? '#B91C1C' : '#64748B';
  return (
    <div className="flex min-w-0 flex-col gap-[6px] rounded-2xl border px-[14px] py-3" style={{ flex: '1 1 150px', background: tint, borderColor: tintBorder }}>
      <div className="flex items-center gap-2">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg" style={{ background: soft, color }}>
          <i className={`${icon} text-[12px]`} aria-hidden />
        </div>
        <div className="text-[11.5px] font-bold leading-tight text-slate-700">{label}</div>
      </div>
      <div className="flex items-end justify-between gap-[6px]">
        <div>
          <div className="text-[26px] font-extrabold leading-none tracking-tight">{value}</div>
          {delta ? (
            <div className="mt-1 text-[11px] font-bold" style={{ color: deltaColor }}>
              {delta}
            </div>
          ) : null}
        </div>
        {spark ? <Spark values={spark} color={color} /> : null}
      </div>
      {sub ? <div className="text-[10.5px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

/** Tarjeta destacada con el medidor semicircular de cumplimiento. */
export function HeroGauge({ pct, title, line1, line2 }: { pct: number; title: string; line1: string; line2?: string }) {
  const dash = `${((Math.max(0, Math.min(100, pct)) / 100) * Math.PI * 48).toFixed(1)} 151`;
  return (
    <div
      className="flex min-w-0 items-center gap-4 rounded-2xl px-[18px] py-[14px] text-white"
      style={{ flex: '1.5 1 280px', background: 'linear-gradient(135deg,#0A5A3A,#0E8F47)' }}
    >
      <div className="relative h-[78px] w-[124px] shrink-0">
        <svg viewBox="0 0 120 70" width="124" height="72" aria-hidden>
          <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="11" strokeLinecap="round" />
          <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke="#4ADE80" strokeWidth="11" strokeLinecap="round" strokeDasharray={dash} />
        </svg>
        <div className="absolute bottom-1 left-0 right-0 text-center text-2xl font-extrabold tracking-tight">{pct}%</div>
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold opacity-90">{title}</div>
        <div className="mt-1 text-[12.5px] font-bold text-green-200">{line1}</div>
        {line2 ? <div className="mt-[3px] text-[11px] opacity-80">{line2}</div> : null}
      </div>
    </div>
  );
}

export function Card({ children, className = '', accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <section
      className={`rounded-2xl border border-[#DCE8E1] bg-white px-4 py-[14px] ${className}`}
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
    >
      {children}
    </section>
  );
}
