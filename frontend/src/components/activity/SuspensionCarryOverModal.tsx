import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SuspensionCarryOverRow } from '../../services/detracciones';

type SuspensionCarryOverModalProps = {
  open: boolean;
  companies: SuspensionCarryOverRow[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (keepSuspendedCompanyIds: number[]) => void;
};

// Modal de arrastre de suspensión entre períodos (docs/diseno-limpieza-control-detail-2026-09-16.md
// §5.9.9) — al abrir Control de Detracciones de un período con empresas suspendidas el mes anterior
// (y sin resolver todavía), pregunta empresa por empresa qué hacer. Cerrar sin confirmar NO cuenta
// como decisión (§5.9.9.2 punto 3): el caller no debe recordar que se cerró, así que vuelve a
// aparecer la próxima vez que se entre al módulo para este período.
const SuspensionCarryOverModal = ({ open, companies, saving, error, onClose, onConfirm }: SuspensionCarryOverModalProps) => {
  // Por defecto todas tildadas = mantener suspendidas (§5.9.9.2 punto 2).
  const [keep, setKeep] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) setKeep(new Set(companies.map((c) => c.company_id)));
  }, [open, companies]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const toggle = (companyId: number, checked: boolean) => {
    setKeep((prev) => {
      const next = new Set(prev);
      if (checked) next.add(companyId);
      else next.delete(companyId);
      return next;
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar"
        disabled={saving}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suspension-carryover-modal-title"
        className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-4"
      >
        <div>
          <h2 id="suspension-carryover-modal-title" className="text-lg font-semibold text-slate-800">
            Empresas suspendidas del período anterior
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {companies.length === 1
              ? 'Esta empresa estaba marcada como suspendida el período anterior.'
              : `Estas ${companies.length} empresas estaban marcadas como suspendidas el período anterior.`}{' '}
            La suspensión no se arrastra sola de un mes al otro — indique cuáles siguen suspendidas y
            cuáles se reactivan para este período.
          </p>
        </div>

        {error ? (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        ) : null}

        <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {companies.map((c) => (
            <li key={c.company_id}>
              <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={keep.has(c.company_id)}
                  onChange={(e) => toggle(c.company_id, e.target.checked)}
                  className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800 truncate">
                    {c.business_name || '—'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {c.code ? `${c.code} · ` : ''}
                    {c.ruc}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                    keep.has(c.company_id) ? 'bg-purple-100 text-purple-900' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {keep.has(c.company_id) ? 'Mantener suspendida' : 'Reactivar'}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Decidir después
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onConfirm(Array.from(keep))}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SuspensionCarryOverModal;
