import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useMatch, useNavigate, useParams } from 'react-router-dom';
import {
  activityTemplatesService,
  activityTemplateApiError,
} from '../../services/activityTemplates';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  ACTIVITY_COLORS,
  ACTIVITY_TYPES,
  DEFAULT_ACTIVITY_COLOR,
  PRIORITIES,
} from './calendar/calendarUtils';
import ActivityTemplatePreview from './activityTemplates/ActivityTemplatePreview';
import ActivityTemplatesBreadcrumb from './activityTemplates/ActivityTemplatesBreadcrumb';

const ActivityTemplateForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isCreateRoute = useMatch({ path: '/finance/activity-templates/new', end: true }) != null;
  const editId =
    !isCreateRoute && id && /^\d+$/.test(id) ? Number.parseInt(id, 10) : null;
  const isEdit = editId != null && editId > 0;

  const canView = useMemo(() => auth.hasPermission(P.financeCalendarView), []);
  const canManage = useMemo(() => auth.hasPermission(P.financeCalendarManage), []);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [activityType, setActivityType] = useState('nps');
  const [priority, setPriority] = useState('media');
  const [textColor, setTextColor] = useState<string>(DEFAULT_ACTIVITY_COLOR);
  const [icon, setIcon] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [isValidatable, setIsValidatable] = useState(true);
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit || !editId) {
      void activityTemplatesService
        .previewNextCode()
        .then(setCode)
        .catch(() => setError('No se pudo obtener el código correlativo.'));
      return;
    }
    void activityTemplatesService
      .get(editId)
      .then((row) => {
        setCode(row.code);
        setName(row.name);
        setDescription(row.description ?? '');
        setActivityType(row.activity_type);
        setPriority(row.priority);
        setTextColor(row.text_color || DEFAULT_ACTIVITY_COLOR);
        setIcon(row.icon ?? '');
        setSortOrder(String(row.sort_order ?? 0));
        setIsValidatable(row.is_validatable);
        setActive(row.active);
      })
      .catch((err) => setError(activityTemplateApiError(err, 'Error al cargar la plantilla.')))
      .finally(() => setLoading(false));
  }, [editId, isEdit]);

  useEffect(() => {
    if (isEdit) return;
    if (activityType === 'other') {
      setIsValidatable(false);
    } else {
      setIsValidatable(true);
    }
  }, [activityType, isEdit]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      setError('Sin permiso para guardar plantillas.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        activity_type: activityType,
        priority,
        text_color: textColor,
        icon: icon.trim() || undefined,
        sort_order: Number(sortOrder) || 0,
        is_validatable: isValidatable,
        active,
      };
      if (isEdit && editId) {
        await activityTemplatesService.update(editId, payload);
      } else {
        await activityTemplatesService.create(payload);
      }
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'success', message: isEdit ? 'Plantilla actualizada.' : 'Plantilla creada.' },
        }),
      );
      navigate('/finance/activity-templates', { replace: true });
    } catch (err) {
      setError(activityTemplateApiError(err, 'Error al guardar la plantilla.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className="max-w-lg mx-auto p-12 text-center">
        <i className="fas fa-lock text-3xl text-slate-300 mb-4" aria-hidden />
        <p className="text-slate-600">Sin permiso para ver el catálogo de actividades.</p>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="max-w-lg mx-auto p-12 text-center">
        <i className="fas fa-lock text-3xl text-slate-300 mb-4" aria-hidden />
        <p className="text-slate-600">Sin permiso para crear o editar plantillas.</p>
        <Link to="/finance/activity-templates" className="mt-4 inline-block text-sm text-primary-700 font-medium">
          Volver al listado
        </Link>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  }

  const title = isEdit ? 'Editar plantilla' : 'Nueva plantilla';

  return (
    <div className={`${PAGE_WORKSPACE_CLASS} max-w-3xl`}>
      <ActivityTemplatesBreadcrumb
        items={[
          { label: 'Finanzas', to: '/finance/calendar' },
          { label: 'Catálogo de actividades', to: '/finance/activity-templates' },
          { label: title },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
        <Link to="/finance/activity-templates" className="text-sm text-slate-600 hover:text-slate-900">
          Volver al listado
        </Link>
      </div>

      {error ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">{error}</div>
      ) : null}

      <div className="grid lg:grid-cols-[1fr,minmax(240px,320px)] gap-6 items-start">
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 bg-white border border-slate-200 rounded-xl p-6 shadow-sm"
        >
          <div>
            <label htmlFor="tpl-form-code" className="block text-sm font-medium mb-1">
              Código
            </label>
            <input
              id="tpl-form-code"
              readOnly
              value={code}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-mono text-slate-600 cursor-not-allowed"
              title={isEdit ? 'El código no se puede modificar' : 'Asignado al guardar (vista previa del correlativo)'}
            />
            {!isEdit ? (
              <p className="text-xs text-slate-500 mt-1">
                Correlativo reservado al crear. El valor mostrado es una vista previa.
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="tpl-form-name" className="block text-sm font-medium mb-1">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              id="tpl-form-name"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label htmlFor="tpl-form-desc" className="block text-sm font-medium mb-1">
              Descripción
            </label>
            <textarea
              id="tpl-form-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tpl-form-type" className="block text-sm font-medium mb-1">
                Tipo de actividad <span className="text-red-500">*</span>
              </label>
              <select
                id="tpl-form-type"
                required
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                {ACTIVITY_TYPES.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tpl-form-priority" className="block text-sm font-medium mb-1">
                Prioridad
              </label>
              <select
                id="tpl-form-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium mb-2">Color del texto</span>
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_COLORS.map((c) => {
                const selected = textColor === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onClick={() => setTextColor(c.value)}
                    className={`h-8 w-8 rounded-full border-2 transition-transform ${
                      selected ? 'border-slate-800 scale-110' : 'border-white shadow ring-1 ring-slate-200'
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="tpl-form-icon" className="block text-sm font-medium mb-1">
              Icono (Font Awesome)
            </label>
            <input
              id="tpl-form-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="fas fa-file-invoice"
              maxLength={80}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
            />
            <p className="text-xs text-slate-500 mt-1">Opcional. Ejemplo: fas fa-calendar-check</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tpl-form-sort" className="block text-sm font-medium mb-1">
                Orden
              </label>
              <input
                id="tpl-form-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div className="flex flex-col gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isValidatable}
                  onChange={(e) => setIsValidatable(e.target.checked)}
                />
                Validable (cumplimiento por empresa)
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Activa en el catálogo
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-5 py-2 rounded-full bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <Link
              to="/finance/activity-templates"
              className="px-5 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </Link>
          </div>
        </form>

        <ActivityTemplatePreview
          name={name}
          activityType={activityType}
          priority={priority}
          textColor={textColor}
          icon={icon.trim() || undefined}
        />
      </div>
    </div>
  );
};

export default ActivityTemplateForm;
