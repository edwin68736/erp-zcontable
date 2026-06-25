import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PosSaleDetail } from '../services/posSales';
import { configService } from '../services/config';
import { fiscalReceiptsService } from '../services/fiscalReceipts';
import FiscalReceiptPdfCanvasPreview from '../pdf/FiscalReceiptPdfCanvasPreview';
import {
  buildFiscalReceiptPdfBlob,
  docTypeLabel,
  downloadFiscalReceiptPdf,
  fiscalReceiptPdfFilename,
  printFiscalReceiptPdfBlob,
  type ReceiptPdfFormat,
} from '../pdf/fiscalReceiptPdf';
import type { FirmBranding } from '../pdf/fiscalReceiptPdf';

type Props = {
  open: boolean;
  receiptId: number | null;
  initialFormat?: ReceiptPdfFormat;
  onClose: () => void;
};

const FiscalReceiptPdfViewerModal = ({ open, receiptId, initialFormat = 'a4', onClose }: Props) => {
  const [format, setFormat] = useState<ReceiptPdfFormat>(initialFormat);
  const [receipt, setReceipt] = useState<PosSaleDetail | null>(null);
  const [firm, setFirm] = useState<FirmBranding | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setFormat(initialFormat);
  }, [open, initialFormat]);

  useEffect(() => {
    if (!open || !receiptId) {
      setReceipt(null);
      setFirm(null);
      setError(null);
      setPreviewBlob(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([fiscalReceiptsService.getDetail(receiptId), configService.getFirmBranding()])
      .then(([rec, branding]) => {
        if (cancelled) return;
        setReceipt(rec);
        setFirm(branding);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar el comprobante');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, receiptId]);

  useEffect(() => {
    if (!open || !receipt || !firm) {
      setPreviewBlob(null);
      return;
    }

    let cancelled = false;
    setLoadingPreview(true);
    void buildFiscalReceiptPdfBlob(receipt, firm, format)
      .then((blob) => {
        if (!cancelled) setPreviewBlob(blob);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo generar la vista previa del PDF');
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, receipt, firm, format]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const runAction = async (fn: () => Promise<void>) => {
    try {
      setBusy(true);
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const downloadName = receipt ? fiscalReceiptPdfFilename(receipt) : 'comprobante.pdf';
  const title = receipt
    ? `${docTypeLabel(receipt.document_type_id ?? '')} ${receipt.number}`
    : 'Comprobante';
  const previewScale = format === 'ticket' ? 1.15 : format === 'a5' ? 1.2 : 1.35;

  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
        aria-label="Cerrar"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fiscal-pdf-viewer-title"
        className="relative flex w-full max-w-4xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl max-h-[min(92vh,900px)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">Vista previa PDF</p>
            <h2 id="fiscal-pdf-viewer-title" className="truncate text-lg font-semibold text-slate-900">
              {loading ? 'Cargando…' : title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-slate-100 px-4 sm:px-5">
          {(
            [
              { id: 'a4' as const, label: 'Formato A4' },
              { id: 'a5' as const, label: 'Formato A5' },
              { id: 'ticket' as const, label: 'Ticket 80 mm' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFormat(t.id)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                format === t.id
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
          ) : loading || loadingPreview ? (
            <p className="flex h-[min(420px,55vh)] items-center justify-center text-sm text-slate-500">
              <i className="fas fa-spinner fa-spin mr-2" />
              Generando PDF…
            </p>
          ) : previewBlob ? (
            <div
              ref={previewWrapRef}
              className="rounded-xl border border-slate-200 overflow-auto bg-slate-100 max-h-[min(480px,58vh)]"
            >
              <FiscalReceiptPdfCanvasPreview blob={previewBlob} scale={previewScale} className="min-h-[200px]" />
            </div>
          ) : (
            <p className="text-center text-sm text-slate-500 py-12">Sin vista previa</p>
          )}
        </div>

        <div className="shrink-0 flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={busy || !receipt || !firm}
            onClick={() =>
              void runAction(async () => {
                if (!receipt || !firm) return;
                await downloadFiscalReceiptPdf(receipt, firm, undefined, format);
              })
            }
            className="inline-flex items-center gap-2 rounded-full border border-primary-300 bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <i className="fas fa-download text-xs" />
            Descargar {downloadName}
          </button>
          <button
            type="button"
            disabled={busy || !previewBlob}
            onClick={() => {
              if (!previewBlob || !printFiscalReceiptPdfBlob(previewBlob)) {
                window.dispatchEvent(
                  new CustomEvent('miweb:toast', {
                    detail: { type: 'error', message: 'No se pudo abrir la impresión' },
                  }),
                );
              }
            }}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <i className="fas fa-print text-xs" />
            Imprimir
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default FiscalReceiptPdfViewerModal;
