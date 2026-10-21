import { useState } from 'react';
import { pdt621Service, type Pdt621Detail } from '../../services/pdt621';
import { extractApiErrorMessage } from '../../utils/apiError';

function formatFecha(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
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
 * archivador del asistente. No hay fecha/hora que elegir: el SERVIDOR registra la fecha y hora
 * actuales (hora de Lima) y la respuesta trae lo que quedó grabado, que es lo que se muestra.
 */
const Pdt621RecepcionarButton = ({ companyId, periodYm, businessName, entrega, compact, onDone, onError }: Props) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const label = entrega === 'primera' ? '1ra entrega' : '2da entrega';

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
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-3 text-left whitespace-normal">
            <h3 className="text-base font-semibold text-slate-800">Recepcionar archivador — {label}</h3>
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">{businessName}</span> · Período {periodYm}
            </p>
            <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <i className="fas fa-clock mt-0.5 text-slate-500" aria-hidden />
              Se registrará la fecha y hora actuales del servidor en el momento de confirmar; no se pueden
              modificar. La declaración pasará a "Por revisar".
            </p>
            <div className="flex justify-end gap-2 pt-1">
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
        </div>
      ) : null}
    </>
  );
};

export default Pdt621RecepcionarButton;
