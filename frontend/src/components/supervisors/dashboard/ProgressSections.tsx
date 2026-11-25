import { fmtPct, pctTone } from '../../assistant/moduleDigits';
import type { IndicatorMailboxRow } from '../../../services/supervisors';
import { mailboxSegments, type MailboxKind, type MailboxState, type TrendBar } from './progressUi';

/** Bloques del dashboard del supervisor (tarjetas KPI, buzones por asistente, avance por tramos). Los números salen de progressUi.ts. */

/** Tarjeta de un KPI: el % grande, pintado según la meta, con una línea de apoyo. */
export function KpiCard({ n, title, pct, meta, sub, unused }: { n: number; title: string; pct: number | null; meta: number; sub?: string; unused?: boolean }) {
  const tone = unused ? { fg: '#64748B', bg: '#F1F5F9' } : pctTone(pct, meta);
  return (
    <div className="flex min-w-[150px] flex-1 flex-col overflow-hidden rounded-2xl border border-[#DCE8E1] bg-white">
      <div className="px-3 pt-[10px] text-center">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#0A5A3A]">KPI {n}</div>
        <div className="mt-[2px] text-[13px] font-extrabold leading-tight text-slate-900">{title}</div>
      </div>
      <div className="mt-2 px-3 py-[10px] text-center" style={{ background: tone.bg }}>
        <div className="text-[30px] font-extrabold leading-none tabular-nums" style={{ color: tone.fg }}>
          {pct != null && !unused ? fmtPct(pct) : '—'}
        </div>
      </div>
      <div className="px-3 pb-[10px] pt-[6px] text-center text-[11px] text-slate-500">
        Meta: ≥{meta}%
        {unused ? <div className="mt-px text-[10.5px] text-slate-400">Aún no se usa: nadie lo entrega todavía</div> : sub ? <div className="mt-px text-[10.5px] text-slate-400">{sub}</div> : null}
      </div>
    </div>
  );
}

/** Una cifra del resumen del KPI 4; si tiene empresas detrás se puede pulsar para verlas. */
export function SummaryBox({ label, value, color, onClick }: { label: string; value: number; color: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="text-[12px] font-bold leading-tight text-slate-700">{label}</span>
      <span className="text-[20px] font-extrabold tabular-nums" style={{ color }}>
        {value.toLocaleString('es-PE')}
      </span>
    </>
  );
  const cls = 'flex items-center justify-between gap-3 rounded-xl border border-[#DCE8E1] bg-white px-3 py-2 text-left';
  return onClick && value > 0 ? (
    <button type="button" onClick={onClick} title="Ver estas empresas" className={`${cls} hover:border-slate-400 hover:bg-slate-50`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

const STATE_STYLE: Record<MailboxState, { bg: string; label: string }> = {
  ok: { bg: '#16A34A', label: 'A tiempo' },
  late: { bg: '#F97316', label: 'Fuera de plazo' },
  pending: { bg: '#DC2626', label: 'Pendientes' },
};

/**
 * Revisión de buzones: una barra horizontal por asistente y buzón (SUNAT, SUNAFIL), repartida en a tiempo / fuera de plazo /
 * pendientes. Los tramos fuera de plazo y pendientes se pulsan para ver las empresas.
 */
export function MailboxBars({ rows, onPick }: { rows: IndicatorMailboxRow[]; onPick: (row: IndicatorMailboxRow, kind: MailboxKind, state: 'late' | 'pending') => void }) {
  const kinds: { kind: MailboxKind; label: string }[] = [
    { kind: 'sunat', label: 'SUNAT' },
    { kind: 'sunafil', label: 'SUNAFIL' },
  ];
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-slate-600">
        {(Object.keys(STATE_STYLE) as MailboxState[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: STATE_STYLE[s].bg }} />
            {STATE_STYLE[s].label}
          </span>
        ))}
        <span className="text-slate-400">· pulse los tramos naranja y rojo para ver las empresas</span>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.assistant}>
            <div className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-700">{r.assistant}</div>
            <div className="flex flex-col gap-[5px]">
              {kinds.map(({ kind, label }) => {
                const segs = mailboxSegments(r, kind);
                const total = segs.reduce((a, s) => a + s.value, 0);
                return (
                  <div key={kind} className="flex items-center gap-2">
                    <div className="w-[58px] shrink-0 text-[10.5px] font-bold text-slate-500">{label}</div>
                    <div className="flex h-[22px] min-w-0 flex-1 overflow-hidden rounded-md bg-[#EEF3F0]" role="img" aria-label={`${r.assistant} · ${label}: ${total} capturas`}>
                      {segs
                        .filter((s) => s.value > 0)
                        .map((s) => {
                          const st = STATE_STYLE[s.state];
                          const style = { width: `${(s.value / total) * 100}%`, background: st.bg };
                          const text = <span className="px-1 text-[10.5px] font-extrabold text-white">{s.value}</span>;
                          const title = `${r.assistant} · ${label} · ${st.label}: ${s.value}`;
                          return s.state === 'ok' ? (
                            <div key={s.state} className="flex items-center justify-center overflow-hidden" style={style} title={title}>
                              {text}
                            </div>
                          ) : (
                            <button
                              key={s.state}
                              type="button"
                              onClick={() => onPick(r, kind, s.state as 'late' | 'pending')}
                              className="flex items-center justify-center overflow-hidden hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
                              style={style}
                              title={`${title} · ver empresas`}
                            >
                              {text}
                            </button>
                          );
                        })}
                      {total === 0 ? <span className="px-2 text-[10.5px] text-slate-400">sin capturas</span> : null}
                    </div>
                    <div className="w-8 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{total}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Columnas del avance por tramo de meses: el % arriba, el tramo abajo y lo completado ÷ lo aplicable. */
export function AvanceColumns({ bars }: { bars: TrendBar[] }) {
  if (bars.length === 0) return <p className="py-8 text-center text-xs text-slate-500">Sin datos para este alcance.</p>;
  return (
    <div className="mt-3 flex items-end gap-2" role="img" aria-label="Avance por periodo">
      {bars.map((b, i) => {
        const last = i === bars.length - 1;
        return (
          <div key={`${b.label}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={b.pct == null ? `${b.label}: sin tareas medidas` : `${b.label}: ${b.completed.toLocaleString('es-PE')} de ${b.total.toLocaleString('es-PE')} tareas`}>
            <div className="text-[11.5px] font-extrabold tabular-nums text-slate-900">{b.pct == null ? '—' : fmtPct(b.pct)}</div>
            <div className="flex h-[110px] w-full items-end rounded-md bg-[#F4F8F6]">
              {b.pct != null ? <div className="w-full rounded-md" style={{ height: `${Math.max(b.pct, 3)}%`, background: last ? '#0E8F47' : '#8FD1AE' }} /> : null}
            </div>
            <div className={`text-[10px] ${last ? 'font-extrabold text-slate-900' : 'text-slate-500'}`}>{b.label}</div>
            <div className="text-[9.5px] tabular-nums text-slate-400">{b.pct == null ? 'sin datos' : `${b.completed.toLocaleString('es-PE')}/${b.total.toLocaleString('es-PE')}`}</div>
          </div>
        );
      })}
    </div>
  );
}
