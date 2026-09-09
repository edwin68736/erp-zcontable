import { Link } from 'react-router-dom';
import type { ComplianceTrendPoint, SupervisorProductivityRow } from '../../services/supervisors';

const MONTH_ABBR_ES = [
  'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC',
];

function periodShortLabel(periodYm: string): string {
  const m = Number(periodYm.slice(5, 7));
  return MONTH_ABBR_ES[m - 1] ?? periodYm;
}

/** Tendencia de cumplimiento mensual (últimos N meses) — antes no existía ninguna vista
 * histórica: el dashboard solo podía mostrar un mes a la vez. */
export function ComplianceTrendChart({ points }: { points: ComplianceTrendPoint[] }) {
  const W = 560;
  const H = 160;
  const padL = 34;
  const padR = 14;
  const padT = 18;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const withData = points.filter((p) => p.total_controls > 0);
  if (points.length === 0) {
    return <p className="text-sm text-slate-500">Sin datos de períodos anteriores.</p>;
  }

  const x = (i: number) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (pct: number) => padT + plotH - (pct / 100) * plotH;

  const linePoints = points.map((p, i) => `${x(i)},${y(p.compliance_pct)}`).join(' ');
  const areaPoints = `${x(0)},${padT + plotH} ${linePoints} ${x(points.length - 1)},${padT + plotH}`;
  const last = points[points.length - 1];
  const gridPcts = [0, 50, 100];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Tendencia de cumplimiento mensual">
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="currentColor" className="text-slate-300" strokeWidth={1} />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="currentColor" className="text-slate-300" strokeWidth={1} />
        {gridPcts.map((pct) => (
          <g key={pct}>
            <line
              x1={padL}
              y1={y(pct)}
              x2={W - padR}
              y2={y(pct)}
              stroke="currentColor"
              className="text-slate-200"
              strokeWidth={1}
              strokeDasharray="2,3"
            />
            <text x={padL - 6} y={y(pct) + 3} textAnchor="end" className="fill-slate-400" fontSize={9} fontFamily="monospace">
              {pct}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text
            key={p.period_ym}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-slate-400"
            fontSize={9}
            fontFamily="monospace"
          >
            {periodShortLabel(p.period_ym)}
          </text>
        ))}
        {withData.length > 0 ? (
          <>
            <polygon points={areaPoints} className="fill-primary-500" opacity={0.1} />
            <polyline points={linePoints} fill="none" className="stroke-primary-600" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) =>
              p.total_controls > 0 ? (
                <circle
                  key={p.period_ym}
                  cx={x(i)}
                  cy={y(p.compliance_pct)}
                  r={i === points.length - 1 ? 4.5 : 3}
                  className={i === points.length - 1 ? 'fill-white stroke-primary-600' : 'fill-primary-600'}
                  strokeWidth={i === points.length - 1 ? 2.5 : 0}
                />
              ) : null,
            )}
          </>
        ) : null}
      </svg>
      <p className="text-xs text-slate-500 mt-1">
        Último período: <span className="font-semibold text-slate-700">{last.compliance_pct}%</span> de cumplimiento
        {last.total_controls > 0 ? ` sobre ${last.total_controls} control${last.total_controls === 1 ? '' : 'es'}` : ' (sin controles)'}
      </p>
    </div>
  );
}

export type DonutSlice = { label: string; value: number; colorClass: string };

/** Distribución de controles por estado en un solo gráfico — reemplaza la barra CSS + los 4
 * chips que antes repetían exactamente los mismos números dos veces. */
export function StatusDistributionDonut({ slices, total }: { slices: DonutSlice[]; total: number }) {
  const size = 128;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Distribución de controles por estado">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-slate-100" strokeWidth={stroke} />
        {total > 0
          ? slices.map((s) => {
              if (s.value <= 0) return null;
              const frac = s.value / total;
              const dash = frac * c;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  className={s.colorClass}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
              offset += dash;
              return el;
            })
          : null}
        <text x={size / 2} y={size / 2 - 3} textAnchor="middle" className="fill-slate-800" fontSize={22} fontWeight={700}>
          {total}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" className="fill-slate-400" fontSize={9} fontFamily="monospace">
          controles
        </text>
      </svg>
      <ul className="space-y-1.5 text-sm min-w-0">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.colorClass.replace('stroke-', 'bg-')}`} />
            <span className="text-slate-600">{s.label}</span>
            <span className="ml-auto font-semibold text-slate-800 tabular-nums pl-3">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Cumplimiento POR SUPERVISOR (no por responsable/contador) — como el resto del dashboard ya
 * está acotado a las empresas del supervisor que lo está viendo, esto es su propio avance del
 * período (una sola fila) para que se autoevalúe; con alcance de estudio sin restricción salen
 * varias filas, una por supervisor, para compararlos entre sí. Mismo componente de siempre
 * (barra + %), ordenado de mayor a menor cumplimiento. */
export function ProductivityRanking({ rows }: { rows: SupervisorProductivityRow[] }) {
  const sorted = [...rows].sort((a, b) => b.compliance_pct - a.compliance_pct);
  const barColor = (pct: number) =>
    pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-500';

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
      <p className="text-sm font-medium text-slate-700 px-4 pt-4">Productividad por supervisor</p>
      <p className="text-xs text-slate-500 px-4 mt-0.5">
        Cumplimiento de controles mensuales del período, por supervisor asignado.
      </p>
      <div className="p-4 space-y-2.5 min-w-[26rem]">
        {sorted.map((r) => (
          <div key={r.user_id} className="flex items-center gap-3 text-sm">
            <span className="w-36 shrink-0 truncate text-slate-700" title={r.user_name}>
              {r.user_name || `Usuario #${r.user_id}`}
            </span>
            <div className="flex-1 h-3.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${barColor(r.compliance_pct)}`}
                style={{ width: `${Math.min(100, Math.max(0, r.compliance_pct))}%` }}
              />
            </div>
            <span className="w-12 shrink-0 text-right font-semibold text-slate-800 tabular-nums">
              {r.compliance_pct}%
            </span>
            <span className="w-20 shrink-0 text-right text-xs text-slate-400 tabular-nums">
              {r.al_dia}/{r.total}
            </span>
          </div>
        ))}
      </div>
      <div className="px-4 pb-3">
        <Link to="/supervisors/reports" className="text-xs text-primary-700 font-medium hover:underline">
          Ver reporte completo →
        </Link>
      </div>
    </div>
  );
}
