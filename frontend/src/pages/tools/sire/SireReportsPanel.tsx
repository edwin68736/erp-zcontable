import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '../../../components/ui/Button';
import {
  SIRE_TICKET_STATES,
  formatSirePeriod,
  sireService,
  sireTicketFinished,
  type SireApiError,
  type SireLibro,
  type SireReportDef,
  type SireTicketRecord,
} from '../../../services/sire';
import { Card, SireErrorBox, SireTicketFiles, Spinner } from './SireShared';
import { INPUT_CLS, SELECT_CLS } from './sireUi';

interface Props {
  companyId: number;
  libro: SireLibro;
  period: string;
}

/** Una solicitud en curso: SUNAT genera el archivo y hay que consultar su ticket hasta que termine. */
interface Pending {
  ticket: string;
  label: string;
  period: string;
  record?: SireTicketRecord;
  error?: SireApiError;
}

const POLL_MS = 6000;

function ReportCard({
  def,
  libro,
  busy,
  onRun,
}: {
  def: SireReportDef;
  libro: SireLibro;
  busy: boolean;
  onRun: (def: SireReportDef, params: Record<string, string>) => void;
}) {
  const types = def.file_types?.[libro];
  const [params, setParams] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (types && types.length > 0) init.tipo_archivo = types[0].value;
    for (const f of def.fields ?? []) if (f.default) init[f.key] = f.default;
    return init;
  });
  const set = (k: string, v: string) => setParams((p) => ({ ...p, [k]: v }));
  const missing = (def.fields ?? []).some((f) => f.required && !(params[f.key] ?? '').trim());

  return (
    <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-3">
      <div>
        <p className="text-sm font-semibold text-slate-800">{def.label}</p>
        <p className="mt-0.5 text-xs text-slate-500">{def.description}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(def.fields ?? []).map((f) =>
            f.options ? (
              <label key={f.key} className="text-xs text-slate-600">
                <span className="mb-0.5 block">{f.label}</span>
                <select value={params[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} className={`${SELECT_CLS} max-w-[16rem] !py-1.5 text-xs`}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={f.key} className="text-xs text-slate-600">
                <span className="mb-0.5 block">{f.label}</span>
                <input value={params[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className={`${INPUT_CLS} w-28 !py-1.5 text-xs`} />
              </label>
            ),
          )}
          {types && types.length > 0 ? (
            <label className="text-xs text-slate-600">
              <span className="mb-0.5 block">Formato</span>
              <select value={params.tipo_archivo ?? types[0].value} onChange={(e) => set('tipo_archivo', e.target.value)} className={`${SELECT_CLS} !py-1.5 text-xs`}>
                {types.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <Button className="!py-1.5 text-xs" disabled={busy || missing} onClick={() => onRun(def, params)}>
          <i className={`fas ${busy ? 'fa-spinner fa-spin' : def.kind === 'ticket' ? 'fa-paper-plane' : 'fa-download'} mr-1.5`} aria-hidden />
          {def.kind === 'ticket' ? 'Solicitar a SUNAT' : 'Descargar'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Catálogo de reportes del libro. Los de tipo "ticket" se piden a SUNAT, que prepara el archivo: aquí se consulta
 * su estado automáticamente y, al terminar, se puede ver como tabla o descargar. Los de tipo "file" bajan en el acto.
 */
const SireReportsPanel = ({ companyId, libro, period }: Props) => {
  const [defs, setDefs] = useState<SireReportDef[] | null>(null);
  const [loadError, setLoadError] = useState<SireApiError | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [actionError, setActionError] = useState<SireApiError | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;

  useEffect(() => {
    let alive = true;
    setDefs(null);
    setLoadError(null);
    sireService
      .catalog(libro)
      .then((d) => {
        if (alive) setDefs(d);
      })
      .catch((e: SireApiError) => {
        if (alive) setLoadError(e);
      });
    return () => {
      alive = false;
    };
  }, [libro]);

  // Se limpian las solicitudes al cambiar de empresa o libro (los tickets son de ese libro).
  useEffect(() => setPending([]), [companyId, libro]);

  const poll = useCallback(async () => {
    const open = pendingRef.current.filter((p) => !p.error && !sireTicketFinished(p.record?.codEstadoProceso));
    if (open.length === 0) return;
    const updates = await Promise.all(
      open.map(async (p) => {
        try {
          const res = await sireService.tickets(companyId, { libro, per_ini: p.period, per_fin: p.period, page: 1, per_page: 5, ticket: p.ticket });
          const rec = (res.registros ?? []).find((r) => r.numTicket === p.ticket) ?? res.registros?.[0];
          return { ticket: p.ticket, record: rec } as const;
        } catch (e) {
          return { ticket: p.ticket, error: e as SireApiError } as const;
        }
      }),
    );
    setPending((cur) =>
      cur.map((p) => {
        const u = updates.find((x) => x.ticket === p.ticket);
        if (!u) return p;
        if ('error' in u && u.error) return { ...p, error: u.error };
        return { ...p, record: u.record ?? p.record };
      }),
    );
  }, [companyId, libro]);

  useEffect(() => {
    if (!pending.some((p) => !p.error && !sireTicketFinished(p.record?.codEstadoProceso))) return;
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [pending, poll]);

  const run = async (def: SireReportDef, params: Record<string, string>) => {
    setBusyKey(def.key);
    setActionError(null);
    try {
      if (def.kind === 'file') {
        await sireService.downloadDirect(companyId, { libro, report: def.key, period, params });
      } else {
        const ticket = await sireService.requestReport(companyId, { libro, report: def.key, period, params });
        setPending((cur) => [{ ticket, label: def.label, period }, ...cur.filter((p) => p.ticket !== ticket)]);
        window.setTimeout(() => void poll(), 2500);
      }
    } catch (e) {
      setActionError(e as SireApiError);
    } finally {
      setBusyKey('');
    }
  };

  const groups = Array.from(new Set((defs ?? []).map((d) => d.group)));

  return (
    <div className="space-y-4">
      {actionError ? <SireErrorBox error={actionError} /> : null}

      {pending.length > 0 ? (
        <Card title="Solicitudes a SUNAT" subtitle="SUNAT prepara cada archivo; esta lista se actualiza sola.">
          <ul className="space-y-3">
            {pending.map((p) => {
              const code = p.record?.codEstadoProceso;
              const done = sireTicketFinished(code);
              return (
                <li key={p.ticket} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-800">{p.label}</span>
                    <span className="text-xs text-slate-500">
                      {formatSirePeriod(p.period)} · ticket <span className="font-mono">{p.ticket}</span>
                    </span>
                    {p.error ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Error al consultar</span>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          code === '03' ? 'bg-red-50 text-red-700' : done ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {p.record?.desEstadoProceso || SIRE_TICKET_STATES[code ?? ''] || 'Solicitado…'}
                      </span>
                    )}
                    {!done && !p.error ? <i className="fas fa-spinner fa-spin text-slate-400" aria-hidden /> : null}
                  </div>
                  {p.error ? <div className="mt-2"><SireErrorBox error={p.error} /></div> : null}
                  {done && p.record ? (
                    <div className="mt-2">
                      <SireTicketFiles companyId={companyId} libro={libro} record={p.record} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {!defs && !loadError ? <Spinner label="Cargando reportes…" /> : null}
      {loadError ? <SireErrorBox error={loadError} /> : null}
      {groups.map((g) => (
        <Card key={g} title={g}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(defs ?? [])
              .filter((d) => d.group === g)
              .map((d) => (
                <ReportCard key={`${libro}-${d.key}`} def={d} libro={libro} busy={busyKey === d.key} onRun={(df, p) => void run(df, p)} />
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
};

export default SireReportsPanel;
