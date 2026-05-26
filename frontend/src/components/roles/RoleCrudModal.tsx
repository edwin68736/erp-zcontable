import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { RoleCreateInput, RoleRow, RoleUpdateInput } from '../../services/roles';

type Mode = 'create' | 'edit' | null;

type Props = {
  open: boolean;
  mode: Mode;
  role: RoleRow | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onCreate: (input: RoleCreateInput) => Promise<void>;
  onUpdate: (id: number, input: RoleUpdateInput) => Promise<void>;
};

const RoleCrudModal = ({ open, mode, role, saving, error, onClose, onCreate, onUpdate }: Props) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    if (mode === 'create') {
      setName('');
      setDescription('');
    } else if (mode === 'edit' && role) {
      setName(role.name);
      setDescription(role.description ?? '');
    }
  }, [open, mode, role]);

  if (!open || !mode) return null;

  const title = mode === 'create' ? 'Nuevo rol' : role?.is_system ? 'Editar rol del sistema' : 'Editar rol';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'create') {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
      });
    } else if (role) {
      await onUpdate(role.id, {
        name: name.trim(),
        description: description.trim(),
      });
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
        aria-label="Cerrar"
        onClick={() => !saving && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-modal-title"
        className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 id="role-modal-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {mode === 'create'
                ? 'Indique el nombre visible del rol. Los permisos se configuran después en la matriz.'
                : 'Actualice el nombre y la descripción. Los permisos se gestionan en el panel derecho.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col flex-1 min-h-0">
          <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            ) : null}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                Nombre <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(ev) => setName(ev.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                placeholder="Ej. Gerente de operaciones"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Descripción</label>
              <textarea
                value={description}
                onChange={(ev) => setDescription(ev.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-y min-h-[88px]"
                placeholder="Uso previsto del rol (opcional)"
              />
            </div>
          </div>

          <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0 bg-slate-50/80 rounded-b-2xl">
            <button
              type="button"
              onClick={() => !saving && onClose()}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-5 py-2 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? <i className="fas fa-spinner fa-spin mr-2" /> : null}
              {mode === 'create' ? 'Crear rol' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};

export default RoleCrudModal;
