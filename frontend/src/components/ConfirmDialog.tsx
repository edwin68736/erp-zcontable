import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import NotifyIcon from './notify/NotifyIcon';

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
  /** Contenido adicional opcional entre el mensaje y los botones (p. ej. un campo de motivo). */
  children?: ReactNode;
  /** Deshabilita solo el botón de confirmar (p. ej. mientras un campo requerido está vacío). */
  confirmDisabled?: boolean;
};

/**
 * Confirmación controlada por estado (con `loading`, campos extra y botón deshabilitable). Comparte el aspecto de las
 * alertas centradas (components/NotifyHost.tsx); para una pregunta simple use `confirmDialog()` de utils/confirmDialog.
 */
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
  children,
  confirmDisabled = false,
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
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className="notify-pop relative w-full max-w-md rounded-xl bg-white px-6 pb-6 pt-7 text-center shadow-2xl"
      >
        <NotifyIcon kind="question" danger={danger} />
        <h2 id="confirm-dialog-title" className="text-xl font-bold text-slate-800">
          {title}
        </h2>
        <p id="confirm-dialog-desc" className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">
          {message}
        </p>
        {children ? <div className="mt-3 text-left">{children}</div> : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            autoFocus={danger}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading || confirmDisabled}
            onClick={onConfirm}
            autoFocus={!danger}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white disabled:opacity-50 ${
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
