import { useEffect } from 'react';
import { createPortal } from 'react-dom';

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().split('?')[0].endsWith('.pdf');
}

type Props = {
  open: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
  onDownload?: () => void;
};

/** Vista previa de PDF o imagen en modal (misma pantalla). */
export default function FilePreviewModal({ open, url, title = 'Archivo', onClose, onDownload }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !url) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar vista previa"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex w-full max-w-4xl max-h-[min(92vh,900px)] flex-col rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
          <div className="min-w-0 text-sm font-semibold text-slate-800 truncate">{title}</div>
          <div className="flex shrink-0 items-center gap-1">
            {onDownload ? (
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <i className="fas fa-download" aria-hidden />
                Descargar
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-slate-100 text-slate-600"
              aria-label="Cerrar"
            >
              <i className="fas fa-times" aria-hidden />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3 bg-slate-50">
          {isPdfUrl(url) ? (
            <iframe title={title} src={url} className="w-full h-[min(70vh,720px)] rounded-lg bg-white border border-slate-200" />
          ) : (
            <img src={url} alt={title} className="mx-auto w-full max-h-[min(70vh,720px)] object-contain rounded-lg bg-white border border-slate-200" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
