import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { saveAs } from 'file-saver';
import { taxSettlementsService, type SettlementDebtsContext } from '../services/taxSettlements';
import { configService } from '../services/config';
import type { TaxSettlement } from '../types/dashboard';
import { auth } from '../services/auth';
import { P } from '../rbac/codes';
import {
  generateTaxSettlementPdfBlob,
  getLogoPngBlobForPdf,
  settlementTotalsForPdf,
  taxSettlementPdfFilename,
} from '../pdf/taxSettlementDocument';
import {
  formatMoneyPen,
  stripLegacyMigrationNotes,
} from '../utils/documentDebtUi';
import ConfirmDialog from '../components/ConfirmDialog';
import OperationsKeyDialog from '../components/OperationsKeyDialog';

const TaxSettlementDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const settlementId = Number(id);
  const canEmit = useMemo(() => auth.hasPermission(P.taxSettlementsEmit), []);
  const canUpdate = useMemo(() => auth.hasPermission(P.taxSettlementsUpdate), []);
  const canDelete = useMemo(() => auth.hasPermission(P.taxSettlementsDelete), []);

  const [row, setRow] = useState<TaxSettlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [emitting, setEmitting] = useState(false);
  const [emitDialogOpen, setEmitDialogOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteKeyOpen, setDeleteKeyOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editKeyOpen, setEditKeyOpen] = useState(false);
  const [editKeyLoading, setEditKeyLoading] = useState(false);
  const [debtsCtx, setDebtsCtx] = useState<SettlementDebtsContext | null>(null);
  const [linkingDebtId, setLinkingDebtId] = useState<number | null>(null);

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
    if (!settlementId) return;
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await taxSettlementsService.debtsContext(settlementId);
        if (!cancelled) setDebtsCtx(ctx);
      } catch {
        if (!cancelled) setDebtsCtx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settlementId, row?.status]);

  const reloadDebtsContext = async () => {
    if (!settlementId) return;
    try {
      const ctx = await taxSettlementsService.debtsContext(settlementId);
      setDebtsCtx(ctx);
    } catch {
      setDebtsCtx(null);
    }
  };

  const handleLinkUnlinkedDebt = async (documentId: number) => {
    if (!settlementId || row?.status !== 'borrador') return;
    setLinkingDebtId(documentId);
    try {
      const updated = await taxSettlementsService.linkDebt(settlementId, documentId);
      setRow(updated);
      await reloadDebtsContext();
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Deuda agregada a la liquidación.' } }),
      );
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : 'No se pudo vincular la deuda';
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: typeof msg === 'string' ? msg : 'Error' } }),
      );
    } finally {
      setLinkingDebtId(null);
    }
  };

  const settlementTotals = useMemo(() => {
    if (!row) return null;
    const t = settlementTotalsForPdf(row);
    return {
      honorarios: t.honorarios,
      impuestos: t.impuestos,
      total: t.total,
    };
  }, [row]);

  const lineBreakdown = useMemo(() => {
    let subDeudas = 0;
    let subManual = 0;
    for (const ln of row?.lines ?? []) {
      const amount = Number(ln.amount) || 0;
      if (ln.line_type === 'document_ref') subDeudas += amount;
      else subManual += amount;
    }
    return { subDeudas, subManual, total: subDeudas + subManual };
  }, [row?.lines]);

  const linkedDebtsTotal = useMemo(
    () => (debtsCtx?.linked ?? []).reduce((sum, d) => sum + (Number(d.balance_amount) || 0), 0),
    [debtsCtx?.linked],
  );

  const unlinkedDebtsTotal = useMemo(
    () => (debtsCtx?.unlinked ?? []).reduce((sum, d) => sum + (Number(d.balance_amount) || 0), 0),
    [debtsCtx?.unlinked],
  );

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

  const settlementStatusLabel = (s: string) => {
    if (s === 'emitida') return 'Emitida';
    if (s === 'borrador') return 'Borrador';
    if (s === 'cerrada') return 'Cerrada';
    if (s === 'anulada') return 'Anulada';
    return s;
  };

  const performClose = async () => {
    if (!settlementId) return;
    setClosing(true);
    try {
      const updated = await taxSettlementsService.close(settlementId);
      setRow(updated);
      setCloseDialogOpen(false);
      await reloadDebtsContext();
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: {
            type: 'success',
            message: 'Liquidación cerrada. Quedó como registro histórico; las deudas pendientes pueden incorporarse a una nueva liquidación.',
          },
        }),
      );
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : 'Error al cerrar';
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: typeof msg === 'string' ? msg : 'Error al cerrar' } }),
      );
    } finally {
      setClosing(false);
    }
  };

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

  const confirmDeleteSettlement = async (operationKey: string) => {
    if (!settlementId) return;
    setDeleteLoading(true);
    try {
      await taxSettlementsService.delete(settlementId, operationKey);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Liquidación eliminada.' } }),
      );
      setDeleteKeyOpen(false);
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

  const confirmEditSettlement = async (operationKey: string) => {
    if (!settlementId) return;
    setEditKeyLoading(true);
    try {
      await taxSettlementsService.revertToDraft(settlementId, operationKey);
      setEditKeyOpen(false);
      navigate(`/tax-settlements/${settlementId}/edit`);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: {
            type: 'error',
            message: typeof msg === 'string' && msg.trim() ? msg : 'No se pudo preparar la edición.',
          },
        }),
      );
    } finally {
      setEditKeyLoading(false);
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
    if (t === 'tax_manual') return 'Servicio';
    if (t === 'adjust') return 'Detalle';
    return 'Detalle';
  };

  const formatDebtPeriod = (d: { has_period?: boolean; period_month?: number; period_year?: number; accounting_period?: string }) => {
    if (d.has_period && d.period_month != null && d.period_year != null) {
      return `${String(d.period_month).padStart(2, '0')}/${d.period_year}`;
    }
    const raw = (d.accounting_period ?? '').trim();
    if (/^\d{4}-\d{2}$/.test(raw)) return `${raw.slice(5, 7)}/${raw.slice(0, 4)}`;
    return raw || '—';
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
            <span className="text-slate-500">{settlementStatusLabel(row.status)}</span>
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
          {row.status === 'emitida' && canUpdate ? (
            <button
              type="button"
              onClick={() => setCloseDialogOpen(true)}
              disabled={closing}
              className={`${btnBase} border-slate-500 bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50`}
            >
              {closing ? (
                <i className="fas fa-spinner fa-spin text-xs shrink-0" aria-hidden />
              ) : (
                <i className="fas fa-lock text-xs shrink-0" aria-hidden />
              )}
              Cerrar liquidación
            </button>
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
                to={`/comprobantes?status=pendiente_vincular&company_id=${row.company_id}`}
                title="Comprobantes pendientes de vincular"
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
          {canUpdate && row.status !== 'cerrada' ? (
            <button
              type="button"
              onClick={() => setEditKeyOpen(true)}
              className={`${btnBase} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}
            >
              <i className="fas fa-pen text-xs shrink-0" aria-hidden />
              Editar
            </button>
          ) : null}
          {canDelete && row.status !== 'cerrada' ? (
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
        {row.status === 'cerrada' ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <i className="fas fa-lock text-slate-500 mr-2" aria-hidden />
            Liquidación cerrada
            {row.closed_at ? ` el ${row.closed_at.slice(0, 10)}` : ''}. Registro histórico: no se puede editar ni eliminar. Las deudas muestran el estado al momento del cierre.
          </div>
        ) : null}
        {settlementTotals && ((row.lines?.length ?? 0) > 0 || row.status === 'emitida' || row.status === 'cerrada') ? (
          <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-100">
            <div>
              <span className="text-xs font-medium text-slate-500">Honorarios / cargos</span>
              <p className="text-lg font-semibold tabular-nums">S/ {settlementTotals.honorarios.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-slate-500">Fiscal (PDT)</span>
              <p className="text-lg font-semibold tabular-nums">S/ {settlementTotals.impuestos.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-slate-500">Total</span>
              <p className="text-lg font-semibold tabular-nums text-primary-800">S/ {settlementTotals.total.toFixed(2)}</p>
            </div>
          </div>
        ) : null}
      </div>

      {debtsCtx ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
              <h3 className="text-sm font-semibold text-slate-800">
                Deudas vinculadas{row.status === 'cerrada' ? ' (histórico al cierre)' : ''}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Deuda</th>
                    <th className="px-3 py-2 text-left">Periodo</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {debtsCtx.linked.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-slate-500 text-center">
                        Sin deudas vinculadas aún.
                      </td>
                    </tr>
                  ) : (
                    debtsCtx.linked.map((d) => (
                      <tr key={d.document_id}>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-slate-500">{d.number}</span>
                          <p className="text-slate-800 truncate max-w-[14rem]">
                            {stripLegacyMigrationNotes(d.description || '') || '—'}
                          </p>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-xs">{formatDebtPeriod(d)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoneyPen(d.balance_amount)}</td>
                        <td className="px-3 py-2 capitalize text-slate-600">
                          {d.status}
                          {d.historical_view ? (
                            <span className="ml-1 text-[10px] uppercase text-slate-400">(cierre)</span>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {debtsCtx.linked.length > 0 ? (
                  <tfoot className="border-t border-slate-200 bg-slate-50/90">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide">
                        Total saldo vinculado
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                        {formatMoneyPen(linkedDebtsTotal)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>

          {row.status !== 'cerrada' ? (
          <section className="bg-white rounded-xl border border-amber-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/80">
              <h3 className="text-sm font-semibold text-amber-950">Deudas pendientes no vinculadas</h3>
              {(debtsCtx.pending_from_previous_count ?? 0) > 0 ? (
                <p className="text-xs text-amber-900 mt-1">
                  Hay {debtsCtx.pending_from_previous_count} deuda(s) pendiente(s) de liquidaciones cerradas anteriores. Incorpórelas manualmente si corresponde.
                </p>
              ) : debtsCtx.unlinked.length > 0 ? (
                <p className="text-xs text-amber-900 mt-1">Existen deudas pendientes no incluidas en esta liquidación.</p>
              ) : null}
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Deuda</th>
                    <th className="px-3 py-2 text-left">Periodo</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    {row.status === 'borrador' && canUpdate ? (
                      <th className="px-3 py-2 text-right">Acción</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {debtsCtx.unlinked.length === 0 ? (
                    <tr>
                      <td colSpan={row.status === 'borrador' && canUpdate ? 4 : 3} className="px-3 py-4 text-slate-500 text-center">
                        No hay deudas abiertas sin vincular.
                      </td>
                    </tr>
                  ) : (
                    debtsCtx.unlinked.map((d) => (
                      <tr key={d.document_id}>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-slate-500">{d.number}</span>
                          <p className="text-slate-800 truncate max-w-[12rem]">
                            {stripLegacyMigrationNotes(d.description || '') || '—'}
                          </p>
                          {d.from_previous_settlement && d.source_settlement_number ? (
                            <p className="text-[10px] text-amber-800 mt-0.5">
                              De liquidación {d.source_settlement_number}
                              {d.source_settlement_period ? ` (${d.source_settlement_period})` : ''}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-xs">{formatDebtPeriod(d)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoneyPen(d.balance_amount)}</td>
                        {row.status === 'borrador' && canUpdate ? (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              disabled={linkingDebtId === d.document_id}
                              onClick={() => void handleLinkUnlinkedDebt(d.document_id)}
                              className="text-xs font-medium text-primary-700 hover:text-primary-900 disabled:opacity-50"
                            >
                              {linkingDebtId === d.document_id ? '…' : 'Agregar'}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
                {debtsCtx.unlinked.length > 0 ? (
                  <tfoot className="border-t border-amber-200 bg-amber-50/80">
                    <tr>
                      <td
                        colSpan={2}
                        className="px-3 py-2 text-right text-xs font-semibold text-amber-950 uppercase tracking-wide"
                      >
                        Total saldo pendiente
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-950">
                        {formatMoneyPen(unlinkedDebtsTotal)}
                      </td>
                      {row.status === 'borrador' && canUpdate ? <td /> : null}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>
          ) : null}
        </div>
      ) : null}

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
            {(row.lines ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Sin líneas en esta liquidación.
                </td>
              </tr>
            ) : (
              (row.lines ?? []).map((ln) => (
                <tr key={ln.id ?? `${ln.concept}-${ln.sort_order}`}>
                  <td className="px-4 py-3 text-slate-600">{lineTypeLabel(ln.line_type)}</td>
                  <td className="px-4 py-3 text-slate-800">{stripLegacyMigrationNotes(ln.concept || '') || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums text-xs font-mono">
                    {(() => {
                      const p = (ln.period_ym ?? '').trim();
                      if (p) return p;
                      if (ln.period_date && ln.period_date.length >= 10) return ln.period_date.slice(0, 10);
                      return row.liquidation_period || '—';
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">S/ {Number(ln.amount).toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
          {(row.lines?.length ?? 0) > 0 ? (
            <tfoot className="border-t border-slate-200 bg-slate-50/90 text-sm">
              {lineBreakdown.subDeudas > 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-slate-600">
                    Subtotal deudas cargadas
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-800">
                    S/ {lineBreakdown.subDeudas.toFixed(2)}
                  </td>
                </tr>
              ) : null}
              {lineBreakdown.subManual > 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-slate-600">
                    Subtotal conceptos / servicios
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-800">
                    S/ {lineBreakdown.subManual.toFixed(2)}
                  </td>
                </tr>
              ) : null}
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Total líneas
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-base font-bold text-primary-800">
                  S/ {lineBreakdown.total.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
        </div>
      </section>

      <ConfirmDialog
        open={emitDialogOpen}
        title="Emitir liquidación"
        message={
          row
            ? `El número «${row.number?.trim() || '—'}» ya corresponde a este borrador. Al emitir se fijarán los totales y el estado pasará a emitida. Las deudas de la liquidación quedarán confirmadas (sin duplicar documentos). Esta acción no se puede deshacer como borrador.`
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
        open={closeDialogOpen}
        title="Cerrar liquidación"
        message={
          row
            ? `¿Cerrar la liquidación «${row.number?.trim() || '—'}»? Quedará como registro histórico inmutable. Se conservará el estado de cada deuda al momento del cierre. Las deudas con saldo pendiente podrán incorporarse manualmente a una nueva liquidación.`
            : ''
        }
        confirmLabel="Sí, cerrar"
        cancelLabel="Cancelar"
        loading={closing}
        onClose={() => {
          if (!closing) setCloseDialogOpen(false);
        }}
        onConfirm={() => void performClose()}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Advertencia: eliminar liquidación"
        message={row ? settlementDeleteWarningMessage() : ''}
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        danger
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => {
          setDeleteDialogOpen(false);
          setDeleteKeyOpen(true);
        }}
      />

      <OperationsKeyDialog
        open={deleteKeyOpen}
        title="Clave de operaciones"
        message="Confirme la clave para eliminar esta liquidación."
        confirmLabel="Eliminar"
        loading={deleteLoading}
        onClose={() => {
          if (!deleteLoading) setDeleteKeyOpen(false);
        }}
        onConfirm={(key) => void confirmDeleteSettlement(key)}
      />

      <OperationsKeyDialog
        open={editKeyOpen}
        title="Editar liquidación"
        message={
          row?.status === 'emitida'
            ? 'Se revertirán pagos, comprobantes vinculados y deudas internas DEU-LIQ antes de abrir el editor.'
            : 'Confirme la clave para abrir el editor.'
        }
        confirmLabel="Continuar"
        loading={editKeyLoading}
        onClose={() => {
          if (!editKeyLoading) setEditKeyOpen(false);
        }}
        onConfirm={(key) => void confirmEditSettlement(key)}
      />
    </div>
  );
};

export default TaxSettlementDetail;
