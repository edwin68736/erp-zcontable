import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from '../../../components/ui/Button';
import { rheSolService, type RheSolItem } from '../../../services/rheSol';
import { saveBlobAs, type SireApiError } from '../../../services/sire';
import { notify } from '../../../utils/notify';
import { SireErrorBox } from '../sire/SireShared';
import { fmtDay, fmtMoney } from './rhUi';

/** SUNAT se consulta de a un recibo; el servidor admite hasta este número por pedido. */
const RH_FILES_MAX = 100;

const itemKey = (r: RheSolItem) => `${r.tipo}|${r.comprobante}|${r.emisor_doc}`;

/**
 * «Descarga de recibos»: elige los recibos recibidos de la consulta y baja de SUNAT el PDF
 * de cada uno en un ZIP con la carpeta PDF/. SUNAT los entrega de a uno, por eso puede tardar un poco.
 */
export default function RhFilesDialog({
  companyId,
  ruc,
  items,
  desde,
  hasta,
  onClose,
}: {
  companyId: number;
  ruc: string;
  items: RheSolItem[];
  desde: string;
  hasta: string;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.filter((r) => !r.anulado).slice(0, RH_FILES_MAX).map(itemKey)));
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SireApiError | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !sending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((r) => `${r.comprobante} ${r.emisor_nombre} ${r.emisor_doc}`.toLowerCase().includes(t));
  }, [items, q]);

  const toggleOne = (r: RheSolItem) =>
    setPicked((cur) => {
      const next = new Set(cur);
      const k = itemKey(r);
      if (next.has(k)) next.delete(k);
      else if (next.size < RH_FILES_MAX) next.add(k);
      return next;
    });
  const allShownPicked = filtered.length > 0 && filtered.every((r) => picked.has(itemKey(r)));
  const toggleShown = () =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (allShownPicked) filtered.forEach((r) => next.delete(itemKey(r)));
      else for (const r of filtered) if (next.size < RH_FILES_MAX) next.add(itemKey(r));
      return next;
    });

  const start = async () => {
    const chosen = items.filter((r) => picked.has(itemKey(r)));
    if (chosen.length === 0) return;
    setSending(true);
    setError(null);
    setProblems([]);
    try {
      const r = await rheSolService.files(
        companyId,
        chosen.map((c) => ({ comprobante: c.comprobante, fec_emision: c.fec_emision, emisor_doc: c.emisor_doc })),
        ['pdf'],
      );
      saveBlobAs(r.blob, `RH-recibos-${ruc}-${desde}_${hasta}.zip`);
      if (r.errors.length === 0) {
        void notify.success('Archivos descargados', `${r.files} archivo${r.files === 1 ? '' : 's'} de ${r.ok} recibo${r.ok === 1 ? '' : 's'}.`);
        onClose();
      } else {
        setProblems(r.errors);
        void notify.warning('Descarga con avisos', `Se bajaron ${r.files} archivos; ${r.errors.length} no los entregó SUNAT. Están listados abajo y en errores.txt del ZIP.`);
      }
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setSending(false);
    }
  };

  const canStart = picked.size > 0 && !sending;

  return createPortal(
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="rh-files-title" className="notify-pop flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="relative px-5 pb-2 pt-5 text-center">
          <h2 id="rh-files-title" className="m-0 text-xl font-bold text-slate-800">
            Descarga de recibos (PDF)
          </h2>
          <p className="m-0 mt-1 text-xs text-slate-500">
            Emisión del {fmtDay(desde)} al {fmtDay(hasta)}
          </p>
          <button type="button" onClick={onClose} disabled={sending} className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40" aria-label="Cerrar">
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>

        <div className="space-y-2.5 px-5 pb-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por serie-número, emisor o RUC…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25"
            aria-label="Buscar recibo"
          />
        </div>

        <div className="min-h-[8rem] flex-1 overflow-auto px-5">
          {error ? (
            <div className="mb-2">
              <SireErrorBox error={error} />
            </div>
          ) : null}
          {problems.length > 0 ? (
            <ul className="mb-2 list-disc rounded-lg border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Ningún recibo coincide con la búsqueda.</p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-left text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-xs text-slate-600">
                  <th className="w-8 px-3 py-2">
                    <input type="checkbox" className="h-4 w-4 accent-blue-900" checked={allShownPicked} onChange={toggleShown} disabled={sending} aria-label="Marcar todos los recibos de la lista" />
                  </th>
                  <th className="px-2 py-2 font-semibold">Emisión</th>
                  <th className="px-2 py-2 font-semibold">Comprobante</th>
                  <th className="px-2 py-2 font-semibold">Emisor</th>
                  <th className="px-2 py-2 text-right font-semibold">Renta neta</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={itemKey(r)} className={`border-t border-slate-100 ${r.anulado ? 'text-slate-400' : ''}`}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" className="h-4 w-4 accent-blue-900" checked={picked.has(itemKey(r))} disabled={sending} onChange={() => toggleOne(r)} aria-label={`Marcar ${r.comprobante}`} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDay(r.fec_emision)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">
                      {r.comprobante}
                      {r.anulado ? <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-2xs font-semibold text-red-700">{r.estado}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {r.emisor_nombre || '—'}
                      <div className="text-slate-400">{r.emisor_doc}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(r.renta_neta, r.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <p className="m-0 text-xs text-slate-500">
            <strong className="text-slate-700">{picked.size}</strong> marcados (máximo {RH_FILES_MAX} por descarga)
            {sending ? ' · SUNAT los entrega de a uno, puede tardar…' : ''}
          </p>
          <div className="flex items-center gap-2">
            <Button disabled={!canStart} onClick={() => void start()}>
              <i className={`fas ${sending ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'} mr-1.5`} aria-hidden />
              {sending ? 'Descargando…' : 'Iniciar descarga'}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={sending}>
              <i className="fas fa-times mr-1.5" aria-hidden />
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
