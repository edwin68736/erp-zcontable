import { createPortal } from 'react-dom';
import type { Document } from '../types/dashboard';
import DocumentDebtBadge from './DocumentDebtBadge';
import {
  documentBalanceAmount,
  documentPaidAmount,
  formatMoneyPen,
} from '../utils/documentDebtUi';

type Props = {
  open: boolean;
  doc: Document | null;
  onClose: () => void;
};

const DocumentDebtDetailModal = ({ open, doc, onClose }: Props) => {
  if (!open || !doc) return null;

  const paid = documentPaidAmount(doc);
  const balance = documentBalanceAmount(doc);
  const history = doc.payment_history ?? [];

  return createPortal(
    <div className="fixed inset-0 z-[10040] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-label="Cerrar" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[min(90vh,640px)] flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">Detalle de deuda</p>
            <h2 className="text-lg font-semibold text-slate-900 truncate">
              {doc.display_number || doc.number}
            </h2>
            <p className="text-sm text-slate-600 truncate">{doc.company?.business_name ?? '—'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 space-y-4">
          <DocumentDebtBadge doc={doc} />

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Monto total</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{formatMoneyPen(doc.total_amount)}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Pagado</dt>
              <dd className="font-semibold tabular-nums text-emerald-800">{formatMoneyPen(paid)}</dd>
            </div>
            <div className="col-span-2 rounded-lg border border-primary-100 bg-primary-50/60 p-3">
              <dt className="text-xs text-primary-700">Saldo pendiente</dt>
              <dd className="text-lg font-bold tabular-nums text-primary-900">{formatMoneyPen(balance)}</dd>
            </div>
          </dl>

          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Historial de pagos</h3>
            {history.length === 0 ? (
              <p className="text-sm text-slate-500">Sin pagos registrados.</p>
            ) : (
              <>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                  {history.map((h) => (
                    <li key={`${h.payment_id}-${h.date}`} className="px-3 py-2.5 text-sm bg-white">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-700">
                          {(h.date ?? '').slice(0, 10).split('-').reverse().join('/')}
                          {h.method ? ` · ${h.method}` : ''}
                        </span>
                        <span className="font-medium tabular-nums text-slate-900">{formatMoneyPen(h.amount)}</span>
                      </div>
                      {(h.description?.trim() || h.notes?.trim() || h.reference?.trim()) ? (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                          {[h.description?.trim(), h.reference?.trim(), h.notes?.trim()].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex justify-between text-sm border-t border-slate-100 pt-2">
                  <span className="text-slate-600">Total pagado</span>
                  <span className="font-semibold tabular-nums text-emerald-800">{formatMoneyPen(paid)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-100 px-4 py-3 sm:px-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DocumentDebtDetailModal;
