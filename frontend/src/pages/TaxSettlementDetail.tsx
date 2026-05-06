import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { saveAs } from 'file-saver';
import { taxSettlementsService } from '../services/taxSettlements';
import { configService } from '../services/config';
import type { TaxSettlement } from '../types/dashboard';
import { auth } from '../services/auth';
import {
  generateTaxSettlementPdfBlob,
  getLogoPngBlobForPdf,
  taxSettlementPdfFilename,
} from '../pdf/taxSettlementDocument';
import ConfirmDialog from '../components/ConfirmDialog';

const TaxSettlementDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const settlementId = Number(id);
  const role = auth.getRole() ?? '';
  const canEmit = ['Administrador', 'Supervisor', 'Contador'].includes(role);

  const [row, setRow] = useState<TaxSettlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [emitting, setEmitting] = useState(false);
  const [emitDialogOpen, setEmitDialogOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (!settlementId) return;
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const data = await taxSettlementsService.get(settlementId);
        if (!cancelled) {
          setRow(data);
          setError('');
        }
      } catch {
        if (!cancelled) {
          setError('No se encontró la liquidación');
          setRow(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settlementId]);

  useEffect(() => {
    if (loading || !row) return;
    if (location.hash !== '#liquidacion-lineas') return;
    const el = document.getElementById('liquidacion-lineas');
    if (el) {
      window.requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [loading, row, location.hash]);

  const performEmit = async () => {
    if (!settlementId) return;
    setEmitting(true);
    try {
      const updated = await taxSettlementsService.emit(settlementId);
      setRow(updated);
      setEmitDialogOpen(false);
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Liquidación emitida.' } }));
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : 'Error al emitir';
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'error', message: typeof msg === 'string' ? msg : 'Error al emitir' } }));
    } finally {
      setEmitting(false);
    }
  };

  const downloadPdf = async () => {
    if (!row || exportingPdf) return;
    try {
      setExportingPdf(true);
      const [firm, fresh] = await Promise.all([
        configService.getFirmBranding().catch(() => null),
        taxSettlementsService.get(settlementId),
      ]);
      const logoPng = firm?.logo_url ? await getLogoPngBlobForPdf(firm.logo_url) : null;
      const blob = await generateTaxSettlementPdfBlob(fresh, firm, logoPng);
      saveAs(blob, taxSettlementPdfFilename(fresh));
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'PDF listo para entregar al cliente.' } }),
      );
    } catch (e) {
      console.error(e);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'No se pudo generar el PDF.' } }),
      );
    } finally {
      setExportingPdf(false);
    }
  };

  const settlementDeleteWarningMessage = () => {
    if (!row) return '';
    const ref = row.number?.trim() ? `«${row.number.trim()}»` : `#${row.id}`;
    const st = row.status === 'emitida' ? 'emitida' : row.status === 'borrador' ? 'borrador' : row.status;
    return `Va a eliminar permanentemente la liquidación ${ref} (estado: ${st}).\n\nEsta acción no se puede deshacer. Se borrarán las líneas de la liquidación en el sistema.\n\n${
      row.status === 'emitida'
        ? 'Si la liquidación estaba emitida, además se revertirán: los pagos registrados «desde esta liquidación» (imputaciones y estados de deuda), la referencia a la liquidación en comprobantes fiscales locales, y las deudas internas generadas solo por esta liquidación (códigos DEU-LIQ…). Las deudas externas que solo se referenciaron en la liquidación (líneas tipo deuda) no se eliminan.\n\nSi alguna deuda interna tiene otros abonos o pagos no vinculados a esta liquidación, el sistema rechazará la operación hasta que los regularice.'
        : 'En borrador no hay pagos ni comprobantes vinculados a liquidación emitida; solo se elimina el borrador y sus líneas.'
    }`;
  };

  const confirmDeleteSettlement = async () => {
    if (!settlementId) return;
    setDeleteLoading(true);
    try {
      await taxSettlementsService.delete(settlementId);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Liquidación eliminada.' } }),
      );
      setDeleteDialogOpen(false);
      navigate('/tax-settlements');
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: {
            type: 'error',
            message: typeof msg === 'string' && msg.trim() ? msg : 'No se pudo eliminar la liquidación.',
          },
        }),
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full min-w-0 max-w-full text-slate-500 text-sm py-12 text-center">
        <i className="fas fa-spinner fa-spin mr-2" />
        Cargando…
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="w-full min-w-0 max-w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error || 'No encontrado'}
        <div className="mt-2">
          <Link to="/tax-settlements" className="text-primary-700 font-medium">
            Volver
          </Link>
        </div>
      </div>
    );
  }

  const lineTypeLabel = (t: string) => {
    if (t === 'document_ref') return 'Deuda';
    return 'Concepto';
  };

  /** Pastillas compactas; ancho al contenido y salto de línea en pantallas estrechas */
  const btnBase =
    'inline-flex w-auto max-w-full shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1.5 text-center text-[11px] font-medium leading-tight transition-colors sm:px-3.5 sm:py-2 sm:text-sm';

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 sm:space-y-6">
      <header className="min-w-0 space-y-4 border-b border-slate-200/80 pb-4">
        <div className="min-w-0 pr-1">
          <Link
            to="/tax-settlements"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            <i className="fas fa-arrow-left text-xs opacity-80" aria-hidden />
            Listado de liquidaciones
          </Link>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-800 sm:text-2xl break-words">
            Liquidación {row.number || `#${row.id}`}
          </h2>
          <p className="mt-2 text-sm text-slate-600 sm:text-base break-words leading-relaxed">
            {row.company ? (
              <>
                <span className="font-mono text-xs text-slate-600 sm:text-sm">{row.company.ruc}</span>
                <span className="mx-1.5 text-slate-300">—</span>
                <span className="font-medium text-slate-800">{row.company.business_name}</span>
              </>
            ) : (
              <span className="text-slate-500">Sin datos de empresa</span>
            )}
            <span className="mx-2 text-slate-300">·</span>
            <span className="text-slate-500">
              {row.status === 'emitida' ? 'Emitida' : row.status === 'borrador' ? 'Borrador' : row.status}
            </span>
          </p>
        </div>

        <nav
          className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:gap-2"
          aria-label="Acciones de la liquidación"
        >
          {row.status === 'borrador' && canEmit ? (
            <button
              type="button"
              onClick={() => setEmitDialogOpen(true)}
              disabled={emitting}
              className={`${btnBase} border-primary-700 bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50`}
            >
              {emitting ? (
                <i className="fas fa-spinner fa-spin text-xs shrink-0" aria-hidden />
              ) : (
                <i className="fas fa-file-signature text-xs shrink-0" aria-hidden />
              )}
              Emitir liquidación
            </button>
          ) : null}
          {row.status === 'emitida' && row.can_register_payment ? (
            <Link
              to={`/payments/new?company_id=${row.company_id}&tax_settlement_id=${row.id}`}
              className={`${btnBase} border-primary-700 bg-primary-600 text-white hover:bg-primary-700 shadow-sm max-sm:max-w-[min(100%,14rem)]`}
            >
              <i className="fas fa-coins text-xs shrink-0" aria-hidden />
              <span className="sm:hidden">Pago desde liquidación</span>
              <span className="hidden sm:inline">Registrar pago (desde liquidación)</span>
            </Link>
          ) : null}
          {row.status === 'emitida' && !row.can_register_payment ? (
            <span
              className={`${btnBase} border-emerald-200 bg-emerald-50 text-emerald-900 cursor-default max-sm:max-w-[min(100%,14rem)]`}
              title="No queda saldo pendiente en las deudas vinculadas a esta liquidación"
            >
              <i className="fas fa-check-double text-xs shrink-0" aria-hidden />
              <span className="sm:hidden">Saldada</span>
              <span className="hidden sm:inline">Liquidación saldada</span>
            </span>
          ) : null}
          <Link
            to={`/payments/new?company_id=${row.company_id}`}
            className={`${btnBase} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}
          >
            <i className="fas fa-hand-holding-usd text-xs shrink-0" aria-hidden />
            {row.status === 'emitida' ? 'Pago sin vínculo' : 'Registrar pago'}
          </Link>
          {row.status === 'emitida' ? (
            <>
              <Link
                to={`/comprobantes?tax_settlement_id=${row.id}`}
                title="Comprobantes de esta liquidación"
                className={`${btnBase} border-primary-200 bg-primary-50/90 text-primary-950 hover:bg-primary-50`}
              >
                <i className="fas fa-file-invoice text-xs shrink-0" aria-hidden />
                Comprobantes
              </Link>
              <Link
                to={`/documents/fiscal-receipts?company_id=${row.company_id}`}
                title="Conciliación — comprobantes pendientes"
                className={`${btnBase} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}
              >
                <i className="fas fa-balance-scale text-xs shrink-0" aria-hidden />
                Conciliación
              </Link>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={exportingPdf}
            className={`${btnBase} border-slate-700 bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50 shadow-sm`}
          >
            <i className={`fas ${exportingPdf ? 'fa-spinner fa-spin' : 'fa-file-pdf'} text-xs shrink-0`} aria-hidden />
            {exportingPdf ? 'Generando PDF…' : 'PDF cliente'}
          </button>
          {canEmit ? (
            <button
              type="button"
              onClick={() => setDeleteDialogOpen(true)}
              className={`${btnBase} border-red-300 bg-white text-red-700 hover:bg-red-50`}
            >
              <i className="fas fa-trash-alt text-xs shrink-0" aria-hidden />
              Eliminar liquidación
            </button>
          ) : null}
        </nav>
      </header>

      <div className="w-full min-w-0 bg-white rounded-xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4 text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <span className="text-xs font-medium text-slate-500">Fecha emisión</span>
            <p className="text-slate-800">{row.issue_date?.slice(0, 10)}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-slate-500">Periodo liquidación (AAAA-MM)</span>
            <p className="text-slate-800 font-mono text-sm">{row.liquidation_period || '—'}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-slate-500">Etiqueta periodo</span>
            <p className="text-slate-800">{row.period_label || '—'}</p>
          </div>
        </div>
        {row.notes ? (
          <div>
            <span className="text-xs font-medium text-slate-500">Notas</span>
            <p className="text-slate-700 whitespace-pre-wrap">{row.notes}</p>
          </div>
        ) : null}
        {row.status === 'emitida' ? (
          <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-100">
            <div>
              <span className="text-xs font-medium text-slate-500">Honorarios / cargos</span>
              <p className="text-lg font-semibold tabular-nums">S/ {row.total_honorarios.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-slate-500">Fiscal (PDT)</span>
              <p className="text-lg font-semibold tabular-nums">S/ {row.total_impuestos.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-slate-500">Total</span>
              <p className="text-lg font-semibold tabular-nums text-primary-800">S/ {row.total_general.toFixed(2)}</p>
            </div>
          </div>
        ) : null}
      </div>

      <section
        id="liquidacion-lineas"
        className="w-full min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden scroll-mt-24"
        aria-labelledby="liquidacion-lineas-titulo"
      >
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
          <h3 id="liquidacion-lineas-titulo" className="text-sm font-semibold text-slate-800">
            Líneas / ítems de la liquidación
          </h3>
        </div>
        <div className="overflow-x-auto">
        <table className="min-w-full w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Concepto</th>
              <th className="px-4 py-3 text-left whitespace-nowrap">Periodo deuda</th>
              <th className="px-4 py-3 text-right">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(row.lines ?? []).map((ln) => (
              <tr key={ln.id ?? `${ln.concept}-${ln.sort_order}`}>
                <td className="px-4 py-3 text-slate-600">{lineTypeLabel(ln.line_type)}</td>
                <td className="px-4 py-3 text-slate-800">{ln.concept}</td>
                <td className="px-4 py-3 text-slate-600 tabular-nums text-xs font-mono">
                  {(ln.period_ym && /^\d{4}-\d{2}$/.test(ln.period_ym)
                    ? ln.period_ym
                    : ln.period_date && ln.period_date.length >= 10
                      ? ln.period_date.slice(0, 10)
                      : row.liquidation_period) || '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">S/ {ln.amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <ConfirmDialog
        open={emitDialogOpen}
        title="Emitir liquidación"
        message={
          row
            ? `El número «${row.number?.trim() || '—'}» ya corresponde a este borrador. Al emitir se fijarán los totales y el estado pasará a emitida. Las líneas de ajuste / impuesto manual generarán las deudas internas (DEU-LIQ…) si aplica. Esta acción no se puede deshacer como borrador.`
            : ''
        }
        confirmLabel="Sí, emitir"
        cancelLabel="Cancelar"
        loading={emitting}
        onClose={() => {
          if (!emitting) setEmitDialogOpen(false);
        }}
        onConfirm={() => void performEmit()}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Advertencia: eliminar liquidación"
        message={row ? settlementDeleteWarningMessage() : ''}
        confirmLabel="Sí, eliminar"
        cancelLabel="Cancelar"
        danger
        loading={deleteLoading}
        onClose={() => {
          if (!deleteLoading) setDeleteDialogOpen(false);
        }}
        onConfirm={() => void confirmDeleteSettlement()}
      />
    </div>
  );
};

export default TaxSettlementDetail;
