import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from '../../../components/ui/Button';
import {
  CPE_KINDS,
  cpeFileName,
  cpeLineKey,
  cpeNumber,
  cpeTipoLabel,
  formatSirePeriod,
  saveBlobAs,
  sireCpeService,
  type SireApiError,
  type SireCpeKind,
  type SireCpeLine,
  type SireCpeStartResult,
  type SireDownloadItem,
} from '../../../services/sire';
import { notify } from '../../../utils/notify';
import { SireErrorBox } from './SireShared';

import { CPE_BATCH, CPE_ZIP_PART, batchOf, chunk, countPending, fmtCpeTotal, isPending, nextPending, progressLabel } from './sireCpeSelect';

const POLL_MS = 3000;

/** Casillas PDF / XML / CDR: se puede bajar todo junto o cada archivo por separado. */
export function CpeKindPicker({ value, onChange, disabled }: { value: SireCpeKind[]; onChange: (v: SireCpeKind[]) => void; disabled?: boolean }) {
  const toggle = (k: SireCpeKind) => onChange(value.includes(k) ? value.filter((x) => x !== k) : CPE_KINDS.map((c) => c.value).filter((x) => x === k || value.includes(x)));
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5" role="group" aria-label="Archivos a descargar">
      {CPE_KINDS.map((k) => (
        <label key={k.value} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-700" title={k.hint}>
          <input type="checkbox" className="h-4 w-4 accent-blue-900" checked={value.includes(k.value)} disabled={disabled} onChange={() => toggle(k.value)} />
          {k.label}
        </label>
      ))}
    </div>
  );
}

const HAS: Record<SireCpeKind, (l: SireCpeLine) => boolean> = { pdf: (l) => l.has_pdf, xml: (l) => l.has_xml, cdr: (l) => l.has_cdr };

/** Estado de un archivo de un comprobante: bajado, descargando, sin archivo o aún no pedido. */
function fileState(l: SireCpeLine, k: SireCpeKind): 'ok' | 'running' | 'fail' | 'idle' {
  if (HAS[k](l)) return 'ok';
  const wanted = (l.want ?? '').split(',').includes(k);
  if (l.status === 'en_proceso' && wanted) return 'running';
  if ((l.status === 'sin_cpe' || l.status === 'error') && wanted) return 'fail';
  return 'idle';
}

/**
 * «Descarga de CPE (Módulo SIRE)»: se abre desde una consulta del historial. Muestra los comprobantes de esa propuesta,
 * los formatos a bajar (PDF, XML, CDR; todos o cada uno por separado) y el estado de cada archivo mientras se descargan.
 * Lo que ya se bajó se ve marcado y solo se pide lo que falta.
 */
export default function SireCpeDialog({
  companyId,
  ruc,
  download,
  onClose,
  onStarted,
}: {
  companyId: number;
  ruc: string;
  download: SireDownloadItem;
  onClose: () => void;
  onStarted: (r: SireCpeStartResult) => void;
}) {
  const [lines, setLines] = useState<SireCpeLine[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SireApiError | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<SireCpeKind[]>(CPE_KINDS.map((k) => k.value));
  // Mientras la persona no toque la selección, se marcan solos los siguientes pendientes (al abrir, al cambiar los formatos y al terminar una tanda).
  const touched = useRef(false);
  const [sending, setSending] = useState(false);
  const [fileBusy, setFileBusy] = useState('');

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setLoading(true);
      try {
        const r = await sireCpeService.propuesta(companyId, download.id);
        setLines(r.lines);
        setSkipped(r.skipped);
        setError(null);
      } catch (e) {
        if (!quiet) setLines([]);
        setError(e as SireApiError);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [companyId, download.id],
  );
  useEffect(() => {
    void load(false);
  }, [load]);

  // Mientras algo se esté descargando, el estado de cada archivo se refresca solo.
  const running = lines.some((l) => l.status === 'en_proceso');
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(t);
  }, [running, load]);

  useEffect(() => {
    if (loading || running || touched.current) return;
    setPicked(new Set(nextPending(lines, kinds)));
  }, [loading, running, lines, kinds]);

  const pending = useMemo(() => countPending(lines, kinds), [lines, kinds]);
  const isPicked = (l: SireCpeLine) => picked.has(cpeLineKey(l));
  const pickedCount = useMemo(() => lines.reduce((n, l) => n + (picked.has(cpeLineKey(l)) ? 1 : 0), 0), [lines, picked]);
  const choose = (keys: string[]) => {
    touched.current = true;
    setPicked(new Set(keys));
  };
  const toggleAll = () => (pickedCount > 0 ? choose([]) : choose(nextPending(lines, kinds)));
  const toggleOne = (l: SireCpeLine) => {
    const next = new Set(picked);
    const k = cpeLineKey(l);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    choose(Array.from(next));
  };
  // Lo marcado puede pasar de la tanda («todos los pendientes»): se manda una tanda y el resto queda para «los siguientes».
  const overBatch = Math.max(0, pickedCount - CPE_BATCH);

  const start = async () => {
    setSending(true);
    setError(null);
    try {
      const keys = batchOf(lines, picked);
      const r = await sireCpeService.startFromDownload(companyId, download.id, { keys, kinds });
      // Al terminar la tanda se vuelven a marcar solos los siguientes pendientes.
      touched.current = false;
      onStarted(r);
      if (r.items.every((i) => i.status !== 'en_proceso')) void notify.success('Ya estaban descargados', 'Todos los archivos elegidos ya están guardados.');
      await load(true);
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setSending(false);
    }
  };

  const saveFile = async (l: SireCpeLine, k: SireCpeKind) => {
    if (!l.id) return;
    setFileBusy(`${l.id}:${k}`);
    try {
      saveBlobAs(await sireCpeService.fileBlob(companyId, l.id, k), cpeFileName(l, k));
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setFileBusy('');
    }
  };

  const doneIds = useMemo(() => lines.filter((l) => l.id && (l.has_pdf || l.has_xml || l.has_cdr)).map((l) => l.id as number), [lines]);
  const saveZip = async () => {
    setFileBusy('zip');
    try {
      // Con muchos comprobantes se baja por partes: un ZIP cada CPE_ZIP_PART.
      const parts = chunk(doneIds, CPE_ZIP_PART);
      for (let i = 0; i < parts.length; i++) {
        const suffix = parts.length > 1 ? `-parte${i + 1}de${parts.length}` : '';
        saveBlobAs(await sireCpeService.zipBlob(companyId, parts[i], kinds), `${ruc}-${download.period}-comprobantes${suffix}.zip`);
      }
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setFileBusy('');
    }
  };

  const canStart = pickedCount > 0 && kinds.length > 0 && !sending && !running;

  return createPortal(
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="cpe-dialog-title" className="notify-pop flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="relative px-5 pb-2 pt-5 text-center">
          <h2 id="cpe-dialog-title" className="m-0 text-xl font-bold text-slate-800">
            Descarga de CPE (Módulo SIRE)
          </h2>
          <p className="m-0 mt-1 text-xs text-slate-500">
            {download.libro === 'compras' ? 'Compras' : 'Ventas'} · {formatSirePeriod(download.period)}
          </p>
          <button type="button" onClick={onClose} className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Cerrar">
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>

        <div className="px-5 pb-3">
          <p className="m-0 mb-1.5 text-sm font-semibold text-slate-700">Formatos a descargar:</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
            <CpeKindPicker value={kinds} onChange={setKinds} disabled={sending || running} />
          </div>
        </div>

        <div className="min-h-[8rem] flex-1 overflow-auto px-5">
          {error ? (
            <div className="mb-2">
              <SireErrorBox error={error} />
            </div>
          ) : null}
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-500" role="status">
              <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
              Leyendo la propuesta…
            </p>
          ) : lines.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">La propuesta no tiene comprobantes descargables.</p>
          ) : (
            <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-700">
                {pickedCount} marcado{pickedCount === 1 ? '' : 's'} de {lines.length} · {pending} pendiente{pending === 1 ? '' : 's'}
              </span>
              <span className="text-slate-400">· cada tanda baja hasta {CPE_BATCH}</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button type="button" disabled={running || pending === 0} onClick={() => choose(nextPending(lines, kinds))} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50" title={`Marca los siguientes ${CPE_BATCH} comprobantes que aún no se han descargado`}>
                  Siguientes {CPE_BATCH} pendientes
                </button>
                <button type="button" disabled={running || pending === 0} onClick={() => choose(lines.filter((l) => isPending(l, kinds)).map(cpeLineKey))} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50" title="Marca todos los que aún no se han descargado (se bajan por tandas)">
                  Todos los pendientes
                </button>
                <button type="button" disabled={running || pickedCount === 0} onClick={() => choose([])} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Limpiar
                </button>
              </div>
            </div>
            <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-left text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-xs text-slate-600">
                  <th className="w-8 px-3 py-2">
                    <input type="checkbox" className="h-4 w-4 accent-blue-900" checked={pickedCount > 0} onChange={toggleAll} aria-label="Marcar los siguientes pendientes o quitar la marca" disabled={running} />
                  </th>
                  <th className="px-2 py-2 font-semibold">RUC</th>
                  <th className="px-2 py-2 font-semibold">Tipo</th>
                  <th className="px-2 py-2 font-semibold">Serie-Número</th>
                  <th className="px-2 py-2 font-semibold">Emisión</th>
                  <th className="px-2 py-2 text-right font-semibold">Total</th>
                  <th className="px-2 py-2 font-semibold">Descargado</th>
                  {CPE_KINDS.map((k) => (
                    <th key={k.value} className="w-14 px-2 py-2 text-center font-semibold">
                      {k.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const key = cpeLineKey(l);
                  return (
                    <tr key={key} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">
                        <input type="checkbox" className="h-4 w-4 accent-blue-900" checked={isPicked(l)} onChange={() => toggleOne(l)} disabled={running} aria-label={`Marcar ${cpeNumber(l)}`} />
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">
                        {l.ruc}
                        {l.nombre ? <div className="max-w-[14rem] truncate text-xs text-slate-400">{l.nombre}</div> : null}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600" title={cpeTipoLabel(l.tipo)}>
                        {Number(l.tipo)}
                      </td>
                      <td className="px-2 py-1.5 font-medium text-slate-800">{cpeNumber(l)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{l.fecha || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtCpeTotal(l.total)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {(() => {
                          const pr = progressLabel(l, kinds);
                          const tone = { ok: 'bg-green-50 text-green-700', warn: 'bg-amber-50 text-amber-700', muted: 'bg-slate-100 text-slate-500', busy: 'bg-blue-50 text-blue-700', bad: 'bg-red-50 text-red-700' }[pr.tone];
                          return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{pr.text}</span>;
                        })()}
                      </td>
                      {CPE_KINDS.map((k) => {
                        const st = fileState(l, k.value);
                        return (
                          <td key={k.value} className="px-2 py-1.5 text-center">
                            {st === 'ok' ? (
                              <button
                                type="button"
                                onClick={() => void saveFile(l, k.value)}
                                disabled={fileBusy === `${l.id}:${k.value}`}
                                title={`Bajar ${k.label}`}
                                aria-label={`Bajar ${k.label} de ${cpeNumber(l)}`}
                                className="text-green-600 hover:text-green-800"
                              >
                                <i className={`fas ${fileBusy === `${l.id}:${k.value}` ? 'fa-spinner fa-spin' : 'fa-circle-check'}`} aria-hidden />
                              </button>
                            ) : st === 'running' ? (
                              <i className="fas fa-spinner fa-spin text-amber-500" title="Descargando…" aria-label="Descargando" />
                            ) : st === 'fail' ? (
                              <i className="fas fa-circle-xmark text-red-500" title={l.error_message || 'SUNAT no entregó este archivo'} aria-label="Sin archivo" />
                            ) : (
                              <i className="fas fa-clock text-slate-400" title="Pendiente" aria-label="Pendiente" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </>
          )}
          {skipped > 0 ? <p className="mt-2 text-xs text-slate-400">{skipped} filas de la propuesta no son comprobantes descargables (recibos, boletas por rango…).</p> : null}
        </div>

        {overBatch > 0 && !running ? (
          <p className="m-0 px-5 pb-1 text-center text-xs text-amber-700">
            Se descargarán {CPE_BATCH} ahora; los otros {overBatch} marcados quedan pendientes para la siguiente tanda.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-100 px-5 py-4">
          <Button disabled={!canStart} onClick={() => void start()}>
            <i className={`fas ${sending || running ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'} mr-1.5`} aria-hidden />
            {running ? 'Descargando…' : pickedCount > CPE_BATCH ? `Iniciar descarga (${CPE_BATCH} de ${pickedCount})` : `Iniciar descarga${pickedCount > 0 ? ` (${pickedCount})` : ''}`}
          </Button>
          <Button variant="secondary" disabled={doneIds.length === 0 || running || fileBusy === 'zip' || kinds.length === 0} onClick={() => void saveZip()} title={`Un ZIP con los formatos marcados de todo lo ya descargado (por partes de ${CPE_ZIP_PART} si son muchos)`}>
            <i className={`fas ${fileBusy === 'zip' ? 'fa-spinner fa-spin' : 'fa-file-zipper'} mr-1.5`} aria-hidden />
            Bajar ZIP
          </Button>
          <Button variant="secondary" onClick={onClose}>
            <i className="fas fa-times mr-1.5" aria-hidden />
            Cerrar
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
