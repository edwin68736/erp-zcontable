import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  businessName: string;
  periodYm: string;
  motivo?: string;
  observadoPor?: string;
  observadoAt?: string;
};

function formatFechaHora(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Ojito junto al estado "Observado" del PDT 621: muestra el motivo con el que el supervisor observó
 * el archivador, quién y cuándo. Es la forma en que el asistente (que ya no entra al detalle) se
 * entera de qué tiene que corregir.
 */
const Pdt621ObservacionButton = ({ businessName, periodYm, motivo, observadoPor, observadoAt }: Props) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ver motivo de la observación"
        aria-label="Ver motivo de la observación"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
      >
        <i className="fas fa-eye text-xs" aria-hidden />
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-dialog flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
              />
              <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4 text-left whitespace-normal">
                <div>
                  <h3 className="text-base font-semibold text-slate-800">Archivador observado</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    <span className="font-medium text-slate-800">{businessName}</span> · Período {periodYm}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Motivo de la observación</p>
                  <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{motivo || 'Sin motivo registrado.'}</p>
                </div>
                {observadoPor || observadoAt ? (
                  <p className="text-xs text-slate-500">
                    Observado{observadoPor ? ` por ${observadoPor}` : ''}
                    {observadoAt ? ` el ${formatFechaHora(observadoAt)}` : ''}
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
                  >
                    Cerrar
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

export default Pdt621ObservacionButton;
