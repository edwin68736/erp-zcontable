import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { currentPeriodYM } from './calendarUtils';

type Props = {
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (periodYm: string, notes: string) => void;
};

const CreateCalendarModal = ({ open, saving, onClose, onConfirm }: Props) => {
  const [periodYm, setPeriodYm] = useState(currentPeriodYM());
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setPeriodYm(currentPeriodYM());
      setNotes('');
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !saving && onClose()} aria-label="Cerrar" />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Nuevo calendario</h2>
          <p className="text-sm text-slate-500 mt-1">Cree el calendario mensual de obligaciones contables.</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Mes</span>
            <input
              type="month"
              value={periodYm}
              onChange={(e) => setPeriodYm(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Notas (opcional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 resize-none"
            />
          </label>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 bg-slate-50/80 rounded-b-2xl">
          <button type="button" disabled={saving} onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 bg-white">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !periodYm}
            onClick={() => onConfirm(periodYm, notes)}
            className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <i className="fas fa-spinner fa-spin text-xs" aria-hidden /> : null}
            Crear calendario
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CreateCalendarModal;
