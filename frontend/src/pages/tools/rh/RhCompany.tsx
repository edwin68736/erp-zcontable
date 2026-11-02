import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { rheService, type RheComprobante, type RheResponse, type RheTipo } from '../../../services/rhe';
import type { SireApiError } from '../../../services/sire';
import { Card, SireErrorBox, Spinner } from '../sire/SireShared';
import { INPUT_CLS, SELECT_CLS, sireMissing } from '../sire/sireUi';
import {
  RH_ESTADOS,
  RH_ESTADO_BADGE,
  RH_MAX_DAYS,
  daysAgo,
  daysBetween,
  docLabel,
  exportRheExcel,
  fmtDay,
  fmtMoney,
  motivosLabel,
  totalsByCurrency,
} from './rhUi';

const RANGES = [
  { label: '15 días', days: 15 },
  { label: '30 días', days: 30 },
  { label: '3 meses', days: 90 },
  { label: '6 meses', days: 180 },
];

function Detail({ r, motivos }: { r: RheComprobante; motivos: Record<string, string> }) {
  return (
    <div className="grid grid-cols-1 gap-3 text-xs text-slate-700 md:grid-cols-3">
      <div>
        <p className="mb-1 font-semibold text-slate-800">Fechas</p>
        <p>Emisión: {fmtDay(r.fec_emision)}</p>
        <p>Puesta a disposición: {fmtDay(r.fec_puesta_disposicion)}</p>
        <p>Plazo de pago: {fmtDay(r.fec_plazo_pago)}</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-slate-800">Cuotas</p>
        {(r.cuotas ?? []).length === 0 ? (
          <p className="text-slate-500">Sin cuotas informadas.</p>
        ) : (
          (r.cuotas ?? []).map((c) => (
            <p key={c.numero}>
              Cuota {c.numero}: {fmtMoney(c.monto, r.moneda)} — vence {fmtDay(c.vencimiento)}
            </p>
          ))
        )}
        {r.monto_pendiente ? <p className="mt-1">Monto neto pendiente de pago: {fmtMoney(r.monto_pendiente, r.moneda)}</p> : null}
      </div>
      <div>
        {r.fec_disconformidad ? (
          <>
            <p className="mb-1 font-semibold text-slate-800">Disconformidad</p>
            <p>Fecha: {fmtDay(r.fec_disconformidad)}</p>
            <p>Motivos: {motivosLabel(r.motivos_disconformidad, motivos) || '—'}</p>
            {r.sustento_disconformidad ? <p>Sustento: {r.sustento_disconformidad}</p> : null}
          </>
        ) : null}
        {r.fec_subsanacion ? (
          <>
            <p className="mb-1 font-semibold text-slate-800">Subsanación</p>
            <p>Fecha: {fmtDay(r.fec_subsanacion)}</p>
            {(r.notas_subsanacion ?? []).map((n) => (
              <p key={`${n.serie}-${n.numero}`}>
                {n.cod_cpe} {n.serie}-{n.numero}
                {n.comentario ? ` — ${n.comentario}` : ''}
                {n.motivos.length ? ` (motivos: ${motivosLabel(n.motivos, motivos)})` : ''}
              </p>
            ))}
          </>
        ) : null}
        {!r.fec_disconformidad && !r.fec_subsanacion ? <p className="text-slate-500">Sin disconformidad ni subsanación.</p> : null}
      </div>
    </div>
  );
}

/**
 * Herramientas → RH → una empresa: consulta en SUNAT los recibos por honorarios (o facturas) que están en la
 * plataforma de confirmación del RHE y de la FE: pendientes, subsanados y pendientes por reinicio (compras) o
 * disconformes (ventas). Solo lectura.
 */
const RhCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [tipo, setTipo] = useState<RheTipo>('C');
  const [codCpe, setCodCpe] = useState<'02' | '01'>('02');
  const [desde, setDesde] = useState(daysAgo(30));
  const [hasta, setHasta] = useState(daysAgo(0));
  const [estados, setEstados] = useState<string[]>(() => RH_ESTADOS.C.map((e) => e.value));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SireApiError | null>(null);
  const [resp, setResp] = useState<RheResponse | null>(null);
  const [queried, setQueried] = useState<{ tipo: RheTipo; desde: string; hasta: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState('');

  useEffect(() => {
    if (!Number.isFinite(companyId) || companyId <= 0) return;
    let alive = true;
    companyAccessCredentialsService
      .get(companyId)
      .then((r) => {
        if (alive) setCompany(r);
      })
      .catch(() => {
        if (alive) setCompanyError('No se pudo cargar la empresa (¿no está en su alcance?).');
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  const missing = company ? sireMissing(company) : '';
  const span = daysBetween(desde, hasta);
  const rangeError =
    !desde || !hasta ? 'Indique las dos fechas.' : span < 0 ? 'La fecha «desde» no puede ser mayor que «hasta».' : span > RH_MAX_DAYS ? `El rango máximo es de ${RH_MAX_DAYS} días.` : '';

  const changeTipo = (t: RheTipo) => {
    setTipo(t);
    setEstados(RH_ESTADOS[t].map((e) => e.value));
  };

  const toggleEstado = (v: string) =>
    setEstados((cur) => (cur.includes(v) ? (cur.length > 1 ? cur.filter((x) => x !== v) : cur) : [...cur, v]));

  const run = async () => {
    setLoading(true);
    setError(null);
    setOpen('');
    try {
      const r = await rheService.list(companyId, { tipo, cod_cpe: codCpe, desde, hasta, estados });
      setResp(r);
      setQueried({ tipo, desde, hasta });
    } catch (e) {
      setResp(null);
      setError(e as SireApiError);
    } finally {
      setLoading(false);
    }
  };

  const items = useMemo(() => {
    const all = resp?.data.items ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.serie}-${r.numero} ${r.ruc_emisor} ${r.estado_desc}`.toLowerCase().includes(q));
  }, [resp, filter]);

  const isRhe = codCpe === '02';

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;
  }

  return (
    <div className="space-y-5 pt-2">
      <div>
        <Link to="/tools/rh" className="text-xs font-semibold text-primary-700 hover:underline">
          <i className="fas fa-arrow-left mr-1" aria-hidden />
          Volver a la lista
        </Link>
        <PageHeading className="mt-1">{company?.business_name || 'RH'}</PageHeading>
        <p className="mt-1 text-sm font-medium text-slate-500">
          {company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}
        </p>
      </div>

      {companyError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{companyError}</p> : null}

      {company && missing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Falta cargar: <strong>{missing}</strong>. Complételo en{' '}
          <Link to="/finance/claves-sol" className="font-semibold underline">
            Claves SOL
          </Link>{' '}
          (botón Editar de la empresa). Se usan las mismas credenciales de API que el SIRE.
        </div>
      ) : null}

      {company && !missing ? (
        <>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
            Esta consulta usa la <strong>Plataforma de confirmación del RHE y de la FE</strong> de SUNAT. Muestra solo los comprobantes que están en esa
            plataforma: pendientes, subsanados o pendientes por reinicio (compras) y disconformes (ventas). No es el registro completo de recibos por
            honorarios. SUNAT permite 15 días por consulta: un rango mayor se consulta por tramos automáticamente.
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Tipo de consulta">
                {(
                  [
                    ['C', 'Recibidos (compras)'],
                    ['V', 'Emitidos (ventas)'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={tipo === v}
                    onClick={() => changeTipo(v)}
                    className={`px-4 py-2 text-sm font-semibold ${tipo === v ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="text-xs text-slate-600">
                <span className="mb-0.5 block">Comprobante</span>
                <select value={codCpe} onChange={(e) => setCodCpe(e.target.value as '02' | '01')} className={SELECT_CLS}>
                  <option value="02">Recibo por honorarios</option>
                  <option value="01">Factura</option>
                </select>
              </label>
              <label className="text-xs text-slate-600">
                <span className="mb-0.5 block">Emisión desde</span>
                <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={INPUT_CLS} />
              </label>
              <label className="text-xs text-slate-600">
                <span className="mb-0.5 block">Hasta</span>
                <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={INPUT_CLS} />
              </label>
              <div className="flex gap-1" aria-label="Rangos rápidos">
                {RANGES.map((r) => (
                  <button
                    key={r.days}
                    type="button"
                    onClick={() => {
                      setDesde(daysAgo(r.days));
                      setHasta(daysAgo(0));
                    }}
                    className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-xs font-medium text-slate-500">Estados:</span>
              {RH_ESTADOS[tipo].map((e) => (
                <label key={e.value} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" checked={estados.includes(e.value)} onChange={() => toggleEstado(e.value)} />
                  {e.label}
                </label>
              ))}
              <Button className="ml-auto" disabled={loading || !!rangeError} onClick={() => void run()}>
                <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'} mr-1.5`} aria-hidden />
                Consultar en SUNAT
              </Button>
            </div>
            {rangeError ? <p className="text-xs text-amber-700">{rangeError}</p> : null}
          </div>

          {loading ? <Spinner label="Consultando SUNAT (los rangos largos se consultan por tramos de 15 días)…" /> : null}
          {error ? <SireErrorBox error={error} onRetry={() => void run()} /> : null}

          {resp && queried && !loading ? (
            <Card
              title={`${resp.data.total} comprobante${resp.data.total === 1 ? '' : 's'}`}
              subtitle={`Emisión del ${fmtDay(queried.desde)} al ${fmtDay(queried.hasta)} · ${resp.data.consultas} consultas a SUNAT`}
              actions={
                resp.data.total > 0 ? (
                  <Button
                    variant="secondary"
                    className="!py-1.5 text-xs"
                    onClick={() =>
                      void exportRheExcel(resp.data.items, resp.motivos, {
                        empresa: company.business_name,
                        ruc: company.ruc,
                        tipo: queried.tipo,
                        desde: queried.desde,
                        hasta: queried.hasta,
                      })
                    }
                  >
                    <i className="fas fa-file-excel mr-1.5" aria-hidden />
                    Excel
                  </Button>
                ) : undefined
              }
            >
              {resp.data.truncado ? (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Hay más comprobantes de los que se muestran (tope de {resp.data.items.length}). Acorte el rango de fechas.
                </p>
              ) : null}

              {resp.data.total === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  SUNAT no tiene {isRhe ? 'recibos por honorarios' : 'facturas'} en estos estados para ese rango de fechas.
                </p>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap gap-3 text-sm">
                    {(isRhe
                      ? ([
                          ['Total honorarios', (r: RheComprobante) => r.total_honorarios],
                          ['Retención', (r: RheComprobante) => r.retencion],
                          ['Neto recibido', (r: RheComprobante) => r.neto_recibido],
                        ] as const)
                      : ([
                          ['Importe facturas', (r: RheComprobante) => r.importe_factura],
                          ['Pendiente de pago', (r: RheComprobante) => r.monto_pendiente],
                        ] as const)
                    ).map(([label, pick]) => (
                      <div key={label} className="rounded-lg border border-slate-200 px-4 py-2">
                        <span className="block text-[10px] font-semibold uppercase text-slate-400">{label}</span>
                        {totalsByCurrency(resp.data.items, pick).map(([cur, v]) => (
                          <span key={cur} className="block font-bold text-slate-800">
                            {fmtMoney(v, cur)}
                          </span>
                        ))}
                      </div>
                    ))}
                    <label className="ml-auto self-end text-xs text-slate-600">
                      <span className="mb-0.5 block">Filtrar</span>
                      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Serie-número, RUC o estado…" className={`${INPUT_CLS} w-64`} />
                    </label>
                  </div>

                  <div className="overflow-auto">
                    <table className="min-w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700">
                          {['', 'Estado', 'Comprobante', 'RUC emisor', 'Emisión', 'Puesta a disp.', isRhe ? 'Honorarios' : 'Importe', ...(isRhe ? ['Retención', 'Neto'] : ['Pendiente'])].map(
                            (h, i) => (
                              <th key={`${h}-${i}`} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold">
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((r) => {
                          const key = `${r.estado}|${r.ruc_emisor}|${r.cod_cpe}|${docLabel(r)}`;
                          const expanded = open === key;
                          return (
                            <Fragment key={key}>
                              <tr className="border-b border-slate-100 align-top hover:bg-slate-50/70">
                                <td className="px-2 py-2">
                                  <button
                                    type="button"
                                    aria-expanded={expanded}
                                    aria-label={expanded ? 'Ocultar detalle' : 'Ver detalle'}
                                    onClick={() => setOpen(expanded ? '' : key)}
                                    className="text-slate-500 hover:text-slate-800"
                                  >
                                    <i className={`fas ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden />
                                  </button>
                                </td>
                                <td className="px-2 py-2">
                                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${RH_ESTADO_BADGE[r.estado] ?? 'bg-slate-100 text-slate-700'}`}>
                                    {r.estado_desc}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 font-mono">{docLabel(r)}</td>
                                <td className="whitespace-nowrap px-2 py-2 font-mono">{r.ruc_emisor}</td>
                                <td className="whitespace-nowrap px-2 py-2">{fmtDay(r.fec_emision)}</td>
                                <td className="whitespace-nowrap px-2 py-2">{fmtDay(r.fec_puesta_disposicion)}</td>
                                {isRhe ? (
                                  <>
                                    <td className="whitespace-nowrap px-2 py-2 text-right">{fmtMoney(r.total_honorarios, r.moneda)}</td>
                                    <td className="whitespace-nowrap px-2 py-2 text-right">{fmtMoney(r.retencion, r.moneda)}</td>
                                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{fmtMoney(r.neto_recibido, r.moneda)}</td>
                                  </>
                                ) : (
                                  <>
                                    <td className="whitespace-nowrap px-2 py-2 text-right">{fmtMoney(r.importe_factura, r.moneda)}</td>
                                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{fmtMoney(r.monto_pendiente, r.moneda)}</td>
                                  </>
                                )}
                              </tr>
                              {expanded ? (
                                <tr className="border-b border-slate-100 bg-slate-50/70">
                                  <td />
                                  <td colSpan={isRhe ? 8 : 7} className="px-2 py-3">
                                    <Detail r={r} motivos={resp.motivos} />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                        {items.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-2 py-6 text-center text-slate-500">
                              Ningún comprobante coincide con el filtro.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

export default RhCompany;
