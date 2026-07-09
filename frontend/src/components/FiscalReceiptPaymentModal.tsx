import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fiscalReceiptsService, type CreatePaymentFromReceiptInput } from '../services/fiscalReceipts';
import { documentsService } from '../services/documents';
import { paymentsService } from '../services/payments';
import { taxSettlementsService } from '../services/taxSettlements';
import type { Document, TaxSettlement, TukifacFiscalReceipt } from '../types/dashboard';
import SearchableSelect from './SearchableSelect';

type Props = {
  receipt: TukifacFiscalReceipt | null;
  onClose: () => void;
  onSuccess: () => void;
};

const FiscalReceiptPaymentModal = ({ receipt, onClose, onSuccess }: Props) => {
  const [allocMode, setAllocMode] = useState<'fifo' | 'manual'>('fifo');
  const [manualLines, setManualLines] = useState<{ document_id: string; amount: string }[]>([
    { document_id: '', amount: '' },
  ]);
  const [openCompanyDocs, setOpenCompanyDocs] = useState<Document[]>([]);
  const [modalDocsLoading, setModalDocsLoading] = useState(false);

  const [payMethod, setPayMethod] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payDescription, setPayDescription] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payAttachmentFile, setPayAttachmentFile] = useState<File | null>(null);
  const [payAttachmentName, setPayAttachmentName] = useState('');
  const [payUploading, setPayUploading] = useState(false);
  const [fiscalPaySaving, setFiscalPaySaving] = useState(false);
  const [modalPaymentError, setModalPaymentError] = useState('');
  const [payTaxSettlementId, setPayTaxSettlementId] = useState('');
  const [settlementsForPay, setSettlementsForPay] = useState<TaxSettlement[]>([]);
  const [settlementsPayLoading, setSettlementsPayLoading] = useState(false);

  const payMethodOptions = useMemo(() => {
    const base = [
      { value: 'Efectivo', label: 'Efectivo' },
      { value: 'Yape', label: 'Yape' },
      { value: 'Plin', label: 'Plin' },
      { value: 'Transferencia', label: 'Transferencia' },
    ];
    const hasCurrent = payMethod.trim() && base.some((o) => o.value === payMethod.trim());
    return [
      { value: '', label: 'Selecciona…' },
      ...(hasCurrent ? [] : payMethod.trim() ? [{ value: payMethod.trim(), label: payMethod.trim() }] : []),
      ...base,
    ];
  }, [payMethod]);

  const payReferencePlaceholder = useMemo(() => {
    const m = payMethod.trim().toLowerCase();
    if (m === 'yape' || m === 'plin') return 'Nº de operación (celular)';
    if (m === 'transferencia') return 'Nº de operación o referencia bancaria';
    return 'Referencia u operación (opcional)';
  }, [payMethod]);

  const fifoPreviewDocs = useMemo(() => {
    return [...openCompanyDocs].sort((a, b) => {
      const da = a.issue_date ?? '';
      const db = b.issue_date ?? '';
      if (da !== db) return da.localeCompare(db);
      return a.id - b.id;
    });
  }, [openCompanyDocs]);

  const resetForm = useCallback(() => {
    setAllocMode('fifo');
    setManualLines([{ document_id: '', amount: '' }]);
    setPayMethod('');
    setPayReference('');
    setPayDescription('');
    setPayNotes('');
    setPayAttachmentFile(null);
    setPayAttachmentName('');
    setPayUploading(false);
    setFiscalPaySaving(false);
    setModalPaymentError('');
    setPayTaxSettlementId('');
  }, []);

  useEffect(() => {
    if (!receipt) {
      resetForm();
      setOpenCompanyDocs([]);
      setSettlementsForPay([]);
      return;
    }
    resetForm();
    setModalDocsLoading(true);
    setSettlementsPayLoading(true);
    setOpenCompanyDocs([]);
    setSettlementsForPay([]);
    void (async () => {
      try {
        const [docs, liq] = await Promise.all([
          documentsService.list({ company_id: String(receipt.company_id) }),
          taxSettlementsService.listPaged({
            company_id: String(receipt.company_id),
            status: 'emitida',
            page: 1,
            per_page: 200,
          }),
        ]);
        setOpenCompanyDocs(docs.filter((d) => d.status === 'pendiente' || d.status === 'parcial'));
        setSettlementsForPay(liq.items);
      } catch {
        setOpenCompanyDocs([]);
        setSettlementsForPay([]);
      } finally {
        setModalDocsLoading(false);
        setSettlementsPayLoading(false);
      }
    })();
  }, [receipt, resetForm]);

  useEffect(() => {
    if (!receipt) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [receipt, onClose]);

  const submitCreatePayment = async () => {
    if (!receipt) return;
    setModalPaymentError('');
    if (!payMethod.trim()) {
      setModalPaymentError('Seleccione el método de pago (igual que en un pago manual desde Deudas).');
      return;
    }
    if (allocMode === 'manual' && openCompanyDocs.length === 0) {
      setModalPaymentError('En modo manual se requieren deudas pendientes para repartir el monto completo del comprobante.');
      return;
    }

    const body: CreatePaymentFromReceiptInput = {
      allocation_mode: allocMode,
      method: payMethod.trim(),
      reference: payReference.trim() || undefined,
      description: payDescription.trim() || undefined,
      notes: payNotes.trim() || undefined,
    };
    if (payTaxSettlementId.trim()) {
      const sid = Number(payTaxSettlementId);
      if (Number.isFinite(sid) && sid > 0) {
        body.tax_settlement_id = sid;
      }
    }
    if (allocMode === 'manual') {
      const allocations = manualLines
        .filter((l) => l.document_id && Number(l.amount) > 0)
        .map((l) => ({ document_id: Number(l.document_id), amount: Number(l.amount) }));
      if (allocations.length === 0) {
        setModalPaymentError('Indique líneas de imputación manual');
        return;
      }
      body.allocations = allocations;
    }

    let attachmentUrl = '';
    if (payAttachmentFile) {
      try {
        setPayUploading(true);
        attachmentUrl = await paymentsService.uploadAttachment(payAttachmentFile);
      } catch {
        setModalPaymentError('No se pudo subir el comprobante. Intente de nuevo.');
        return;
      } finally {
        setPayUploading(false);
      }
    }
    body.attachment = attachmentUrl || undefined;

    try {
      setFiscalPaySaving(true);
      await fiscalReceiptsService.createPayment(receipt.id, body);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Pago registrado y comprobante vinculado.' } }),
      );
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : 'Error al crear pago';
      setModalPaymentError(typeof msg === 'string' ? msg : 'Error al crear pago');
    } finally {
      setFiscalPaySaving(false);
    }
  };

  const canConfirmPayment =
    payMethod.trim() !== '' &&
    !modalDocsLoading &&
    !payUploading &&
    !fiscalPaySaving &&
    (allocMode === 'fifo' || (allocMode === 'manual' && openCompanyDocs.length > 0));

  if (!receipt) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center p-4 sm:p-6 bg-slate-900/50 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200/80 w-full max-w-2xl max-h-[min(92vh,720px)] flex flex-col overflow-hidden"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fiscal-payment-modal-title"
      >
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="fiscal-payment-modal-title" className="text-lg font-semibold text-slate-800 truncate">
              Registrar pago — {receipt.number}
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Monto <span className="font-semibold tabular-nums">S/ {receipt.total.toFixed(2)}</span>
              <span className="text-slate-400"> · </span>
              <span className="break-words">{receipt.company?.business_name ?? receipt.customer_name}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Cerrar"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 ${allocMode === 'manual' ? 'pb-52' : ''}`}>
          {modalPaymentError ? (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{modalPaymentError}</div>
          ) : null}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Datos del pago</p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Registra un pago local por el monto del comprobante e imputa a deudas pendientes (mismo criterio que en Deudas).
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Liquidación (opcional)</label>
              {settlementsPayLoading ? (
                <p className="text-xs text-slate-500 py-2">
                  <i className="fas fa-spinner fa-spin mr-1" />
                  Cargando…
                </p>
              ) : (
                <SearchableSelect
                  value={payTaxSettlementId}
                  onChange={setPayTaxSettlementId}
                  placeholder="Sin vínculo a liquidación"
                  options={[
                    { value: '', label: '— Sin liquidación' },
                    ...settlementsForPay.map((s) => ({
                      value: String(s.id),
                      label: `${s.number || `#${s.id}`} · ${(s.issue_date ?? '').slice(0, 10)}`,
                    })),
                  ]}
                />
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Método de pago</label>
                <SearchableSelect value={payMethod} onChange={setPayMethod} options={payMethodOptions} placeholder="Selecciona…" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Referencia</label>
                <input
                  type="text"
                  value={payReference}
                  onChange={(ev) => setPayReference(ev.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  placeholder={payReferencePlaceholder}
                  autoComplete="off"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Descripción del pago (estado de cuenta)</label>
              <textarea
                value={payDescription}
                onChange={(ev) => setPayDescription(ev.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[72px]"
                placeholder="Concepto visible para el cliente en el estado de cuenta."
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Comprobante / captura</label>
                <input
                  id="fiscal-pay-attachment"
                  type="file"
                  accept="image/*,application/pdf"
                  disabled={payUploading}
                  onChange={(ev) => {
                    const file = ev.target.files?.[0] ?? null;
                    setPayAttachmentFile(file);
                    setPayAttachmentName(file?.name ?? '');
                    ev.currentTarget.value = '';
                  }}
                  className="hidden"
                />
                <label
                  htmlFor="fiscal-pay-attachment"
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition cursor-pointer text-sm ${
                    payUploading
                      ? 'border-slate-200 bg-white opacity-70 cursor-not-allowed'
                      : payAttachmentFile
                        ? 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate text-slate-700">
                    {payUploading ? 'Subiendo…' : payAttachmentName || 'JPG, PNG o PDF'}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-primary-700">Elegir</span>
                </label>
                {payAttachmentFile ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPayAttachmentFile(null);
                      setPayAttachmentName('');
                    }}
                    className="mt-1.5 text-xs text-slate-500 hover:text-slate-800"
                  >
                    Quitar archivo
                  </button>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas internas</label>
                <textarea
                  value={payNotes}
                  onChange={(ev) => setPayNotes(ev.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[88px]"
                  placeholder="Opcional; solo en «ver más» en estado de cuenta."
                />
              </div>
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700 mb-2">Modo de imputación</span>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  className="text-primary-600 border-slate-300 focus:ring-primary-500"
                  checked={allocMode === 'fifo'}
                  onChange={() => setAllocMode('fifo')}
                />
                FIFO (deuda más antigua)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  className="text-primary-600 border-slate-300 focus:ring-primary-500"
                  checked={allocMode === 'manual'}
                  onChange={() => setAllocMode('manual')}
                />
                Manual
              </label>
            </div>
          </div>

          {modalDocsLoading ? (
            <div className="text-sm text-slate-500 py-4 text-center">
              <i className="fas fa-spinner fa-spin mr-2"></i>
              Cargando deudas de la empresa…
            </div>
          ) : allocMode === 'fifo' ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">FIFO (deuda más antigua primero)</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Se registra <strong>un pago por el total del comprobante</strong> (S/ {receipt.total.toFixed(2)}). Si no hay deudas
                pendientes, el importe queda como <strong>pago a cuenta</strong>.
              </p>
              {fifoPreviewDocs.length === 0 ? (
                <p className="text-sm text-sky-900 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2">
                  Sin deudas pendientes: al confirmar, los S/ {receipt.total.toFixed(2)} se registrarán como pago a cuenta.
                </p>
              ) : (
                <ul className="text-sm text-slate-700 space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                  {fifoPreviewDocs.map((d) => (
                    <li
                      key={d.id}
                      className="flex justify-between gap-2 border-b border-slate-200/60 last:border-0 pb-1.5 last:pb-0"
                    >
                      <span className="font-mono text-xs truncate">{d.number}</span>
                      <span className="text-xs text-slate-500 shrink-0">{d.issue_date?.slice(0, 10)}</span>
                      <span className="tabular-nums shrink-0">S/ {d.total_amount.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                La suma de las líneas debe ser exactamente S/ {receipt.total.toFixed(2)} (total del comprobante).
              </p>
              {manualLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <SearchableSelect
                    value={line.document_id}
                    onChange={(v) => {
                      const next = [...manualLines];
                      next[idx] = { ...next[idx], document_id: v };
                      setManualLines(next);
                    }}
                    placeholder="Deuda"
                    options={[
                      { value: '', label: '—' },
                      ...openCompanyDocs.map((d) => ({
                        value: String(d.id),
                        label: `${d.number} (S/ ${d.total_amount.toFixed(2)})`,
                      })),
                    ]}
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Monto"
                    value={line.amount}
                    onChange={(ev) => {
                      const next = [...manualLines];
                      next[idx] = { ...next[idx], amount: ev.target.value };
                      setManualLines(next);
                    }}
                    className="px-3 py-2.5 rounded-lg border border-slate-300 text-sm w-full"
                  />
                </div>
              ))}
              <button
                type="button"
                className="text-xs font-medium text-primary-700 hover:text-primary-800"
                onClick={() => setManualLines([...manualLines, { document_id: '', amount: '' }])}
              >
                + Añadir línea
              </button>
            </div>
          )}
        </div>

        <div className="shrink-0 flex justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canConfirmPayment}
            onClick={() => void submitCreatePayment()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:pointer-events-none"
          >
            {payUploading || fiscalPaySaving ? <i className="fas fa-spinner fa-spin text-xs" aria-hidden /> : null}
            {payUploading ? 'Subiendo…' : fiscalPaySaving ? 'Guardando…' : 'Confirmar pago'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default FiscalReceiptPaymentModal;
