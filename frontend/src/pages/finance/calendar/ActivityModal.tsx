import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ACTIVITY_KINDS, ACTIVITY_STATUSES, PRIORITIES } from './calendarUtils';

export type ActivityFormData = {
  name: string;
  description: string;
  activity_kind: string;
  start_day: number;
  end_day: number;
  due_day: number;
  priority: string;
  status: string;
};

type Props = {
  open: boolean;
  title: string;
  initial: ActivityFormData;
  lastDayOfMonth: number;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (data: ActivityFormData) => void | Promise<void>;
};

const ActivityModal = ({ open, title, initial, lastDayOfMonth, saving, onClose, onSubmit }: Props) => {
  const [form, setForm] = useState(initial);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const clampDay = (v: number) => Math.min(Math.max(1, v), lastDayOfMonth);

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !saving && onClose()} aria-label="Cerrar" />
      <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500 mt-0.5">La actividad se mostrará como bloque continuo en el calendario.</p>
        </div>

        <form
          className="px-5 py-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit({
              ...form,
              start_day: clampDay(form.start_day),
              end_day: clampDay(Math.max(form.start_day, form.end_day)),
              due_day: clampDay(form.due_day),
            });
          }}
        >
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Nombre de actividad</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
              placeholder="Ej. Generación de NPS"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Descripción (opcional)</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 resize-none"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Tipo de actividad</span>
            <select
              value={form.activity_kind}
              onChange={(e) => setForm((f) => ({ ...f, activity_kind: e.target.value }))}
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5"
            >
              {ACTIVITY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Inicio (día)</span>
              <input
                type="number"
                min={1}
                max={lastDayOfMonth}
                value={form.start_day}
                onChange={(e) => setForm((f) => ({ ...f, start_day: Number(e.target.value) }))}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Fin (día)</span>
              <input
                type="number"
                min={1}
                max={lastDayOfMonth}
                value={form.end_day}
                onChange={(e) => setForm((f) => ({ ...f, end_day: Number(e.target.value) }))}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Límite (día)</span>
              <input
                type="number"
                min={1}
                max={lastDayOfMonth}
                value={form.due_day}
                onChange={(e) => setForm((f) => ({ ...f, due_day: Number(e.target.value) }))}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Prioridad</span>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Estado inicial</span>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5"
              >
                {ACTIVITY_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            Aplica para todas las empresas del estudio. El cumplimiento se calcula según el tipo de actividad y los controles de supervisor.
          </p>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 pb-4">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {saving ? <i className="fas fa-spinner fa-spin text-xs" aria-hidden /> : null}
              Guardar actividad
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};

export default ActivityModal;
