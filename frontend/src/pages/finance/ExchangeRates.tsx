import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { saveAs } from 'file-saver';
import Button from '../../components/ui/Button';
import PageHeading from '../../components/ui/PageHeading';
import { buildExchangeRatesPdf, exchangeRatesPdfFileName } from '../../pdf/exchangeRatesPdfBuild';
import { exchangeRatesService, type ExchangeMonth } from '../../services/exchangeRates';
import {
  EXCHANGE_NOTES,
  EXCHANGE_SOURCE_NOTE,
  MONTH_NAMES,
  WEEKDAYS_SUN,
  buildRateWeeks,
  currentMonthKey,
  dateKey,
  fmtRate,
  monthSummary,
  parseMonthKey,
  shiftMonth,
} from './exchangeRates/exchangeRatesUi';

const INPUT_CLS = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';

/**
 * Recursos → Tipo de cambio: calendario mensual del tipo de cambio de SUNAT (compra y venta de cada día), como el que
 * publica SUNAT. Los días se guardan en nuestra base: un mes nuevo se completa una sola vez desde ApiPeru.dev (que
 * reproduce los valores de SUNAT) y después sale de la base. Se puede bajar el mes en PDF.
 */
const ExchangeRates = () => {
  const [ym, setYm] = useState(currentMonthKey());
  const [data, setData] = useState<ExchangeMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  // Evita que una respuesta tardía de otro mes pise la del mes que se está viendo.
  const seq = useRef(0);

  const load = useCallback(async (key: string) => {
    const p = parseMonthKey(key);
    if (!p) return;
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const res = await exchangeRatesService.month(p.year, p.month, true);
      if (seq.current === mine) setData(res);
    } catch (e) {
      if (seq.current !== mine) return;
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setData(null);
      setError(msg || 'No se pudo cargar el tipo de cambio. Intente de nuevo.');
    } finally {
      if (seq.current === mine) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(ym);
  }, [ym, load]);

  const parsed = parseMonthKey(ym) ?? { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const weeks = useMemo(() => buildRateWeeks(parsed.year, parsed.month, data?.days ?? []), [parsed.year, parsed.month, data]);
  const summary = useMemo(() => (data ? monthSummary(data) : null), [data]);
  const today = dateKey(new Date());
  const isCurrent = ym === currentMonthKey();

  const downloadPdf = async () => {
    if (!data) return;
    setPdfBusy(true);
    try {
      const bytes = await buildExchangeRatesPdf(data);
      saveAs(new Blob([bytes as BlobPart], { type: 'application/pdf' }), exchangeRatesPdfFileName(data.year, data.month));
    } catch (e) {
      console.error(e);
      setError('No se pudo generar el PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const monthDays = (data?.days ?? []).slice().reverse();

  return (
    <div className="space-y-3">
      <div>
        <PageHeading hint="Compra y venta de SUNAT por día (dólar americano). El valor de cada fecha es el cierre de la SBS del día hábil anterior.">Tipo de cambio</PageHeading>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Cambiar de mes">
            <button type="button" onClick={() => setYm((k) => shiftMonth(k, -1))} aria-label="Mes anterior" className="px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <i className="fas fa-chevron-left" aria-hidden />
            </button>
            <button type="button" onClick={() => setYm((k) => shiftMonth(k, 1))} aria-label="Mes siguiente" className="border-l border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <i className="fas fa-chevron-right" aria-hidden />
            </button>
          </div>
          <Button variant="secondary" disabled={isCurrent} onClick={() => setYm(currentMonthKey())}>
            Mes actual
          </Button>
          <label className="text-xs text-slate-600">
            <span className="sr-only">Mes</span>
            <input type="month" value={ym} min="2004-03" max={shiftMonth(currentMonthKey(), 1)} onChange={(e) => e.target.value && setYm(e.target.value)} className={INPUT_CLS} />
          </label>
          <h2 className="mx-auto text-xl font-semibold text-slate-700">
            {MONTH_NAMES[parsed.month - 1]} <span className="ml-2 text-primary-700">{parsed.year}</span>
          </h2>
          <Button variant="secondary" disabled={loading} onClick={() => void load(ym)} title="Volver a intentar los días que faltan">
            <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1.5`} aria-hidden />
            Actualizar
          </Button>
          <Button disabled={!data || data.days.length === 0 || pdfBusy} onClick={() => void downloadPdf()}>
            <i className={`fas ${pdfBusy ? 'fa-spinner fa-spin' : 'fa-file-pdf'} mr-1.5`} aria-hidden />
            Descargar PDF
          </Button>
        </div>

        {loading ? (
          <p className="mt-3 text-xs text-slate-500" role="status">
            <i className="fas fa-spinner fa-spin mr-1.5" aria-hidden />
            Cargando el tipo de cambio… si el mes es nuevo se trae desde SUNAT y puede tardar unos segundos.
          </p>
        ) : null}
        {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
        {data?.warning ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {data.warning}
            {data.warning_code === 'sin_token' || data.warning_code === 'token_invalido' ? (
              <>
                {' '}
                <Link to="/settings/firm" className="font-semibold underline">
                  Ir a Ajustes del estudio
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : null}
        {data && data.fetched > 0 && !loading ? (
          <p className="mt-3 text-xs text-emerald-700">
            <i className="fas fa-check mr-1.5" aria-hidden />
            Se trajeron {data.fetched} día{data.fetched === 1 ? '' : 's'} nuevo{data.fetched === 1 ? '' : 's'} y quedaron guardados.
          </p>
        ) : null}
      </div>

      {/* Calendario (pantallas medianas y grandes) */}
      <div className={`hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block ${loading ? 'opacity-60' : ''}`}>
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-800">
          {WEEKDAYS_SUN.map((d) => (
            <div key={d} className="px-3 py-2">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
            {week.map((c) => (
              <div key={c.date} className={`min-h-[5.5rem] border-r border-slate-100 p-1.5 last:border-r-0 ${c.date === today ? 'bg-slate-100' : ''}`}>
                <div className={`mb-1 text-sm ${c.inMonth ? 'text-slate-800' : 'text-slate-300'}`}>{c.dayNum}</div>
                {c.inMonth && c.rate ? (
                  <div className="space-y-1" title={c.rate.fecha_sunat ? `Cierre SBS del ${c.rate.fecha_sunat.split('-').reverse().join('/')}` : undefined}>
                    <div className="rounded border border-green-300 bg-green-100 px-2 py-0.5 text-xs text-green-900">
                      <span className="font-semibold">Compra</span> {fmtRate(c.rate.compra)}
                    </div>
                    <div className="rounded border border-sky-300 bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
                      <span className="font-semibold">Venta</span> {fmtRate(c.rate.venta)}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Lista (celulares) */}
      <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:hidden ${loading ? 'opacity-60' : ''}`}>
        {monthDays.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">{loading ? 'Cargando…' : 'No hay tipo de cambio guardado para este mes.'}</p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2 text-right">Compra</th>
                <th className="px-3 py-2 text-right">Venta</th>
              </tr>
            </thead>
            <tbody>
              {monthDays.map((d) => (
                <tr key={d.date} className={`border-t border-slate-100 ${d.date === today ? 'bg-slate-100' : ''}`}>
                  <td className="px-3 py-2">{d.date.split('-').reverse().join('/')}</td>
                  <td className="px-3 py-2 text-right font-mono text-green-800">{fmtRate(d.compra)}</td>
                  <td className="px-3 py-2 text-right font-mono text-sky-800">{fmtRate(d.venta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {summary ? (
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2">
            <span className="block text-[10px] font-semibold uppercase text-slate-400">Días con tipo de cambio</span>
            <span className="font-bold text-slate-800">{summary.count}</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2">
            <span className="block text-[10px] font-semibold uppercase text-slate-400">Compra (mín. – máx.)</span>
            <span className="font-bold text-slate-800">
              {fmtRate(summary.minCompra)} – {fmtRate(summary.maxCompra)}
            </span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2">
            <span className="block text-[10px] font-semibold uppercase text-slate-400">Venta (mín. – máx.)</span>
            <span className="font-bold text-slate-800">
              {fmtRate(summary.minVenta)} – {fmtRate(summary.maxVenta)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
        <p className="mb-1 font-semibold text-slate-800">Notas</p>
        <ol className="list-inside space-y-0.5">
          {EXCHANGE_NOTES.map((n, i) => (
            <li key={n}>
              {i + 1}.- {n}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-slate-400">{EXCHANGE_SOURCE_NOTE}</p>
      </div>
    </div>
  );
};

export default ExchangeRates;
