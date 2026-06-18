import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { activityTemplatesService, type ActivityTemplate } from '../../../services/activityTemplates';
import type { FinanceCalendarActivity } from '../../../services/financeCalendar';
import ActivityTemplatePreview, { priorityBadgeClass } from '../activityTemplates/ActivityTemplatePreview';
import { ACTIVITY_COLORS, activityTypeLabel } from './calendarUtils';
import { priorityLabel } from '../../../utils/supervisorLabels';
import {
  canSubmitTemplateActivity,
  filterActiveTemplates,
  formatTemplateOptionLabel,
  validateActivityDays,
  type ActivityDaysInput,
} from './activityTemplateSelectorUtils';

export type ActivityTemplateFormData = ActivityDaysInput & {
  activity_template_id?: number;
};

type Props = {
  open: boolean;
  title: string;
  mode: 'create' | 'edit';
  initialDays: ActivityDaysInput;
  editActivity?: FinanceCalendarActivity;
  lastDayOfMonth: number;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (data: ActivityTemplateFormData) => void | Promise<void>;
};

const ActivityModalWithTemplate = ({
  open,
  title,
  mode,
  initialDays,
  editActivity,
  lastDayOfMonth,
  saving,
  onClose,
  onSubmit,
}: Props) => {
  const isEdit = mode === 'edit';

  const [templates, setTemplates] = useState<ActivityTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [days, setDays] = useState(initialDays);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDays(initialDays);
    setSearch('');
    setFormError('');
    setSelectedId(isEdit ? (editActivity?.activity_template_id ?? null) : null);
  }, [open, initialDays, isEdit, editActivity?.activity_template_id]);

  useEffect(() => {
    if (!open || isEdit) return;
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError('');
    void activityTemplatesService
      .list({ activeFilter: 'active' })
      .then((rows) => {
        if (!cancelled) setTemplates(rows.filter((t) => t.active));
      })
      .catch(() => {
        if (!cancelled) setTemplatesError('No se pudo cargar el catálogo de plantillas.');
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isEdit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  const filteredTemplates = useMemo(
    () => filterActiveTemplates(templates, search),
    [templates, search],
  );

  const selectedTemplate = useMemo(() => {
    if (isEdit && editActivity) {
      return {
        id: editActivity.activity_template_id ?? 0,
        code: editActivity.template_code ?? '—',
        name: editActivity.name,
        activity_type: editActivity.activity_kind,
        priority: editActivity.priority,
        text_color: editActivity.text_color ?? '#1d4ed8',
        icon: editActivity.icon,
      };
    }
    return templates.find((t) => t.id === selectedId) ?? null;
  }, [isEdit, editActivity, templates, selectedId]);

  const canSave = isEdit
    ? validateActivityDays(days.start_day, days.end_day, days.due_day, lastDayOfMonth).ok
    : canSubmitTemplateActivity(selectedId, days.start_day, days.end_day, days.due_day, lastDayOfMonth);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const validated = validateActivityDays(days.start_day, days.end_day, days.due_day, lastDayOfMonth);
    if (!validated.ok) {
      setFormError(validated.error);
      return;
    }
    if (!isEdit && (selectedId == null || selectedId <= 0)) {
      setFormError('Seleccione una plantilla del catálogo.');
      return;
    }
    void onSubmit({
      activity_template_id: isEdit ? editActivity?.activity_template_id : selectedId ?? undefined,
      ...validated.days,
    });
  };

  const colorMeta = selectedTemplate
    ? ACTIVITY_COLORS.find((c) => c.value === selectedTemplate.text_color)
    : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !saving && onClose()} aria-label="Cerrar" />
      <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {isEdit
              ? 'Los datos de la plantilla son de solo lectura. Solo puede reprogramar los días.'
              : 'Seleccione una plantilla activa y defina el rango de días en el calendario.'}
          </p>
        </div>

        <form className="px-5 py-4 space-y-5" onSubmit={handleSubmit}>
          {!isEdit ? (
            <section className="space-y-3" aria-labelledby="tpl-step-select">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">1</span>
                <h3 id="tpl-step-select" className="text-sm font-semibold text-slate-800">
                  Seleccionar plantilla
                </h3>
              </div>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Buscar por código o nombre</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="AC002 o Generación NPS"
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                />
              </label>
              {templatesLoading ? (
                <p className="text-sm text-slate-500">Cargando plantillas…</p>
              ) : templatesError ? (
                <p className="text-sm text-red-600">{templatesError}</p>
              ) : filteredTemplates.length === 0 ? (
                <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center">
                  No hay plantillas activas que coincidan.
                </p>
              ) : (
                <ul className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {filteredTemplates.map((t) => {
                    const selected = selectedId === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(t.id)}
                          className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                            selected ? 'bg-primary-50 text-primary-900' : 'hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <span className="font-medium">{formatTemplateOptionLabel(t)}</span>
                          <span className="block text-xs text-slate-500 mt-0.5">
                            {activityTypeLabel(t.activity_type)} · {priorityLabel(t.priority)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          {selectedTemplate ? (
            <section className="space-y-3" aria-labelledby="tpl-step-preview">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
                  {isEdit ? '1' : '2'}
                </span>
                <h3 id="tpl-step-preview" className="text-sm font-semibold text-slate-800">
                  Vista previa (solo lectura)
                </h3>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                <div>
                  <dt className="text-xs text-slate-500">Código</dt>
                  <dd className="font-mono text-xs font-medium text-slate-800">{selectedTemplate.code}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Nombre</dt>
                  <dd className="font-medium text-slate-800 truncate">{selectedTemplate.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Tipo</dt>
                  <dd className="text-slate-700">{activityTypeLabel(selectedTemplate.activity_type)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Prioridad</dt>
                  <dd>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${priorityBadgeClass(selectedTemplate.priority)}`}
                    >
                      {priorityLabel(selectedTemplate.priority)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Color</dt>
                  <dd className="flex items-center gap-2">
                    <span
                      className="inline-block h-4 w-4 rounded-full border border-slate-200"
                      style={{ backgroundColor: selectedTemplate.text_color }}
                    />
                    <span className="text-xs text-slate-600">{colorMeta?.label ?? selectedTemplate.text_color}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Icono</dt>
                  <dd className="text-slate-700 font-mono text-xs truncate">
                    {(selectedTemplate.icon ?? '').trim() || '—'}
                  </dd>
                </div>
              </dl>
              <ActivityTemplatePreview
                name={selectedTemplate.name}
                activityType={selectedTemplate.activity_type}
                priority={selectedTemplate.priority}
                textColor={selectedTemplate.text_color}
                icon={selectedTemplate.icon}
              />
            </section>
          ) : !isEdit ? (
            <p className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
              Seleccione una plantilla para ver la vista previa.
            </p>
          ) : null}

          <section className="space-y-3" aria-labelledby="tpl-step-days">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
                {isEdit ? '2' : '3'}
              </span>
              <h3 id="tpl-step-days" className="text-sm font-semibold text-slate-800">
                Días en el calendario
              </h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Inicio (día)</span>
                <input
                  type="number"
                  min={1}
                  max={lastDayOfMonth}
                  required
                  value={days.start_day}
                  onChange={(e) => setDays((d) => ({ ...d, start_day: Number(e.target.value) }))}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Fin (día)</span>
                <input
                  type="number"
                  min={1}
                  max={lastDayOfMonth}
                  required
                  value={days.end_day}
                  onChange={(e) => setDays((d) => ({ ...d, end_day: Number(e.target.value) }))}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Límite (día)</span>
                <input
                  type="number"
                  min={1}
                  max={lastDayOfMonth}
                  required
                  value={days.due_day}
                  onChange={(e) => setDays((d) => ({ ...d, due_day: Number(e.target.value) }))}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </label>
            </div>
          </section>

          {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            Aplica para todas las empresas del estudio. Nombre, tipo, prioridad y color provienen de la plantilla seleccionada.
          </p>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 pb-4">
            <button type="button" disabled={saving} onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !canSave}
              className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {saving ? <i className="fas fa-spinner fa-spin text-xs" aria-hidden /> : null}
              {isEdit ? 'Guardar fechas' : 'Crear actividad'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};

export default ActivityModalWithTemplate;
