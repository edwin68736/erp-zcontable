import { useEffect } from 'react';
import { createPortal } from 'react-dom';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Texto principal; si está vacío y `open`, no se renderiza contenido útil (el padre debe controlar el mensaje). */
  message: string;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estilo del botón principal (p. ej. eliminar). */
  danger?: boolean;
  /** Deshabilita botones (p. ej. mientras corre la petición). */
  loading?: boolean;
};

const ConfirmDialog = ({
  open,
  title,
  message,
  onClose,
  onConfirm,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  loading = false,
}: ConfirmDialogProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
        aria-label="Cerrar diálogo"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col"
      >
        <div className="px-4 py-4 sm:px-5 sm:py-5 border-b border-slate-100">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          <p
            id="confirm-dialog-desc"
            className="mt-2 text-sm text-slate-600 leading-relaxed whitespace-pre-line"
          >
            {message}
          </p>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-4 py-3 sm:px-5 sm:py-4 bg-slate-50/80 rounded-b-2xl sm:rounded-b-2xl">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="inline-flex justify-center items-center px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`inline-flex justify-center items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-sm disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
            }`}
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

export default ConfirmDialog;
