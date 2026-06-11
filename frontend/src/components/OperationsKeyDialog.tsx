import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (operationKey: string) => void | Promise<void>;
};

const OperationsKeyDialog = ({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  loading = false,
  onClose,
  onConfirm,
}: Props) => {
  const [key, setKey] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) {
      setKey('');
      setLocalError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  const submit = () => {
    if (!key.trim()) {
      setLocalError('Ingrese la clave de operaciones');
      return;
    }
    setLocalError('');
    void onConfirm(key.trim());
  };

  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
        aria-label="Cerrar"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-2xl p-5 sm:p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {message ? <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">{message}</p> : null}
        <div className="mt-4">
          <label htmlFor="operations-key-input" className="block text-sm font-medium text-slate-700 mb-1">
            Clave de operaciones
          </label>
          <input
            id="operations-key-input"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setLocalError('');
            }}
            disabled={loading}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
            placeholder="Clave configurada en Ajustes → Perfil del estudio"
          />
          {localError ? <p className="mt-1.5 text-xs text-red-600">{localError}</p> : null}
        </div>
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="inline-flex justify-center px-4 py-2.5 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={submit}
            className="inline-flex justify-center items-center gap-2 px-4 py-2.5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? <i className="fas fa-spinner fa-spin text-xs" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default OperationsKeyDialog;
