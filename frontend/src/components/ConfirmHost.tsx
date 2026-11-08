import { useEffect, useRef, useState } from 'react';
import { registerConfirmPrompt, type ConfirmOptions } from '../utils/confirmDialog';

/**
 * Diálogo de confirmación único de la aplicación (ver utils/confirmDialog.ts). Se monta una vez en el Layout.
 * Enter confirma, Escape cancela; el foco empieza en «Cancelar» cuando la acción es destructiva.
 */
const ConfirmHost = () => {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      registerConfirmPrompt(
        (o) =>
          new Promise<boolean>((resolve) => {
            // Si llega otra confirmación con una abierta, la anterior se da por cancelada.
            resolver.current?.(false);
            resolver.current = resolve;
            setOpts(o);
          }),
      ),
    [],
  );

  const finish = (ok: boolean) => {
    setOpts(null);
    resolver.current?.(ok);
    resolver.current = null;
  };

  useEffect(() => {
    if (!opts) return;
    (opts.danger ? cancelBtn.current : confirmBtn.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [opts]);

  if (!opts) return null;
  const danger = !!opts.danger;
  return (
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) finish(false);
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-700'}`}>
            <i className={`fas ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}`} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-base font-bold text-slate-800">
              {opts.title ?? (danger ? 'Confirme esta acción' : 'Confirmar')}
            </h2>
            <p id="confirm-message" className="mt-1 whitespace-pre-line text-sm text-slate-600">
              {opts.message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelBtn}
            type="button"
            onClick={() => finish(false)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {opts.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            ref={confirmBtn}
            type="button"
            onClick={() => finish(true)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'}`}
          >
            {opts.confirmLabel ?? (danger ? 'Eliminar' : 'Confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmHost;
