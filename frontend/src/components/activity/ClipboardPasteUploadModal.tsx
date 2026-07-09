import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { createPortal } from 'react-dom';

type PastedPreview = {
  file: File;
  previewUrl: string | null;
};

type Props = {
  open: boolean;
  title?: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
};

function fileFromClipboardData(data: DataTransfer | null): File | null {
  if (!data) return null;
  const items = data.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

function defaultPastedName(file: File): string {
  const name = file.name?.trim();
  if (name) return name;
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.startsWith('image/') ? 'png' : 'bin';
  return `captura-${Date.now()}.${ext}`;
}

function buildPreview(file: File): PastedPreview {
  const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
  return { file, previewUrl };
}

/** Modal para pegar imagen o PDF desde el portapapeles (Ctrl+V) y subirlo. */
export default function ClipboardPasteUploadModal({
  open,
  title = 'Pegar archivo',
  saving = false,
  onClose,
  onSave,
}: Props) {
  const pasteZoneRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<PastedPreview | null>(null);
  const [error, setError] = useState('');

  const clearPreview = useCallback(() => {
    if (preview?.previewUrl) {
      URL.revokeObjectURL(preview.previewUrl);
    }
    setPreview(null);
  }, [preview]);

  const reset = useCallback(() => {
    clearPreview();
    setError('');
  }, [clearPreview]);

  const handleClose = useCallback(() => {
    if (saving) return;
    reset();
    onClose();
  }, [onClose, reset, saving]);

  const applyFile = useCallback(
    (file: File | null) => {
      if (!file) {
        setError('No se detectó imagen ni archivo. Copie una captura o PDF e intente de nuevo.');
        return;
      }
      const allowed =
        file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!allowed) {
        setError('Solo se admiten imágenes o PDF.');
        return;
      }
      clearPreview();
      setError('');
      setPreview(buildPreview(file));
    },
    [clearPreview],
  );

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = fileFromClipboardData(e.clipboardData);
    applyFile(file);
  };

  const handleSave = async () => {
    if (!preview || saving) return;
    try {
      setError('');
      const normalized =
        preview.file.name?.trim()
          ? preview.file
          : new File([preview.file], defaultPastedName(preview.file), { type: preview.file.type });
      await onSave(normalized);
      reset();
      onClose();
    } catch {
      setError('No se pudo guardar el archivo. Intente de nuevo.');
    }
  };

  useEffect(() => {
    if (!open) return;
    reset();
    const t = window.setTimeout(() => pasteZoneRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset solo al abrir

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, handleClose]);

  useEffect(() => {
    return () => {
      if (preview?.previewUrl) URL.revokeObjectURL(preview.previewUrl);
    };
  }, [preview?.previewUrl]);

  if (!open) return null;

  const isPdf = preview?.file.type === 'application/pdf' || preview?.file.name.toLowerCase().endsWith('.pdf');

  return createPortal(
    <div className="fixed inset-0 z-[10030] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={handleClose}
        disabled={saving}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px] disabled:cursor-not-allowed"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex w-full max-w-lg flex-col rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
          <div className="min-w-0 text-sm font-semibold text-slate-800 truncate">{title}</div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-slate-100 text-slate-600 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div
            ref={pasteZoneRef}
            tabIndex={0}
            onPaste={handlePaste}
            className={`min-h-[12rem] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 p-4 outline-none transition ${
              preview
                ? 'border-primary-200 bg-primary-50/40'
                : 'border-slate-300 bg-slate-50 hover:border-primary-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-200'
            }`}
          >
            {preview ? (
              <>
                {preview.previewUrl ? (
                  <img
                    src={preview.previewUrl}
                    alt="Vista previa"
                    className="max-h-[min(40vh,280px)] max-w-full object-contain rounded-lg border border-slate-200 bg-white"
                  />
                ) : isPdf ? (
                  <div className="flex flex-col items-center gap-2 text-slate-600 py-4">
                    <i className="fas fa-file-pdf text-4xl text-red-600" aria-hidden />
                    <p className="text-sm font-medium text-center break-all px-2">{preview.file.name}</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">{preview.file.name}</p>
                )}
                <p className="text-xs text-slate-500">Puede pegar otra imagen para reemplazar</p>
              </>
            ) : (
              <>
                <i className="fas fa-paste text-2xl text-slate-400" aria-hidden />
                <p className="text-sm font-medium text-slate-700 text-center">Haga clic aquí y pegue (Ctrl+V)</p>
                <p className="text-xs text-slate-500 text-center">Imagen o PDF desde captura de pantalla o portapapeles</p>
              </>
            )}
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50/80">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-slate-700 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!preview || saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <i className="fas fa-spinner fa-spin text-xs" aria-hidden />
                Guardando…
              </>
            ) : (
              <>
                <i className="fas fa-save text-xs" aria-hidden />
                Guardar
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
