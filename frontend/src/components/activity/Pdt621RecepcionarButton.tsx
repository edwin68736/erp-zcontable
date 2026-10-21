import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { pdt621Service, type Pdt621Detail } from '../../services/pdt621';
import { extractApiErrorMessage } from '../../utils/apiError';

function formatFecha(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

// Siempre en hora de Lima, sin importar la zona horaria configurada en la PC.
const FECHA_LIMA = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});
const HORA_LIMA = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Solo la primera letra ("Miércoles, 21 de octubre de 2026") — `capitalize` de CSS sube cada palabra. */
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Reloj del SERVIDOR mientras el modal está abierto: pide la hora al backend una vez y la hace avanzar
 * con el desfase respecto del reloj local — si la PC tiene la hora mal, igual se muestra la del servidor.
 */
function useServerClock(active: boolean): { now: Date | null; error: boolean } {
  const [offset, setOffset] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) {
      setOffset(null);
      setError(false);
      return;
    }
    let cancelled = false;
    const sentAt = Date.now();
    pdt621Service
      .serverTime()
      .then((t) => {
        if (cancelled) return;
        // Compensa la mitad del viaje de ida y vuelta de la petición.
        const latency = (Date.now() - sentAt) / 2;
        setOffset(t.epoch_ms + latency - Date.now());
      })
      .catch(() => !cancelled && setError(true));
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active]);

  return { now: offset === null ? null : new Date(Date.now() + offset), error };
}

type Props = {
  companyId: number;
  periodYm: string;
  businessName: string;
  entrega: 'primera' | 'segunda';
  /** Botón chico para la celda de la tabla. */
  compact?: boolean;
  onDone: (detail: Pdt621Detail, message: string) => void;
  onError: (message: string) => void;
};

/**
 * "Recepcionar" el archivador PDT 621: el supervisor asignado registra que recibió físicamente el
 * archivador del asistente. No hay fecha/hora que elegir: el modal muestra la hora del SERVIDOR (Lima)
 * y es el servidor el que la registra al confirmar; la respuesta trae lo que quedó grabado.
 */
const Pdt621RecepcionarButton = ({ companyId, periodYm, businessName, entrega, compact, onDone, onError }: Props) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const label = entrega === 'primera' ? '1ra entrega' : '2da entrega';
  const { now, error: clockError } = useServerClock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving]);

  const confirm = async () => {
    try {
      setSaving(true);
      const detail = await pdt621Service.recepcionar(companyId, periodYm);
      const rec = detail.record;
      const fecha = entrega === 'primera' ? rec?.primera_entrega_fecha : rec?.segunda_entrega_fecha;
      const hora = entrega === 'primera' ? rec?.primera_entrega_hora : rec?.segunda_entrega_hora;
      setOpen(false);
      onDone(detail, `Archivador recepcionado (${label}): ${formatFecha(fecha)} ${hora ?? ''} — quedó "Por revisar".`);
    } catch (err) {
      setOpen(false);
      onError(extractApiErrorMessage(err, 'No se pudo recepcionar el archivador.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Recepcionar archivador (${label}) — registra la fecha y hora actuales del servidor`}
        className={
          compact
            ? 'inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary-600 text-white text-xs font-medium hover:bg-primary-700'
            : 'inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700'
        }
      >
        <i className="fas fa-inbox" aria-hidden />
        Recepcionar
      </button>
      {/* Portal a <body>: dentro de la tabla (panel con scroll propio) el overlay quedaba recortado a
          la vista en vez de cubrir toda la pantalla. Mismo patrón que ConfirmDialog. */}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-dialog flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={() => !saving && setOpen(false)}
                aria-label="Cerrar"
              />
              <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4 text-left whitespace-normal">
                <div>
                  <h3 className="text-base font-semibold text-slate-800">Recepcionar archivador — {label}</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    <span className="font-medium text-slate-800">{businessName}</span> · Período {periodYm}
                  </p>
                </div>
                <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4 text-center">
                  {now ? (
                    <>
                      <p className="text-sm font-medium text-primary-800">{capitalizar(FECHA_LIMA.format(now))}</p>
                      <p className="mt-1 text-4xl font-bold tracking-tight text-primary-900 tabular-nums">
                        {HORA_LIMA.format(now)}
                      </p>
                    </>
                  ) : clockError ? (
                    <p className="text-sm text-red-700">No se pudo obtener la hora del servidor.</p>
                  ) : (
                    <p className="text-sm text-slate-500">
                      <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                      Obteniendo hora del servidor…
                    </p>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void confirm()}
                    className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                  >
                    {saving ? 'Recepcionando…' : 'Confirmar recepción'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default Pdt621RecepcionarButton;
