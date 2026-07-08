import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  activityTemplatesService,
  activityTemplateApiError,
  type ActivityTemplate,
  type ActivityTemplateActiveFilter,
} from '../../services/activityTemplates';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { ACTIVITY_COLORS, activityTypeLabel } from './calendar/calendarUtils';
import { priorityLabel } from '../../utils/supervisorLabels';
import ActivityTemplatePreview, { priorityBadgeClass } from './activityTemplates/ActivityTemplatePreview';
import ActivityTemplatesBreadcrumb from './activityTemplates/ActivityTemplatesBreadcrumb';
import ConfirmDialog from '../../components/ConfirmDialog';

function parseActiveFilter(value: string | null): ActivityTemplateActiveFilter {
  if (value === 'active' || value === 'inactive') return value;
  return 'all';
}

const ActivityTemplates = () => {
  const canView = useMemo(() => auth.hasPermission(P.financeCalendarView), []);
  const canManage = useMemo(() => auth.hasPermission(P.financeCalendarManage), []);

  const [searchParams, setSearchParams] = useSearchParams();
  const filterKey = searchParams.toString();

  const [codeSearch, setCodeSearch] = useState(() => searchParams.get('code') ?? '');
  const [nameSearch, setNameSearch] = useState(() => searchParams.get('name') ?? '');
  const [activeFilter, setActiveFilter] = useState<ActivityTemplateActiveFilter>(() =>
    parseActiveFilter(searchParams.get('active')),
  );

  const [list, setList] = useState<ActivityTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ActivityTemplate | null>(null);

  useEffect(() => {
    setCodeSearch(searchParams.get('code') ?? '');
    setNameSearch(searchParams.get('name') ?? '');
    setActiveFilter(parseActiveFilter(searchParams.get('active')));
  }, [filterKey, searchParams]);

  const load = useCallback(async () => {
    const sp = new URLSearchParams(filterKey);
    try {
      setLoading(true);
      const rows = await activityTemplatesService.list({
        activeFilter: parseActiveFilter(sp.get('active')),
        codeSearch: sp.get('code') ?? undefined,
        nameSearch: sp.get('name') ?? undefined,
      });
      setList(rows);
    } catch {
      setList([]);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'error', message: 'No se pudo cargar el catálogo de actividades.' },
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [filterKey]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const handleFilterSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const code = codeSearch.trim();
      const name = nameSearch.trim();
      if (code) next.set('code', code);
      else next.delete('code');
      if (name) next.set('name', name);
      else next.delete('name');
      if (activeFilter !== 'all') next.set('active', activeFilter);
      else next.delete('active');
      return next;
    });
  };

  const handleClearFilters = () => {
    setCodeSearch('');
    setNameSearch('');
    setActiveFilter('all');
    setSearchParams({});
  };

  const toast = (type: 'success' | 'error', message: string) => {
    window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type, message } }));
  };

  const handleToggleActive = async (row: ActivityTemplate) => {
    if (!canManage) return;
    setActionId(row.id);
    try {
      await activityTemplatesService.setActive(row.id, !row.active);
      toast('success', row.active ? 'Plantilla desactivada.' : 'Plantilla activada.');
      void load();
    } catch (err) {
      toast('error', activityTemplateApiError(err, 'No se pudo cambiar el estado.'));
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || !canManage) return;
    setActionId(confirmDelete.id);
    try {
      await activityTemplatesService.remove(confirmDelete.id);
      toast('success', 'Plantilla eliminada.');
      setConfirmDelete(null);
      void load();
    } catch (err) {
      toast('error', activityTemplateApiError(err, 'No se pudo eliminar la plantilla.'));
    } finally {
      setActionId(null);
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

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <ActivityTemplatesBreadcrumb
        items={[
          { label: 'Finanzas', to: '/finance/calendar' },
          { label: 'Catálogo de actividades' },
        ]}
      />

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Catálogo de actividades</h2>
          <p className="text-sm text-slate-500">
            Plantillas reutilizables para el calendario contable (código, tipo, prioridad y apariencia).
          </p>
        </div>
        {canManage ? (
          <Link
            to="/finance/activity-templates/new"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shrink-0"
          >
            <i className="fas fa-plus text-xs" aria-hidden />
            Nueva plantilla
          </Link>
        ) : null}
      </div>

      <form
        onSubmit={handleFilterSubmit}
        className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-sm"
      >
        <div className="min-w-[140px] flex-1">
          <label htmlFor="tpl-code" className="block text-xs font-medium text-slate-500 mb-1">
            Código
          </label>
          <input
            id="tpl-code"
            value={codeSearch}
            onChange={(e) => setCodeSearch(e.target.value)}
            placeholder="AC001"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div className="min-w-[160px] flex-[2]">
          <label htmlFor="tpl-name" className="block text-xs font-medium text-slate-500 mb-1">
            Nombre
          </label>
          <input
            id="tpl-name"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Generación NPS"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div className="min-w-[140px]">
          <label htmlFor="tpl-active" className="block text-xs font-medium text-slate-500 mb-1">
            Estado
          </label>
          <select
            id="tpl-active"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as ActivityTemplateActiveFilter)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 rounded-full bg-slate-800 text-white text-sm font-medium hover:bg-slate-900"
          >
            Filtrar
          </button>
          <button
            type="button"
            onClick={handleClearFilters}
            className="px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Limpiar
          </button>
        </div>
      </form>

      {loading ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No hay plantillas que coincidan con los filtros.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Código</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Nombre / vista previa</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden md:table-cell">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden lg:table-cell">Prioridad</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden sm:table-cell">Color</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">Activo</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">Validable</th>
                {canManage ? (
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Acciones</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((row) => {
                const colorMeta = ACTIVITY_COLORS.find((c) => c.value === row.text_color);
                const busy = actionId === row.id;
                return (
                  <tr key={row.id} className={!row.active ? 'bg-slate-50/60' : undefined}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-800">{row.code}</td>
                    <td className="px-4 py-3 min-w-[200px]">
                      <ActivityTemplatePreview
                        compact
                        name={row.name}
                        activityType={row.activity_type}
                        priority={row.priority}
                        textColor={row.text_color}
                        icon={row.icon}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-700 hidden md:table-cell">
                      {activityTypeLabel(row.activity_type)}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${priorityBadgeClass(row.priority)}`}
                      >
                        {priorityLabel(row.priority)}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-4 w-4 rounded-full border border-slate-200 shadow-inner"
                          style={{ backgroundColor: row.text_color }}
                          title={colorMeta?.label ?? row.text_color}
                        />
                        <span className="text-xs text-slate-500">{colorMeta?.label ?? row.text_color}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.active ? (
                        <span className="text-emerald-700 text-xs font-medium">Sí</span>
                      ) : (
                        <span className="text-slate-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.is_validatable ? (
                        <i className="fas fa-check text-emerald-600 text-xs" title="Validable" aria-label="Validable" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <Link
                            to={`/finance/activity-templates/${row.id}/edit`}
                            className="text-primary-700 text-xs font-medium hover:underline"
                          >
                            Editar
                          </Link>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleToggleActive(row)}
                            className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                          >
                            {row.active ? 'Desactivar' : 'Activar'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmDelete(row)}
                            className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-slate-500">
        <Link to="/finance/calendar" className="text-primary-700 font-medium hover:underline">
          ← Volver al calendario contable
        </Link>
      </p>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Eliminar plantilla"
        message={
          confirmDelete
            ? `¿Eliminar la plantilla «${confirmDelete.code} — ${confirmDelete.name}»? Solo es posible si no tiene actividades en calendarios.`
            : ''
        }
        confirmLabel="Eliminar"
        danger
        loading={actionId !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
};

export default ActivityTemplates;
