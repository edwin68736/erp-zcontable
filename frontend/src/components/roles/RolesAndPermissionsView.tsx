import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { auth } from '../../services/auth';
import { rolesService, type ModuleRow, type RoleCreateInput, type RoleRow, type RoleUpdateInput } from '../../services/roles';
import { P } from '../../rbac/codes';
import ConfirmDialog from '../ConfirmDialog';
import RoleCrudModal from './RoleCrudModal';

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

/** Texto visible del permiso (nombre o descripción; nunca el código técnico). */
function permissionDisplayLabel(perm: { name: string; description?: string }): string {
  const name = perm.name.trim();
  if (name) return name;
  const desc = perm.description?.trim();
  if (desc) return desc;
  return 'Permiso';
}

function getApiMessage(e: unknown): string {
  if (!e || typeof e !== 'object' || !('response' in e)) return 'Error inesperado';
  const data = (e as { response?: { data?: { message?: string; error?: string } } }).response?.data;
  const m = data?.message ?? data?.error;
  return typeof m === 'string' && m.trim() ? m : 'Error inesperado';
}

const RolesAndPermissionsView = () => {
  const canView = auth.hasPermission(P.rbacRolesView);
  const canManage = auth.hasPermission(P.rbacRolesManage);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [baseline, setBaseline] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [permLoading, setPermLoading] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);
  const [listError, setListError] = useState('');

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [modalRole, setModalRole] = useState<RoleRow | null>(null);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cloneSource, setCloneSource] = useState<RoleRow | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneDesc, setCloneDesc] = useState('');
  const [cloneSaving, setCloneSaving] = useState(false);
  const [cloneError, setCloneError] = useState('');
  const [defaultSavingId, setDefaultSavingId] = useState<number | null>(null);

  const currentRole = useMemo(() => roles.find((r) => r.id === roleId) ?? null, [roles, roleId]);
  const canEditPermissions = canManage;

  const dirty = useMemo(() => !setsEqual(selected, baseline), [selected, baseline]);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => r.name.toLowerCase().includes(q));
  }, [roles, search]);

  const loadListAndCatalog = useCallback(async () => {
    const [r, m] = await Promise.all([rolesService.list(), rolesService.catalog()]);
    setRoles(r);
    setModules(m);
    return r;
  }, []);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setListError('');
        const r = await loadListAndCatalog();
        if (cancelled) return;
        setRoleId((prev) => {
          if (prev && r.some((x) => x.id === prev)) return prev;
          return r[0]?.id ?? null;
        });
      } catch (e) {
        console.error(e);
        if (!cancelled) setListError(getApiMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, loadListAndCatalog]);

  useEffect(() => {
    if (!roleId || !canView) return;
    let cancelled = false;
    (async () => {
      try {
        setPermLoading(true);
        const detail = await rolesService.get(roleId);
        if (cancelled) return;
        const next = new Set<number>();
        (detail.permissions ?? []).forEach((p) => next.add(p.id));
        setSelected(next);
        setBaseline(new Set(next));
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setPermLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleId, canView]);

  const trySelectRole = useCallback(
    (id: number) => {
      if (id === roleId) return;
      if (dirty) {
        const ok = window.confirm('Tiene cambios sin guardar en los permisos. ¿Descartar y cambiar de rol?');
        if (!ok) return;
      }
      setRoleId(id);
    },
    [dirty, roleId],
  );

  const togglePerm = useCallback(
    (pid: number) => {
      if (!canEditPermissions) return;
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(pid)) n.delete(pid);
        else n.add(pid);
        return n;
      });
    },
    [canEditPermissions],
  );

  const selectAllInModule = useCallback(
    (mod: ModuleRow, select: boolean) => {
      if (!canEditPermissions) return;
      const ids = (mod.permissions ?? []).map((p) => p.id);
      setSelected((prev) => {
        const n = new Set(prev);
        if (select) ids.forEach((id) => n.add(id));
        else ids.forEach((id) => n.delete(id));
        return n;
      });
    },
    [canEditPermissions],
  );

  const handleSavePermissions = async () => {
    if (!roleId || !canEditPermissions) return;
    try {
      setSavingPerms(true);
      setListError('');
      await rolesService.replacePermissions(roleId, [...selected]);
      await auth.refreshPermissions();
      const r = await rolesService.get(roleId);
      const next = new Set<number>();
      (r.permissions ?? []).forEach((p) => next.add(p.id));
      setSelected(next);
      setBaseline(new Set(next));
      const list = await rolesService.list();
      setRoles(list);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Permisos guardados correctamente.' } }),
      );
    } catch (e) {
      console.error(e);
      setListError(getApiMessage(e));
    } finally {
      setSavingPerms(false);
    }
  };

  const handleDiscardPermissions = () => {
    setSelected(new Set(baseline));
  };

  const openCreate = () => {
    setModalError('');
    setModalRole(null);
    setModalMode('create');
  };

  const openEdit = (r: RoleRow) => {
    setModalError('');
    setModalRole(r);
    setModalMode('edit');
  };

  const handleModalCreate = async (input: RoleCreateInput) => {
    try {
      setModalSaving(true);
      setModalError('');
      const created = await rolesService.create(input);
      const list = await rolesService.list();
      setRoles(list);
      setRoleId(created.id);
      setModalMode(null);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Rol creado correctamente.' } }),
      );
    } catch (e) {
      setModalError(getApiMessage(e));
    } finally {
      setModalSaving(false);
    }
  };

  const handleModalUpdate = async (id: number, input: RoleUpdateInput) => {
    try {
      setModalSaving(true);
      setModalError('');
      await rolesService.update(id, input);
      const list = await rolesService.list();
      setRoles(list);
      setModalMode(null);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Rol actualizado correctamente.' } }),
      );
    } catch (e) {
      setModalError(getApiMessage(e));
    } finally {
      setModalSaving(false);
    }
  };

  const handleSetDefault = async (r: RoleRow) => {
    if (r.is_default) return;
    try {
      setDefaultSavingId(r.id);
      await rolesService.setDefault(r.id);
      const list = await rolesService.list();
      setRoles(list);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: `«${r.name}» es ahora el rol predeterminado.` } }),
      );
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: getApiMessage(e) } }),
      );
    } finally {
      setDefaultSavingId(null);
    }
  };

  const openClone = (r: RoleRow) => {
    setCloneError('');
    setCloneSource(r);
    setCloneName(`${r.name} (copia)`);
    setCloneDesc(r.description ?? '');
  };

  const handleConfirmClone = async () => {
    if (!cloneSource) return;
    try {
      setCloneSaving(true);
      setCloneError('');
      const created = await rolesService.clone(cloneSource.id, {
        name: cloneName.trim(),
        description: cloneDesc.trim(),
      });
      const list = await rolesService.list();
      setRoles(list);
      setRoleId(created.id);
      setCloneSource(null);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Rol clonado correctamente.' } }),
      );
    } catch (e) {
      setCloneError(getApiMessage(e));
    } finally {
      setCloneSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleteLoading(true);
      await rolesService.remove(deleteTarget.id);
      const list = await rolesService.list();
      setRoles(list);
      setDeleteTarget(null);
      setRoleId((prev) => {
        if (prev !== deleteTarget.id) return prev;
        return list[0]?.id ?? null;
      });
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Rol eliminado correctamente.' } }),
      );
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: getApiMessage(e) } }),
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className="pt-2 text-center text-slate-600">
        <p>No tienes permiso para ver esta sección.</p>
        <Link to="/dashboard" className="text-emerald-700 underline text-sm mt-2 inline-block">
          Volver al inicio
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-slate-500">
        <i className="fas fa-spinner fa-spin mr-2" /> Cargando roles y permisos…
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-1 max-w-[1400px] mx-auto w-full px-1 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Roles y permisos</h1>
          <p className="text-slate-500 text-sm mt-1 max-w-2xl">
            Administre roles del estudio y la matriz de permisos por módulo. Los cambios en permisos aplican al instante en la API.
          </p>
        </div>
        <Link to="/users" className="text-sm font-medium text-emerald-800 hover:underline shrink-0">
          <i className="fas fa-arrow-left mr-1" /> Volver a usuarios
        </Link>
      </div>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{listError}</div>
      ) : null}

      <div className="flex flex-col lg:flex-row gap-4 lg:items-stretch min-h-[min(70vh,720px)]">
        {/* Panel izquierdo — roles */}
        <aside className="w-full lg:w-auto lg:max-w-[min(100%,20rem)] shrink-0 self-start flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden max-h-[42vh] lg:max-h-none lg:min-h-[520px]">
          <div className="p-3 border-b border-slate-100 bg-slate-50/90 space-y-2 w-full lg:w-max min-w-[12rem]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Roles</span>
              {canManage ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 hover:bg-emerald-800 shadow-sm"
                >
                  <i className="fas fa-plus text-[10px]" /> Nuevo rol
                </button>
              ) : null}
            </div>
            <div className="relative">
              <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre…"
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
              />
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto p-2 space-y-1.5 w-full lg:w-max" aria-label="Lista de roles">
            {filteredRoles.length === 0 ? (
              <p className="text-sm text-slate-500 px-2 py-4 text-center">No hay coincidencias.</p>
            ) : (
              filteredRoles.map((r) => {
                const active = r.id === roleId;
                return (
                  <div
                    key={r.id}
                    className={`rounded-xl border transition-colors ${
                      active
                        ? 'border-emerald-500 bg-emerald-50/60 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => trySelectRole(r.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 text-sm whitespace-nowrap">{r.name}</div>
                        </div>
                        <span className="flex flex-col items-end gap-1 shrink-0">
                          {r.is_default ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                              Predeterminado
                            </span>
                          ) : null}
                          {r.is_system ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              Sistema
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className="text-[10px] font-medium text-slate-600 bg-white/80 border border-slate-200/80 rounded-full px-2 py-0.5">
                          {Number(r.permission_count ?? 0)} perm.
                        </span>
                        <span className="text-[10px] font-medium text-slate-600 bg-white/80 border border-slate-200/80 rounded-full px-2 py-0.5">
                          {Number(r.user_count ?? 0)} usuarios
                        </span>
                      </div>
                    </button>
                    {canManage ? (
                      <div className="flex items-center justify-end gap-1 px-2 pb-2">
                        <button
                          type="button"
                          className={`p-1.5 rounded-lg ${r.is_default ? 'text-emerald-700' : 'text-slate-500 hover:bg-white hover:text-amber-600'}`}
                          title={r.is_default ? 'Rol predeterminado' : 'Marcar como predeterminado'}
                          disabled={Boolean(r.is_default) || defaultSavingId === r.id}
                          onClick={() => void handleSetDefault(r)}
                        >
                          <i className={`fas fa-star text-xs ${defaultSavingId === r.id ? 'opacity-40' : ''}`} />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-slate-800"
                          title="Clonar rol"
                          onClick={() => openClone(r)}
                        >
                          <i className="fas fa-copy text-xs" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-emerald-800"
                          title="Editar rol"
                          onClick={() => openEdit(r)}
                        >
                          <i className="fas fa-pen text-xs" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-red-700 disabled:opacity-40"
                          title={
                            r.is_default
                              ? 'No se puede eliminar el rol predeterminado'
                              : Number(r.user_count ?? 0) > 0
                                ? 'Hay usuarios con este rol'
                                : 'Eliminar rol'
                          }
                          disabled={Boolean(r.is_default) || Number(r.user_count ?? 0) > 0}
                          onClick={() => setDeleteTarget(r)}
                        >
                          <i className="fas fa-trash text-xs" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </nav>
        </aside>

        {/* Panel derecho — permisos */}
        <section className="flex-1 min-w-0 flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {!currentRole ? (
            <div className="p-8 text-center text-slate-500 text-sm">Seleccione un rol de la lista.</div>
          ) : (
            <>
              <header className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 min-w-0">{currentRole.name}</h2>
                    <div className="flex items-center gap-4 shrink-0 text-sm" aria-label="Resumen del rol">
                      <span className="inline-flex items-center gap-1.5 text-slate-600">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Permisos</span>
                        <span className="font-bold text-slate-900 tabular-nums">{selected.size}</span>
                      </span>
                      <span className="h-4 w-px bg-slate-200" aria-hidden />
                      <span className="inline-flex items-center gap-1.5 text-slate-600">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Usuarios</span>
                        <span className="font-bold text-slate-900 tabular-nums">{Number(currentRole.user_count ?? 0)}</span>
                      </span>
                    </div>
                  </div>
                  {currentRole.description ? (
                    <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">{currentRole.description}</p>
                  ) : (
                    <p className="text-sm text-slate-400 italic">Sin descripción.</p>
                  )}
                </div>

                {dirty && canEditPermissions ? (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
                    <span>
                      <i className="fas fa-triangle-exclamation mr-2" />
                      Tiene cambios sin guardar en los permisos.
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleDiscardPermissions}
                        className="px-3 py-1.5 rounded-lg border border-amber-400/60 text-amber-950 text-xs font-semibold hover:bg-amber-100"
                      >
                        Descartar
                      </button>
                      <button
                        type="button"
                        disabled={savingPerms}
                        onClick={() => void handleSavePermissions()}
                        className="px-4 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 disabled:opacity-50"
                      >
                        {savingPerms ? <i className="fas fa-spinner fa-spin mr-1" /> : null}
                        Guardar permisos
                      </button>
                    </div>
                  </div>
                ) : null}
              </header>

              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 relative">
                {permLoading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
                    <span className="text-slate-500 text-sm">
                      <i className="fas fa-spinner fa-spin mr-2" /> Cargando permisos…
                    </span>
                  </div>
                ) : null}

                <div className="space-y-7">
                  {modules.map((mod) => {
                  const perms = mod.permissions ?? [];
                  if (perms.length === 0) return null;
                  const modIds = perms.map((p) => p.id);
                  const selectedInMod = modIds.filter((id) => selected.has(id)).length;
                  const allOn = modIds.length > 0 && selectedInMod === modIds.length;
                  return (
                    <section key={mod.id}>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {mod.name}
                            <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                              {selectedInMod}/{modIds.length}
                            </span>
                          </h3>
                        {canEditPermissions ? (
                          <button
                            type="button"
                            onClick={() => selectAllInModule(mod, !allOn)}
                            className="shrink-0 text-xs text-slate-500 hover:text-emerald-800 transition-colors"
                          >
                            {allOn ? 'Quitar todos' : 'Marcar todos'}
                          </button>
                        ) : null}
                      </div>
                      <ul className="flex flex-wrap gap-2">
                        {perms.map((perm) => {
                          const checked = selected.has(perm.id);
                          const disabled = !canEditPermissions;
                          return (
                            <li key={perm.id} className="min-w-0">
                              <label
                                className={`inline-flex items-center gap-2 max-w-full py-1.5 px-2.5 rounded-lg border text-sm leading-snug transition-colors ${
                                  checked
                                    ? 'border-emerald-200 bg-emerald-50/80 text-slate-900'
                                    : 'border-slate-100 bg-slate-50/40 text-slate-600'
                                } ${disabled ? 'opacity-70 cursor-default' : 'cursor-pointer hover:border-slate-200 hover:bg-slate-50'}`}
                              >
                                <input
                                  type="checkbox"
                                  className="shrink-0 rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={() => togglePerm(perm.id)}
                                />
                                <span className="min-w-0">{permissionDisplayLabel(perm)}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                  })}
                </div>
              </div>

              {/* Barra fija inferior en móvil / sticky en escritorio */}
              {canEditPermissions ? (
                <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
                  <span className="text-xs text-slate-500">
                    {dirty ? 'Cambios pendientes.' : 'Sin cambios pendientes.'}
                  </span>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <button
                      type="button"
                      disabled={!dirty || savingPerms}
                      onClick={handleDiscardPermissions}
                      className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Descartar
                    </button>
                    <button
                      type="button"
                      disabled={!dirty || savingPerms}
                      onClick={() => void handleSavePermissions()}
                      className="px-5 py-2 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-40 shadow-sm"
                    >
                      {savingPerms ? <i className="fas fa-spinner fa-spin mr-2" /> : <i className="fas fa-floppy-disk mr-2" />}
                      Guardar permisos
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <RoleCrudModal
        open={modalMode !== null}
        mode={modalMode}
        role={modalRole}
        saving={modalSaving}
        error={modalError}
        onClose={() => {
          if (!modalSaving) {
            setModalMode(null);
            setModalError('');
          }
        }}
        onCreate={handleModalCreate}
        onUpdate={handleModalUpdate}
      />

      {cloneSource && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
            aria-label="Cerrar"
            onClick={() => !cloneSaving && setCloneSource(null)}
          />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Clonar rol</h2>
            <p className="text-sm text-slate-500">
              Copia los permisos de «{cloneSource.name}» en un rol nuevo.
            </p>
            {cloneError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{cloneError}</div>
            ) : null}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Nombre</label>
                <input
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Descripción</label>
                <textarea
                  value={cloneDesc}
                  onChange={(e) => setCloneDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCloneSource(null)}
                disabled={cloneSaving}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={cloneSaving || !cloneName.trim()}
                onClick={() => void handleConfirmClone()}
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {cloneSaving ? <i className="fas fa-spinner fa-spin mr-2" /> : null}
                Clonar
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Eliminar rol"
        message={
          deleteTarget
            ? Number(deleteTarget.user_count ?? 0) > 0
              ? `El rol «${deleteTarget.name}» tiene ${deleteTarget.user_count} usuario(s). No se puede eliminar hasta reasignarlos.`
              : `¿Eliminar el rol «${deleteTarget.name}»? Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel={deleteTarget && Number(deleteTarget.user_count ?? 0) > 0 ? 'Entendido' : 'Eliminar'}
        danger={!(deleteTarget && Number(deleteTarget.user_count ?? 0) > 0)}
        loading={deleteLoading}
        onClose={() => !deleteLoading && setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && Number(deleteTarget.user_count ?? 0) > 0) {
            setDeleteTarget(null);
            return;
          }
          void handleConfirmDelete();
        }}
      />
    </div>
  );
};

export default RolesAndPermissionsView;
