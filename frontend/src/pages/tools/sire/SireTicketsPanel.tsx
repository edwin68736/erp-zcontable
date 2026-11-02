import { useCallback, useEffect, useState } from 'react';
import Button from '../../../components/ui/Button';
import {
  SIRE_TICKET_STATES,
  formatSirePeriod,
  sireService,
  type SireApiError,
  type SireLibro,
  type SireTicketsResponse,
} from '../../../services/sire';
import { Card, SireErrorBox, SireTicketFiles, Spinner } from './SireShared';
import { INPUT_CLS } from './sireUi';

interface Props {
  companyId: number;
  libro: SireLibro;
  period: string;
}

const PER_PAGE = 20;

const periodRe = /^\d{6}$/;

/** Historial de tickets de SUNAT (estado de cada carga o solicitud de archivo) con sus archivos. */
const SireTicketsPanel = ({ companyId, libro, period }: Props) => {
  const year = period.slice(0, 4);
  const [perIni, setPerIni] = useState(`${year}01`);
  const [perFin, setPerFin] = useState(`${year}12`);
  const [ticket, setTicket] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SireTicketsResponse | null>(null);
  const [error, setError] = useState<SireApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Al cambiar de período, el rango sugerido pasa al año de ese período.
  useEffect(() => {
    setPerIni(`${period.slice(0, 4)}01`);
    setPerFin(`${period.slice(0, 4)}12`);
    setPage(1);
  }, [period]);

  const valid = periodRe.test(perIni) && periodRe.test(perFin) && perIni <= perFin;

  const load = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      setData(await sireService.tickets(companyId, { libro, per_ini: perIni, per_fin: perFin, page, per_page: PER_PAGE, ticket: ticket.trim() || undefined }));
    } catch (e) {
      setData(null);
      setError(e as SireApiError);
    } finally {
      setLoading(false);
    }
  }, [companyId, libro, perIni, perFin, page, ticket, valid]);

  useEffect(() => {
    void load();
    // nonce fuerza la recarga con el botón "Buscar" aunque los filtros no hayan cambiado
  }, [load, nonce]);

  const total = data?.paginacion?.totalRegistros ?? data?.registros?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <Card title="Tickets" subtitle="Estado de cada solicitud o carga hecha en SUNAT para este libro.">
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setNonce((n) => n + 1);
        }}
      >
        <label className="text-xs text-slate-600">
          <span className="mb-0.5 block">Desde (AAAAMM)</span>
          <input value={perIni} onChange={(e) => setPerIni(e.target.value.replace(/\D/g, '').slice(0, 6))} className={`${INPUT_CLS} w-28`} inputMode="numeric" />
        </label>
        <label className="text-xs text-slate-600">
          <span className="mb-0.5 block">Hasta (AAAAMM)</span>
          <input value={perFin} onChange={(e) => setPerFin(e.target.value.replace(/\D/g, '').slice(0, 6))} className={`${INPUT_CLS} w-28`} inputMode="numeric" />
        </label>
        <label className="text-xs text-slate-600">
          <span className="mb-0.5 block">N.º de ticket (opcional)</span>
          <input value={ticket} onChange={(e) => setTicket(e.target.value)} className={`${INPUT_CLS} w-44`} />
        </label>
        <Button type="submit" disabled={!valid || loading}>
          Buscar
        </Button>
      </form>

      {!valid ? <p className="text-xs text-amber-700">Use períodos de 6 dígitos (AAAAMM) y que «Desde» no sea mayor que «Hasta».</p> : null}
      {loading ? <Spinner /> : null}
      {error ? <SireErrorBox error={error} onRetry={() => setNonce((n) => n + 1)} /> : null}

      {data && !loading ? (
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                {['Período', 'Ticket', 'Proceso', 'Estado', 'Fecha', 'Archivos'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.registros ?? []).map((r) => (
                <tr key={r.numTicket} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-2 py-2">{formatSirePeriod(r.perTributario)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono">{r.numTicket}</td>
                  <td className="px-2 py-2">{r.desProceso || r.codProceso}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        r.codEstadoProceso === '03' ? 'bg-red-50 text-red-700' : r.codEstadoProceso === '06' || r.codEstadoProceso === '04' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {r.desEstadoProceso || SIRE_TICKET_STATES[r.codEstadoProceso ?? ''] || '—'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-600">{r.fecCargaImportacion ?? r.fecInicioProceso ?? ''}</td>
                  <td className="px-2 py-2">
                    <SireTicketFiles companyId={companyId} libro={libro} record={r} />
                  </td>
                </tr>
              ))}
              {(data.registros ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-slate-500">
                    No hay tickets en ese rango.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && pages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
          <span>
            Página {page} de {pages} · {total} tickets
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" className="!px-3 !py-1" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button variant="secondary" className="!px-3 !py-1" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
};

export default SireTicketsPanel;
