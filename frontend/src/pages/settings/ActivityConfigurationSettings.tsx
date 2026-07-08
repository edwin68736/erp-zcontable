import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import {
  activityRulesService,
  type ActivityRule,
  type ActivityRuleAudit,
  type ActivityRuleCompareMode,
  type ActivityRuleInput,
} from '../../services/activityRules';
import {
  activityConfigurationService,
  type ActivityTemplateConfig,
} from '../../services/activityConfiguration';

const COMPARE_MODES: { value: ActivityRuleCompareMode; label: string }[] = [
  { value: 'date', label: 'Fecha (mismo día = a tiempo)' },
  { value: 'datetime', label: 'Fecha y hora límite' },
];

const emptyRuleForm = (): ActivityRuleInput => ({
  name: '',
  description: '',
  compare_mode: 'date',
  max_upload_time: '',
  grace_days: 0,
  active: true,
});

const ActivityConfigurationSettings = () => {
  const canView = useMemo(() => auth.hasPermission(P.settingsFirmView), []);
  const canEdit = useMemo(() => auth.hasPermission(P.settingsFirmUpdate), []);

  const [rules, setRules] = useState<ActivityRule[]>([]);
  const [templates, setTemplates] = useState<ActivityTemplateConfig[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ActivityRule | null>(null);
  const [form, setForm] = useState<ActivityRuleInput>(emptyRuleForm());
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [audits, setAudits] = useState<Record<number, ActivityRuleAudit[]>>({});
  const [savingTemplateId, setSavingTemplateId] = useState<number | null>(null);

  const ruleNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of rules) map.set(r.id, r.name);
    return map;
  }, [rules]);

  const loadRules = useCallback(async () => {
    try {
      setLoadingRules(true);
      setRules(await activityRulesService.list());
    } catch (e) {
      console.error(e);
      setError('No se pudieron cargar las reglas.');
      setRules([]);
    } finally {
      setLoadingRules(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true);
      setTemplates(await activityConfigurationService.listTemplates());
    } catch (e) {
      console.error(e);
      setError('No se pudieron cargar las plantillas de actividad.');
      setTemplates([]);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    void loadRules();
    void loadTemplates();
  }, [canView, loadRules, loadTemplates]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyRuleForm());
    setModalOpen(true);
  };

  const openEdit = (row: ActivityRule) => {
    setEditing(row);
    setForm({
      name: row.name,
      description: row.description ?? '',
      compare_mode: row.compare_mode,
      max_upload_time: row.max_upload_time ?? '',
      grace_days: row.grace_days,
      active: row.active,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    try {
      setSaving(true);
      setError('');
      const payload: ActivityRuleInput = {
        ...form,
        name: form.name.trim(),
        description: form.description?.trim() ?? '',
        max_upload_time: form.compare_mode === 'datetime' ? form.max_upload_time?.trim() : '',
      };
      if (editing) {
        await activityRulesService.update(editing.id, payload);
      } else {
        await activityRulesService.create(payload);
      }
      setModalOpen(false);
      await loadRules();
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Regla guardada.' } }),
      );
    } catch (err) {
      console.error(err);
      setError('No se pudo guardar la regla. Revise los datos.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (row: ActivityRule) => {
    if (!canEdit || !row.active) return;
    if (!window.confirm(`¿Desactivar la regla "${row.name}"?`)) return;
    try {
      await activityRulesService.update(row.id, {
        name: row.name,
        description: row.description,
        compare_mode: row.compare_mode,
        max_upload_time: row.max_upload_time,
        grace_days: row.grace_days,
        active: false,
      });
      await loadRules();
    } catch (err) {
      console.error(err);
      setError('No se pudo desactivar la regla.');
    }
  };

  const toggleAudits = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!audits[id]) {
      try {
        const rows = await activityRulesService.listAudits(id);
        setAudits((prev) => ({ ...prev, [id]: rows }));
      } catch {
        setAudits((prev) => ({ ...prev, [id]: [] }));
      }
    }
  };

  const handleTemplateRuleChange = async (templateId: number, value: string) => {
    if (!canEdit) return;
    const ruleId = value === '' ? null : Number(value);
    try {
      setSavingTemplateId(templateId);
      setError('');
      const updated = await activityConfigurationService.setTemplateRule(templateId, ruleId);
      setTemplates((prev) => prev.map((t) => (t.id === templateId ? { ...t, ...updated } : t)));
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Regla asignada a la actividad.' } }),
      );
    } catch (err) {
      console.error(err);
      setError('No se pudo guardar la regla de la actividad.');
    } finally {
      setSavingTemplateId(null);
    }
  };

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !saving) setModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, saving]);

  if (!canView) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No tienes permisos para acceder a esta pantalla.
        </div>
      </div>
    );
  }

  const activeRules = rules.filter((r) => r.active);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">Parametrización de actividades</h2>
        <p className="text-sm text-slate-500 mt-1">
          Reglas reutilizables de cumplimiento y su asignación a plantillas del calendario financiero.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Reglas de cumplimiento</h3>
            <p className="text-sm text-slate-500 mt-1">Plazos de carga según fecha o fecha/hora del calendario.</p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
            >
              <i className="fas fa-plus" aria-hidden />
              Nueva regla
            </button>
          ) : null}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loadingRules ? (
            <p className="px-4 py-8 text-sm text-slate-500 text-center">
              <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
              Cargando reglas…
            </p>
          ) : rules.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500 text-center">Sin reglas configuradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Nombre</th>
                    <th className="px-4 py-3">Modo</th>
                    <th className="px-4 py-3">Hora límite</th>
                    <th className="px-4 py-3">Gracia (días)</th>
                    <th className="px-4 py-3">Activo</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((row) => (
                    <Fragment key={row.id}>
                      <tr className="border-t border-slate-100">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{row.name}</div>
                          {row.description ? (
                            <div className="text-xs text-slate-500 mt-0.5">{row.description}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">{row.compare_mode}</td>
                        <td className="px-4 py-3">{row.max_upload_time || '—'}</td>
                        <td className="px-4 py-3 tabular-nums">{row.grace_days}</td>
                        <td className="px-4 py-3">{row.active ? 'Sí' : 'No'}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void toggleAudits(row.id)}
                              className="text-xs text-slate-600 hover:underline"
                            >
                              Auditoría
                            </button>
                            {canEdit ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEdit(row)}
                                  className="text-xs text-primary-700 hover:underline"
                                >
                                  Editar
                                </button>
                                {row.active ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeactivate(row)}
                                    className="text-xs text-amber-700 hover:underline"
                                  >
                                    Desactivar
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {expandedId === row.id ? (
                        <tr className="border-t border-slate-100 bg-slate-50/50">
                          <td colSpan={6} className="px-4 py-3">
                            {(audits[row.id] ?? []).length === 0 ? (
                              <p className="text-xs text-slate-500">Sin registros de auditoría.</p>
                            ) : (
                              <ul className="space-y-2 text-xs text-slate-600">
                                {(audits[row.id] ?? []).map((a) => (
                                  <li key={a.id}>
                                    <span className="font-medium">{a.action}</span> · usuario {a.user_id} ·{' '}
                                    {new Date(a.created_at).toLocaleString('es-PE')}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Actividades</h3>
          <p className="text-sm text-slate-500 mt-1">
            Asigne una regla a cada plantilla. Las actividades del calendario heredan la regla al crearse (snapshot).
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loadingTemplates ? (
            <p className="px-4 py-8 text-sm text-slate-500 text-center">
              <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
              Cargando actividades…
            </p>
          ) : templates.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500 text-center">Sin plantillas de actividad.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Actividad</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Regla</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((tpl) => (
                    <tr key={tpl.id} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{tpl.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{tpl.code}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700">{tpl.activity_type}</td>
                      <td className="px-4 py-3">
                        {canEdit ? (
                          <select
                            value={tpl.activity_rule_id ?? ''}
                            disabled={savingTemplateId === tpl.id}
                            onChange={(e) => void handleTemplateRuleChange(tpl.id, e.target.value)}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm min-w-[12rem] disabled:opacity-50"
                          >
                            <option value="">Sin regla</option>
                            {activeRules.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                            {tpl.activity_rule_id &&
                            !activeRules.some((r) => r.id === tpl.activity_rule_id) ? (
                              <option value={tpl.activity_rule_id}>
                                {ruleNameById.get(tpl.activity_rule_id) ?? `Regla #${tpl.activity_rule_id}`}{' '}
                                (inactiva)
                              </option>
                            ) : null}
                          </select>
                        ) : (
                          <span className="text-slate-700">
                            {tpl.activity_rule_id
                              ? (ruleNameById.get(tpl.activity_rule_id) ?? `#${tpl.activity_rule_id}`)
                              : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {modalOpen
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={() => !saving && setModalOpen(false)}
                aria-label="Cerrar"
              />
              <form
                onSubmit={(e) => void handleSubmit(e)}
                className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
              >
                <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Editar regla' : 'Nueva regla'}</h3>
                <label className="block text-sm">
                  <span className="text-slate-600">Nombre</span>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Fecha Simple"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Descripción</span>
                  <textarea
                    value={form.description ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Modo de comparación</span>
                  <select
                    value={form.compare_mode}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, compare_mode: e.target.value as ActivityRuleCompareMode }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    {COMPARE_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.compare_mode === 'datetime' ? (
                  <label className="block text-sm">
                    <span className="text-slate-600">Hora límite (HH:MM)</span>
                    <input
                      type="time"
                      required
                      value={form.max_upload_time || '23:59'}
                      onChange={(e) => setForm((f) => ({ ...f, max_upload_time: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                ) : null}
                <label className="block text-sm">
                  <span className="text-slate-600">Días de gracia</span>
                  <input
                    type="number"
                    min={0}
                    value={form.grace_days}
                    onChange={(e) => setForm((f) => ({ ...f, grace_days: Number(e.target.value) || 0 }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  />
                  Activo
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !canEdit}
                    className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default ActivityConfigurationSettings;
