import { useState } from 'react';
import type { CompanyRucConflict } from '../services/companies';

const CONFLICT_COPY: Record<'inactiva' | 'eliminada', { title: string; state: (c: CompanyRucConflict) => string }> = {
  inactiva: {
    title: 'Ya existe una empresa inactiva con este RUC',
    state: () => 'Inactiva',
  },
  eliminada: {
    title: 'Este RUC pertenece a una empresa eliminada',
    state: (c) => {
      if (!c.deleted_at) return 'Eliminada';
      const d = new Date(c.deleted_at);
      return Number.isNaN(d.getTime()) ? 'Eliminada' : `Eliminada el ${d.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}`;
    },
  },
};

type Props = {
  conflict: CompanyRucConflict;
  /** Código que se escribió en el formulario: pasa a ser el de la empresa reactivada. */
  initialCode: string;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onReactivate: (code: string) => void;
};

/**
 * Se muestra al crear una empresa cuyo RUC ya existe como empresa inactiva o eliminada: en vez de crear un
 * duplicado se ofrece reactivar la existente (conserva su historial) con los datos del formulario.
 */
const CompanyReactivateModal = ({ conflict, initialCode, saving, error, onCancel, onReactivate }: Props) => {
  const [code, setCode] = useState(initialCode);
  if (conflict.kind === 'activa') return null;
  const copy = CONFLICT_COPY[conflict.kind];
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-900/40" role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h2 className="m-0 text-lg font-semibold text-slate-800">{copy.title}</h2>
        <dl className="m-0 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <dt className="text-slate-500">Razón social</dt>
          <dd className="m-0 font-medium text-slate-800">{conflict.business_name}</dd>
          <dt className="text-slate-500">RUC</dt>
          <dd className="m-0 font-mono text-slate-800">{conflict.ruc}</dd>
          <dt className="text-slate-500">Código anterior</dt>
          <dd className="m-0 font-mono text-slate-800">{conflict.code || '—'}</dd>
          <dt className="text-slate-500">Estado</dt>
          <dd className="m-0 text-slate-800">{copy.state(conflict)}</dd>
        </dl>
        <p className="m-0 text-sm text-slate-600">
          Para no duplicar la empresa, puedes <strong>reactivarla</strong>: se conserva todo su historial (controles, declaraciones,
          documentos) y se actualizan sus datos con lo que escribiste en este formulario.
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Código con el que se reactiva</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary-500"
          />
        </label>
        {error ? <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onReactivate(code.trim())}
            disabled={saving || !code.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Reactivando…' : 'Reactivar y actualizar datos'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

export default CompanyReactivateModal;
