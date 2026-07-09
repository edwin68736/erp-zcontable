import { useCallback, useEffect, useMemo, useState } from 'react';
import { supervisorsService, type SupervisorPeriod } from '../../services/supervisors';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import ConfirmDialog from '../../components/ConfirmDialog';
import Pagination from '../../components/Pagination';

const SupervisorPeriods = () => {
  const canView = useMemo(() => auth.hasPermission(P.supervisorsPeriodsView), []);
  const canCreate = useMemo(() => auth.hasPermission(P.supervisorsPeriodsCreate), []);
  const canUpdate = useMemo(() => auth.hasPermission(P.supervisorsPeriodsUpdate), []);
  const canDelete = useMemo(() => auth.hasPermission(P.supervisorsPeriodsDelete), []);
  const canClose = useMemo(() => auth.hasPermission(P.supervisorsPeriodsClose), []);
  const canBootstrap = useMemo(() => auth.hasPermission(P.supervisorsPeriodsBootstrap), []);

  const [list, setList] = useState<SupervisorPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, per_page: 20, total: 0, total_pages: 0 });
  const [newYm, setNewYm] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [bootstrapOnCreate, setBootstrapOnCreate] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [bootstrapLoadingId, setBootstrapLoadingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [savingNotesId, setSavingNotesId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await supervisorsService.listPeriods(page, 20);
      setList(res.items);
      setPagination(res.pagination);
    } catch {
      setMsg('Error al cargar períodos');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const handleCreate = async () => {
    if (!newYm) return;
    try {
      const { bootstrap } = await supervisorsService.createPeriod(newYm, newNotes, bootstrapOnCreate && canBootstrap);
      setNewYm('');
      setNewNotes('');
      if (bootstrap) {
        setMsg(`Período creado. Controles generados: ${bootstrap.created} (omitidas: ${bootstrap.skipped}).`);
      } else {
        setMsg('');
      }
      void load();
    } catch {
      setMsg('No se pudo crear el período');
    }
  };

  const handleBootstrap = async (periodId: number) => {
    try {
      setBootstrapLoadingId(periodId);
      const r = await supervisorsService.bootstrapPeriodControls(periodId);
      setMsg(`Controles generados: ${r.created}. Ya existían: ${r.skipped}.`);
      void load();
    } catch {
      setMsg('No se pudieron generar los controles masivos');
    } finally {
      setBootstrapLoadingId(null);
    }
  };

  const handleClose = async (id: number) => {
    try {
      await supervisorsService.closePeriod(id);
      void load();
    } catch {
      setMsg('No se pudo cerrar el período (revise controles pendientes)');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await supervisorsService.deletePeriod(deleteId);
      setDeleteId(null);
      void load();
    } catch {
      setMsg('No se pudo eliminar');
    }
  };

  const startEditNotes = (p: SupervisorPeriod) => {
    setEditingId(p.id);
    setEditNotes(p.notes ?? '');
  };

  const cancelEditNotes = () => {
    setEditingId(null);
    setEditNotes('');
  };

  const saveNotes = async (id: number) => {
    try {
      setSavingNotesId(id);
      await supervisorsService.updatePeriod(id, editNotes);
      setEditingId(null);
      setEditNotes('');
      setMsg('Notas actualizadas.');
      void load();
    } catch {
      setMsg('No se pudieron guardar las notas');
    } finally {
      setSavingNotesId(null);
    }
  };

  if (!canView) {
    return <p className="p-6 text-center text-slate-600">Sin permiso para ver períodos.</p>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">Períodos contables</h2>
        <p className="text-sm text-slate-500">Apertura y cierre mensual del módulo supervisores.</p>
      </div>

      {msg ? (
        <p
          className={`text-sm ${msg.startsWith('Período') || msg.includes('generados') || msg.includes('Notas') ? 'text-emerald-700' : 'text-red-600'}`}
        >
          {msg}
        </p>
      ) : null}

      {canCreate ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            Período (YYYY-MM)
            <input
              type="month"
              value={newYm}
              onChange={(e) => setNewYm(e.target.value)}
              className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-full"
            />
          </label>
          <label className="text-sm flex-1 min-w-[200px]">
            Notas
            <input
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-full"
            />
          </label>
          {canBootstrap ? (
            <label className="text-sm flex items-center gap-2 pb-2 w-full">
              <input
                type="checkbox"
                checked={bootstrapOnCreate}
                onChange={(e) => setBootstrapOnCreate(e.target.checked)}
              />
              Generar controles para todas las empresas activas
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium"
          >
            Crear período
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3">Período</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Notas</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-mono">{p.period_ym}</td>
                  <td className="px-4 py-3 capitalize">{p.status}</td>
                  <td className="px-4 py-3 text-slate-600 min-w-[200px]">
                    {editingId === p.id ? (
                      <NotesEditInline
                        value={editNotes}
                        onChange={setEditNotes}
                        onSave={() => void saveNotes(p.id)}
                        onCancel={cancelEditNotes}
                        saving={savingNotesId === p.id}
                      />
                    ) : (
                      <span>{p.notes || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {canUpdate && p.status === 'abierto' && editingId !== p.id ? (
                      <button
                        type="button"
                        onClick={() => startEditNotes(p)}
                        className="text-slate-600 text-xs font-medium"
                      >
                        Editar notas
                      </button>
                    ) : null}
                    {canBootstrap && p.status === 'abierto' ? (
                      <button
                        type="button"
                        disabled={bootstrapLoadingId === p.id}
                        onClick={() => void handleBootstrap(p.id)}
                        className="text-primary-700 text-xs font-medium disabled:opacity-50"
                      >
                        {bootstrapLoadingId === p.id ? 'Generando…' : 'Generar controles'}
                      </button>
                    ) : null}
                    {canClose && p.status === 'abierto' ? (
                      <button
                        type="button"
                        onClick={() => void handleClose(p.id)}
                        className="text-amber-700 text-xs font-medium"
                      >
                        Cerrar
                      </button>
                    ) : null}
                    {canDelete && p.status === 'abierto' ? (
                      <button
                        type="button"
                        onClick={() => setDeleteId(p.id)}
                        className="text-red-600 text-xs font-medium"
                      >
                        Eliminar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={pagination.page}
        perPage={pagination.per_page}
        total={pagination.total}
        onPageChange={(p) => setPage(p)}
        onPerPageChange={() => {}}
      />

      <ConfirmDialog
        open={deleteId != null}
        title="Eliminar período"
        message="¿Eliminar este período? Solo si no tiene controles asociados."
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteId(null)}
      />
    </div>
  );
};

function NotesEditInline({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="text-xs text-primary-700 font-medium disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default SupervisorPeriods;
