import { useEffect, useMemo, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { paymentsService } from '../services/payments';
import {
  ensureTukifacSeriesCached,
  getCachedDocumentSeries,
  getCachedSaleNoteSeries,
  pickDefaultSeries,
} from '../services/tukifacSeriesCache';
import { extractApiErrorMessage } from '../utils/apiError';
import { formatAmount } from '../utils/format';
import { notify } from '../utils/notify';
import type { Payment } from '../types/dashboard';

type Kind = 'sale_note' | 'boleta' | 'factura';

/**
 * Emite el comprobante de un pago que ya existe y no lo tiene: pagos libres (sin liquidación, por ejemplo una deuda
 * liberada al cerrar una liquidación) o pagos cuya emisión falló al registrarlos. Un pago solo puede tener un comprobante:
 * si ya lo tiene, el servidor lo rechaza.
 */
const IssuePaymentReceiptDialog = ({
  payment,
  onClose,
  onIssued,
}: {
  payment: Payment | null;
  onClose: () => void;
  onIssued: () => void;
}) => {
  const [kind, setKind] = useState<Kind>('sale_note');
  const [seriesId, setSeriesId] = useState('');
  const [seriesTick, setSeriesTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const open = payment != null;

  useEffect(() => {
    if (!open) return;
    setError('');
    let cancelled = false;
    void ensureTukifacSeriesCached()
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setSeriesTick((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const rows = useMemo(() => {
    if (kind === 'sale_note') return getCachedSaleNoteSeries();
    const sunat = kind === 'factura' ? '01' : '03';
    return getCachedDocumentSeries().filter((r) => (r.document_type_id ?? '').trim() === sunat);
    // seriesTick fuerza a releer la caché cuando termina de cargar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, seriesTick]);

  useEffect(() => {
    const d = pickDefaultSeries(rows);
    setSeriesId((prev) => (prev && rows.some((r) => String(r.id) === prev) ? prev : d ? String(d.id) : ''));
  }, [rows]);

  const emitir = async () => {
    if (!payment) return;
    const sid = Number(seriesId);
    if (!Number.isFinite(sid) || sid <= 0) {
      setError('Seleccione la serie del comprobante.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const out = await paymentsService.issueComprobanteFromPayment(payment.id, {
        kind,
        series_id: sid,
        payment_method_type_id: '01',
        payment_destination_id: 'cash',
        payment_reference: (payment.method ?? '').trim() || (payment.reference ?? '').trim() || 'Caja',
      });
      notify.success(`Comprobante ${out.receipt.number} emitido`);
      onIssued();
    } catch (e) {
      setError(extractApiErrorMessage(e, 'No se pudo emitir el comprobante'));
    } finally {
      setLoading(false);
    }
  };

  const empresa = payment?.company?.business_name?.trim() || 'la empresa';
  const message = payment
    ? `Se emitirá el comprobante del pago de S/ ${formatAmount(payment.amount)} de ${empresa}. Un pago solo puede tener un comprobante.`
    : '';

  return (
    <ConfirmDialog
      open={open}
      title="Emitir comprobante"
      message={message}
      onClose={onClose}
      onConfirm={() => void emitir()}
      confirmLabel="Emitir comprobante"
      loading={loading}
      confirmDisabled={!seriesId}
    >
      <div className="mt-3 grid grid-cols-1 gap-3 text-left sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Tipo de comprobante
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
          >
            <option value="sale_note">Nota de venta</option>
            <option value="boleta">Boleta</option>
            <option value="factura">Factura</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Serie
          <select
            value={seriesId}
            onChange={(e) => setSeriesId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
          >
            <option value="">Seleccione…</option>
            {rows.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.number}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="mt-3 text-left text-sm text-red-600">{error}</p> : null}
    </ConfirmDialog>
  );
};

export default IssuePaymentReceiptDialog;
