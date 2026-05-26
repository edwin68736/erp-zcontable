import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatPeriodLabel } from './calendarUtils';

type Props = {
  open: boolean;
  fromPeriodYm: string;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (toYm: string, opts: { copy_activities: boolean; copy_marks: boolean; copy_notes: boolean }) => void;
};

const DuplicateMonthModal = ({ open, fromPeriodYm, saving, onClose, onConfirm }: Props) => {
  const [toYm, setToYm] = useState('');
  const [copyActivities, setCopyActivities] = useState(true);
  const [copyMarks, setCopyMarks] = useState(true);
  const [copyNotes, setCopyNotes] = useState(true);

  useEffect(() => {
    if (open) {
      const [y, m] = fromPeriodYm.split('-').map(Number);
      const next = new Date(y, m, 1);
      setToYm(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
      setCopyActivities(true);
      setCopyMarks(true);
      setCopyNotes(true);
    }
  }, [open, fromPeriodYm]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !saving && onClose()} aria-label="Cerrar" />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Duplicar calendario</h2>
          <p className="text-sm text-slate-500 mt-1">
            Copiar <strong>{formatPeriodLabel(fromPeriodYm)}</strong> a otro mes
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="flex-1 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 font-medium text-slate-800">
              {formatPeriodLabel(fromPeriodYm)}
            </span>
            <i className="fas fa-arrow-right text-slate-400" aria-hidden />
            <label className="flex-1 text-sm">
              <span className="sr-only">Mes destino</span>
              <input
                type="month"
                value={toYm}
                onChange={(e) => setToYm(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2"
              />
            </label>
          </div>

          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium text-slate-700 mb-2">Incluir en la copia</legend>
            {[
              { id: 'acts', label: 'Actividades', checked: copyActivities, set: setCopyActivities },
              { id: 'marks', label: 'Feriados y fechas especiales', checked: copyMarks, set: setCopyMarks },
              { id: 'notes', label: 'Configuración / notas del mes', checked: copyNotes, set: setCopyNotes },
            ].map(({ id, label, checked, set }) => (
              <label key={id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => set(e.target.checked)}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-slate-600">{label}</span>
              </label>
            ))}
          </fieldset>

          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Si el mes destino ya existe, será reemplazado por la copia.
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 bg-slate-50/80 rounded-b-2xl border-t border-slate-100">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !toYm || toYm === fromPeriodYm}
            onClick={() => onConfirm(toYm, { copy_activities: copyActivities, copy_marks: copyMarks, copy_notes: copyNotes })}
            className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving ? <i className="fas fa-spinner fa-spin text-xs" aria-hidden /> : <i className="fas fa-copy text-xs" aria-hidden />}
            Duplicar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DuplicateMonthModal;
