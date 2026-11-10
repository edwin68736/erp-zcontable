import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { exchangeRatesService, type MarketPoint, type MarketRates } from '../../../services/exchangeRates';
import { chartGeometry, convert, fmtConverted, fmtMarketRate, MARKET_RANGES, parseAmount, sliceRange, type MarketRangeKey } from './marketUi';

const W = 560;
const H = 165;

const dateLabel = (iso: string): string => iso.split('-').reverse().join('/');

/** «10 nov, 7:20 a. m.» en hora de Lima a partir de una fecha ISO; si solo es un día, «06/11/2026». */
function updatedLabel(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return dateLabel(iso);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function Chart({ points }: { points: MarketPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const g = useMemo(() => chartGeometry(points, W, H), [points]);
  if (!g) return <p className="py-12 text-center text-sm text-slate-500">No hay suficientes datos para este rango.</p>;
  const last = g.coords[g.coords.length - 1];
  const hv = hover != null ? g.coords[hover] : null;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < g.coords.length; i++) if (Math.abs(g.coords[i].x - x) < Math.abs(g.coords[best].x - x)) best = i;
    setHover(best);
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfico del tipo de cambio" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {g.yTicks.map((t) => (
          <g key={t.label}>
            <line x1={44} x2={W - 12} y1={t.y} y2={t.y} className="stroke-slate-200" strokeWidth={1} />
            <text x={38} y={t.y + 4} textAnchor="end" className="fill-slate-500" fontSize={11}>
              {t.label}
            </text>
          </g>
        ))}
        {g.xTicks.map((t) => (
          <text key={t.x} x={t.x} y={H - 6} textAnchor="middle" className="fill-slate-500" fontSize={11}>
            {t.label}
          </text>
        ))}
        <path d={g.area} className="fill-emerald-500/10" />
        <path d={g.line} fill="none" className="stroke-emerald-500" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r={4} className="fill-emerald-500" />
        {hv ? (
          <g>
            <line x1={hv.x} x2={hv.x} y1={10} y2={H - 24} className="stroke-slate-300" strokeDasharray="3 3" />
            <circle cx={hv.x} cy={hv.y} r={4.5} className="fill-white stroke-emerald-600" strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      {hv ? (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow"
          style={{ left: `${Math.min(Math.max((hv.x / W) * 100, 12), 80)}%`, transform: 'translateX(-50%)' }}
        >
          <span className="font-semibold text-slate-800">S/ {fmtMarketRate(hv.point.value)}</span>
          <span className="ml-1.5 text-slate-500">{dateLabel(hv.point.date)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Recursos → Tipo de cambio → «Tipo de cambio paralelo»: el tipo de cambio de mercado (el que muestra Google; no siempre
 * coincide con el de SUNAT) con un convertidor dólares ↔ soles y el gráfico del último periodo. Solo informativo.
 */
const MarketRate = () => {
  const [data, setData] = useState<MarketRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<MarketRangeKey>('1M');
  // Lo último que escribió la persona: de ahí se calcula el otro importe. `usdTop` dice cuál va arriba.
  const [edited, setEdited] = useState<{ side: 'usd' | 'pen'; text: string }>({ side: 'usd', text: '1' });
  const [usdTop, setUsdTop] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await exchangeRatesService.market());
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setData(null);
      setError(msg || 'No se pudo cargar el tipo de cambio de mercado. Intente de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rate = data?.spot?.rate ?? NaN;
  const points = useMemo(() => sliceRange(data?.series ?? [], range), [data, range]);
  const typed = parseAmount(edited.text);
  const computed = convert(typed, rate, edited.side);
  const valueOf = (side: 'usd' | 'pen') => (side === edited.side ? edited.text : fmtConverted(computed));

  const row = (side: 'usd' | 'pen') => (
    <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-primary-300">
      <input
        inputMode="decimal"
        aria-label={side === 'usd' ? 'Importe en dólares' : 'Importe en soles'}
        value={valueOf(side)}
        onChange={(e) => setEdited({ side, text: e.target.value })}
        className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm text-slate-800 outline-none"
      />
      <span className="flex items-center border-l border-slate-200 px-3 text-xs font-medium text-slate-600">{side === 'usd' ? 'Dólar estadounidense' : 'Sol peruano'}</span>
    </div>
  );

  const first = usdTop ? 'usd' : 'pen';
  const second = usdTop ? 'pen' : 'usd';
  const delta = points.length >= 2 ? points[points.length - 1].value - points[0].value : NaN;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo de cambio paralelo</p>
      {error ? (
        <div className="space-y-2">
          <Alert variant="error">{error}</Alert>
          <Button variant="secondary" onClick={() => void load()}>
            <i className="fas fa-rotate mr-1.5" aria-hidden />
            Reintentar
          </Button>
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] ${loading ? 'opacity-60' : ''}`}>
          <div>
            <p className="text-sm text-slate-500">{usdTop ? '1 Dólar estadounidense es igual a' : '1 Sol peruano es igual a'}</p>
            <p className="text-2xl font-semibold leading-tight text-slate-800">
              {loading || !Number.isFinite(rate) ? '…' : usdTop ? `${fmtMarketRate(rate)} Sol peruano` : `${(1 / rate).toFixed(4)} Dólar estadounidense`}
            </p>
            {data?.spot ? (
              <p className="mt-1 text-xs text-slate-500">
                {updatedLabel(data.spot.updated_at)} · {data.spot.source}
              </p>
            ) : null}
            <div className="mt-3 space-y-1.5">
              {row(first)}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setUsdTop((v) => !v)}
                  aria-label="Invertir monedas"
                  title="Invertir monedas"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-xs text-primary-700 hover:bg-slate-50"
                >
                  <i className="fas fa-arrow-right-arrow-left rotate-90" aria-hidden />
                </button>
              </div>
              {row(second)}
            </div>
            {edited.text.trim() !== '' && Number.isNaN(typed) ? <p className="mt-1.5 text-xs text-amber-700">Escriba un importe válido.</p> : null}
          </div>

          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Rango del gráfico">
                {MARKET_RANGES.map((r, i) => (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={range === r.key}
                    onClick={() => setRange(r.key)}
                    className={`px-3 py-1.5 text-xs font-semibold ${i > 0 ? 'border-l border-slate-300' : ''} ${range === r.key ? 'bg-primary-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {Number.isFinite(delta) ? (
                  <span className={`text-xs font-semibold ${delta >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(3)} en el rango
                  </span>
                ) : null}
                <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={loading} onClick={() => void load()} title="Volver a leer la cotización">
                  <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1.5`} aria-hidden />
                  Actualizar
                </Button>
              </div>
            </div>
            {loading && !data ? <p className="py-12 text-center text-sm text-slate-500">Cargando…</p> : <Chart points={points} />}
          </div>
        </div>
      )}
      {data?.warnings?.map((w) => (
        <Alert key={w} variant="warning" className="mt-2">
          {w}
        </Alert>
      ))}
      <p className="mt-2 text-2xs text-slate-400">
        Referencia de mercado (no siempre coincide con SUNAT; para efectos tributarios rige el de SUNAT).
        {data?.series_source ? ` Historial: ${data.series_source}.` : ''}
      </p>
    </div>
  );
};

export default MarketRate;
