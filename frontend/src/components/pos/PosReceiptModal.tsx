import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { resolveBackendUrl } from '../../api/client';
import type { PosSaleDetail } from '../../services/posSales';
import FiscalReceiptPdfCanvasPreview, {
  printFiscalReceiptCanvasPreview,
} from '../../pdf/FiscalReceiptPdfCanvasPreview';
import {
  buildFiscalReceiptPdfBlob,
  docTypeLabel,
  downloadFiscalReceiptPdf,
  fiscalReceiptPdfFilename,
  type ReceiptPdfFormat,
} from '../../pdf/fiscalReceiptPdf';

type PreviewTab = 'summary' | 'a4' | 'ticket';

type Props = {
  open: boolean;
  receipt: PosSaleDetail | null;
  firm: {
    name?: string;
    ruc?: string;
    address?: string;
    phone?: string;
    email?: string;
    logo_url?: string;
    statement_bank_info?: string;
  };
  onClose: () => void;
  /** post_sale: POS; payment: tras pago con comprobante; history: listado comprobantes/POS. */
  variant?: 'post_sale' | 'payment' | 'history';
};

const PosReceiptModal = ({ open, receipt, firm, onClose, variant = 'history' }: Props) => {
  const [tab, setTab] = useState<PreviewTab>('summary');
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const previewWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setTab('summary');
      setLoadingPreview(false);
      setPreviewBlob(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !receipt || tab === 'summary') {
      setPreviewBlob(null);
      return;
    }
    const format: ReceiptPdfFormat = tab === 'ticket' ? 'ticket' : 'a4';
    let cancelled = false;
    setLoadingPreview(true);
    void buildFiscalReceiptPdfBlob(receipt, firm, format)
      .then((blob) => {
        if (!cancelled) setPreviewBlob(blob);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, receipt, tab, firm]);

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

  if (!open || !receipt) return null;

  const lines = [...(receipt.lines ?? [])].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const showPdfActions = true;
  const downloadName = fiscalReceiptPdfFilename(receipt);

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
        aria-label="Cerrar"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-receipt-title"
        className="relative flex w-full max-w-3xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl max-h-[min(92vh,900px)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">
              {variant === 'post_sale'
                ? 'Venta registrada'
                : variant === 'payment'
                  ? 'Comprobante emitido'
                  : 'Comprobante'}
            </p>
            <h2 id="pos-receipt-title" className="truncate text-lg font-semibold text-slate-900">
              {docTypeLabel(receipt.document_type_id ?? '')} {receipt.number}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {receipt.customer_name} · S/ {Number(receipt.total).toFixed(2)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar modal"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-slate-100 px-4 sm:px-5">
          {(
            [
              { id: 'summary' as const, label: 'Resumen' },
              { id: 'a4' as const, label: 'Vista A4' },
              { id: 'ticket' as const, label: 'Vista ticket' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {tab === 'summary' ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">Fecha</dt>
                  <dd className="font-medium">{(receipt.issue_date ?? '').slice(0, 10)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Cliente</dt>
                  <dd className="font-medium truncate">{receipt.customer_name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">RUC/DNI</dt>
                  <dd className="font-medium">{receipt.customer_number || '—'}</dd>
                </div>
                {(receipt.period_label ?? '').trim() ? (
                  <div>
                    <dt className="text-slate-500">Período</dt>
                    <dd className="font-medium">{receipt.period_label}</dd>
                  </div>
                ) : null}
              </dl>
              {receipt.debt_payment_context ? (
                <div
                  className={`rounded-xl border overflow-hidden ${
                    receipt.debt_payment_context.is_partial_payment
                      ? 'border-sky-200 bg-sky-50'
                      : 'border-emerald-200 bg-emerald-50'
                  }`}
                >
                  <div
                    className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                      receipt.debt_payment_context.is_partial_payment ? 'text-sky-800' : 'text-emerald-800'
                    }`}
                  >
                    {receipt.debt_payment_context.status_label ||
                      (receipt.debt_payment_context.is_partial_payment ? 'PAGO PARCIAL' : 'DEUDA CANCELADA')}
                  </div>
                  <dl className="px-3 py-2 text-sm space-y-1.5">
                    {receipt.debt_payment_context.document_number ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-600">Documento</dt>
                        <dd className="font-mono text-xs font-medium">{receipt.debt_payment_context.document_number}</dd>
                      </div>
                    ) : null}
                    {(receipt.debt_payment_context.paid_concept_label ||
                      (receipt.debt_payment_context.paid_concepts?.length ?? 0) > 0) ? (
                      <div>
                        <dt className="text-slate-600 mb-0.5">Concepto(s) pagado(s)</dt>
                        <dd className="font-medium text-slate-900 leading-snug">
                          {receipt.debt_payment_context.paid_concept_label ||
                            receipt.debt_payment_context.paid_concepts?.join('; ')}
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600">Monto total deuda</dt>
                      <dd className="tabular-nums font-medium">
                        S/ {Number(receipt.debt_payment_context.debt_total).toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600">Pagado (operación)</dt>
                      <dd className="tabular-nums font-medium">
                        S/ {Number(receipt.debt_payment_context.paid_this_operation).toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600">Saldo pendiente</dt>
                      <dd className="tabular-nums font-bold">
                        S/ {Number(receipt.debt_payment_context.balance_pending).toFixed(2)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}
              {(receipt.payments?.length ?? 0) > 0 ? (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">Pagos</div>
                  <ul className="divide-y divide-slate-100 text-sm">
                    {receipt.payments!.map((p) => (
                      <li key={p.id} className="px-3 py-2 flex flex-wrap justify-between gap-2">
                        <span>
                          {p.method}
                          {p.operation_number ? (
                            <span className="text-slate-500 font-normal"> · Op. {p.operation_number}</span>
                          ) : null}
                        </span>
                        <span className="tabular-nums font-medium">S/ {Number(p.amount).toFixed(2)}</span>
                        {p.proof_url ? (
                          <a
                            href={resolveBackendUrl(p.proof_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full text-xs text-primary-700"
                          >
                            Ver comprobante adjunto
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  <span className="text-slate-500">Pago: </span>
                  {receipt.payment_method || '—'}
                </p>
              )}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-3 py-2">Descripción</th>
                      <th className="text-right px-3 py-2">Cant.</th>
                      <th className="text-right px-3 py-2">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((ln) => (
                      <tr key={ln.id}>
                        <td className="px-3 py-2">{ln.description || ln.product_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(ln.quantity).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          S/ {Number(ln.line_total).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end text-sm space-y-1 flex-col items-end">
                <div className="flex justify-between w-44 gap-4">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="tabular-nums">S/ {Number(receipt.subtotal ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between w-44 gap-4">
                  <span className="text-slate-500">IGV</span>
                  <span className="tabular-nums">S/ {Number(receipt.tax_amount ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between w-44 gap-4 font-bold text-primary-800">
                  <span>Total</span>
                  <span className="tabular-nums">S/ {Number(receipt.total).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={previewWrapRef}
              className="rounded-xl border border-slate-200 bg-slate-50 overflow-auto min-h-[280px] max-h-[min(420px,55vh)]"
            >
              {loadingPreview ? (
                <p className="flex h-[320px] items-center justify-center text-sm text-slate-500">
                  <i className="fas fa-spinner fa-spin mr-2" />
                  Generando vista previa…
                </p>
              ) : previewBlob ? (
                <FiscalReceiptPdfCanvasPreview
                  blob={previewBlob}
                  scale={tab === 'ticket' ? 1.15 : 1.35}
                />
              ) : (
                <p className="p-8 text-center text-sm text-slate-500">No se pudo generar la vista previa.</p>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-5 space-y-2">
          {showPdfActions ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await downloadFiscalReceiptPdf(receipt, firm, undefined, 'a4');
                  })
                }
                className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800 hover:bg-primary-100 disabled:opacity-50"
              >
                <i className="fas fa-download text-xs" />
                Descargar A4
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await downloadFiscalReceiptPdf(receipt, firm, undefined, 'ticket');
                  })
                }
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <i className="fas fa-download text-xs" />
                Descargar ticket
              </button>
              <button
                type="button"
                disabled={busy || !previewBlob || tab === 'summary'}
                onClick={() => {
                  if (!printFiscalReceiptCanvasPreview(previewWrapRef.current)) {
                    window.dispatchEvent(
                      new CustomEvent('miweb:toast', {
                        detail: {
                          type: 'error',
                          message:
                            tab === 'summary'
                              ? 'Abra la pestaña Vista A4 o Vista ticket para imprimir'
                              : 'No se pudo abrir la impresión',
                        },
                      }),
                    );
                  }
                }}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title={tab === 'summary' ? 'Seleccione Vista A4 o Vista ticket' : `Imprimir ${downloadName}`}
              >
                <i className="fas fa-print text-xs" />
                Imprimir
              </button>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {variant === 'post_sale' ? (
              <>
                <Link
                  to="/pos/history"
                  onClick={onClose}
                  className="inline-flex justify-center items-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Ver historial
                </Link>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onClose}
                  className="inline-flex justify-center items-center rounded-full bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  Nueva venta
                </button>
              </>
            ) : variant === 'payment' ? (
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="inline-flex justify-center items-center rounded-full bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Ir al listado de pagos
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="inline-flex justify-center items-center rounded-full bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Cerrar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PosReceiptModal;
