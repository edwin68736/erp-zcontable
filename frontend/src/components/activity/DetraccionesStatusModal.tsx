import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DETRACCIONES_SUPERVISOR_MANUAL_STATUSES,
  detraccionesStatusLabel,
} from './detraccionesConfig';

type DetraccionesStatusModalProps = {
  open: boolean;
  companyName: string;
  currentStatus: string;
  saving: boolean;
  onClose: () => void;
  onConfirm: (status: 'sin_clave' | 'no_corresponde') => void;
};

const DetraccionesStatusModal = ({
  open,
  companyName,
  currentStatus,
  saving,
  onClose,
  onConfirm,
}: DetraccionesStatusModalProps) => {
  const [selected, setSelected] = useState<'sin_clave' | 'no_corresponde'>('sin_clave');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar"
        disabled={saving}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="detracciones-status-modal-title"
        className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
      >
        <div>
          <h2 id="detracciones-status-modal-title" className="text-lg font-semibold text-slate-800">
            Cambiar estado
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {companyName} · estado actual: {detraccionesStatusLabel(currentStatus)}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Al marcar «Sin clave» o «No corresponde», el asistente ya no podrá cargar PDF para esta empresa.
          </p>
        </div>
        <div className="space-y-2">
          {DETRACCIONES_SUPERVISOR_MANUAL_STATUSES.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${
                selected === opt.value ? 'border-primary-400 bg-primary-50' : 'border-slate-200'
              }`}
            >
              <input
                type="radio"
                name="detracciones-status"
                value={opt.value}
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
              />
              <span className="text-sm text-slate-800">{opt.label}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onConfirm(selected)}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DetraccionesStatusModal;
