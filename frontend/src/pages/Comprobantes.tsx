import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fiscalReceiptsService } from '../services/fiscalReceipts';
import { companiesService } from '../services/companies';
import { taxSettlementsService } from '../services/taxSettlements';
import type { Company, TaxSettlement, TukifacFiscalReceipt } from '../types/dashboard';
import { auth } from '../services/auth';
import { P } from '../rbac/codes';
import SearchableSelect from '../components/SearchableSelect';
import Pagination from '../components/Pagination';
import FiscalReceiptPdfActions from '../components/FiscalReceiptPdfActions';
import FiscalReceiptPaymentModal from '../components/FiscalReceiptPaymentModal';
import { isLocalFiscalReceipt } from '../utils/fiscalReceiptLocal';

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i <= 0) return fallback;
  return i;
}

function formatIssueDate(iso: string): string {
  if (!iso) return '—';
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function formatEmissionDate(r: TukifacFiscalReceipt): string {
  const fromPayment = r.linked_payment?.created_at?.trim();
  const iso = fromPayment || r.issue_date;
  if (!iso) return '—';
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function settlementBadgeClass(status: string | undefined): string {
  switch (status) {
    case 'vinculado':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'pendiente':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'descartado':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

const Comprobantes = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCompanyId = searchParams.get('company_id') ?? '';
  const initialTaxSettlementId = searchParams.get('tax_settlement_id') ?? '';
  const initialStatus = searchParams.get('status') ?? '';
  const initialOrigin = searchParams.get('origin') ?? '';
  const initialRuc = searchParams.get('ruc') ?? '';
  const initialNumber = searchParams.get('number') ?? '';
  const initialNeeds = searchParams.get('needs_settlement') === '1';
  const initialPage = parsePositiveInt(searchParams.get('page'), 1);
  const initialPerPage = parsePositiveInt(searchParams.get('per_page'), 25);

  const canView = auth.hasPermission(P.fiscalReceiptsList);
  const canLinkSettlement = auth.hasPermission(P.tukifacFiscalPatchTax);
  const canCreatePayment = auth.hasPermission(P.tukifacFiscalCreatePayment);
  const canDiscard = auth.hasPermission(P.tukifacFiscalDiscard);
  const isPendingView = initialStatus === 'pendiente_vincular';

  const [list, setList] = useState<TukifacFiscalReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [pagination, setPagination] = useState({
    page: initialPage,
    per_page: initialPerPage,
    total: 0,
    total_pages: 0,
  });

  const [filterCompanyId, setFilterCompanyId] = useState(initialCompanyId);
  const [filterTaxSettlementId, setFilterTaxSettlementId] = useState(initialTaxSettlementId);
  const [filterStatus, setFilterStatus] = useState(initialStatus);
  const [filterOrigin, setFilterOrigin] = useState(initialOrigin);
  const [filterNeedsSettlement, setFilterNeedsSettlement] = useState(initialNeeds);
  const [filterRuc, setFilterRuc] = useState(initialRuc);
  const [filterNumber, setFilterNumber] = useState(initialNumber);

  const [paymentReceipt, setPaymentReceipt] = useState<TukifacFiscalReceipt | null>(null);
  const [linkModal, setLinkModal] = useState<TukifacFiscalReceipt | null>(null);
  const [linkSelect, setLinkSelect] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [settlementsOptions, setSettlementsOptions] = useState<TaxSettlement[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);

  const filterKey = useMemo(
    () =>
      [
        filterCompanyId,
        filterTaxSettlementId.trim(),
        filterStatus,
        filterOrigin,
        filterNeedsSettlement ? '1' : '',
        filterRuc.trim(),
        filterNumber.trim(),
      ].join('\0'),
    [
      filterCompanyId,
      filterTaxSettlementId,
      filterStatus,
      filterOrigin,
      filterNeedsSettlement,
      filterRuc,
      filterNumber,
    ],
  );
  const lastFilterKeyRef = useRef<string | null>(null);

  useEffect(() => {
    void companiesService.list().then(setCompanies).catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    setFilterCompanyId(initialCompanyId);
    setFilterTaxSettlementId(initialTaxSettlementId);
    setFilterStatus(initialStatus);
    setFilterOrigin(initialOrigin);
    setFilterNeedsSettlement(initialNeeds);
    setFilterRuc(initialRuc);
    setFilterNumber(initialNumber);
  }, [initialCompanyId, initialTaxSettlementId, initialStatus, initialOrigin, initialNeeds, initialRuc, initialNumber]);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fiscalReceiptsService.listPaged({
        status: initialStatus || undefined,
        origin: initialOrigin || undefined,
        company_id: initialCompanyId || undefined,
        tax_settlement_id: initialTaxSettlementId || undefined,
        needs_settlement: initialNeeds || undefined,
        ruc: initialRuc.trim() || undefined,
        number: initialNumber.trim() || undefined,
        page: initialPage,
        per_page: initialPerPage,
      });
      setList(res.items);
      setPagination(res.pagination);
    } catch (e) {
      console.error(e);
      setError('Error al cargar comprobantes');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [
    initialCompanyId,
    initialNeeds,
    initialNumber,
    initialOrigin,
    initialPage,
    initialPerPage,
    initialRuc,
    initialStatus,
    initialTaxSettlementId,
  ]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const prevFilterKey = lastFilterKeyRef.current;
      const filtersJustChanged = prevFilterKey !== null && prevFilterKey !== filterKey;

      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const setOrDel = (k: string, v: string) => {
          if (v) next.set(k, v);
          else next.delete(k);
        };
        setOrDel('company_id', filterCompanyId);
        setOrDel('tax_settlement_id', filterTaxSettlementId.trim());
        setOrDel('status', filterStatus);
        setOrDel('origin', filterOrigin);
        setOrDel('ruc', filterRuc.trim());
        setOrDel('number', filterNumber.trim());
        if (filterNeedsSettlement) next.set('needs_settlement', '1');
        else next.delete('needs_settlement');
        if (filtersJustChanged) {
          next.set('page', '1');
        } else {
          const p = prev.get('page');
          next.set('page', p && /^[1-9]\d*$/.test(p) ? p : '1');
        }
        if (!next.get('per_page')) next.set('per_page', String(initialPerPage));
        if (next.toString() === prev.toString()) return prev;
        return next;
      }, { replace: true });

      lastFilterKeyRef.current = filterKey;
    }, 350);
    return () => window.clearTimeout(t);
  }, [filterKey, filterCompanyId, filterNeedsSettlement, filterOrigin, filterNumber, filterRuc, filterStatus, filterTaxSettlementId, initialPerPage, setSearchParams]);

  const applyStatusPreset = (status: string) => {
    setFilterStatus(status);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (status) next.set('status', status);
      else next.delete('status');
      next.set('page', '1');
      return next;
    }, { replace: true });
  };

  const handlePageChange = (nextPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      if (!next.get('per_page')) next.set('per_page', String(initialPerPage));
      return next;
    });
  };

  const handlePerPageChange = (nextPerPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('per_page', String(nextPerPage));
      next.set('page', '1');
      return next;
    });
  };

  const canRegisterPayment = (r: TukifacFiscalReceipt) =>
    canCreatePayment && r.reconciliation_status === 'pendiente_vincular';

  const discardReceipt = async (id: number) => {
    if (!canDiscard) return;
    if (!confirm('¿Descartar este comprobante? No se registrará pago.')) return;
    try {
      await fiscalReceiptsService.discard(id);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Comprobante descartado.' } }),
      );
      void fetchList();
    } catch {
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'No se pudo descartar el comprobante.' } }),
      );
    }
  };

  /** Comprobantes emitidos desde pago de liquidación ya quedan vinculados; solo manual si falta liquidación efectiva. */
  const canManualLinkSettlement = (r: TukifacFiscalReceipt) =>
    canLinkSettlement &&
    r.reconciliation_status !== 'descartado' &&
    r.reconciliation_status !== 'vinculado' &&
    (r.settlement_link_status ?? 'pendiente') !== 'vinculado';

  const openLinkModal = async (r: TukifacFiscalReceipt) => {
    if (!canManualLinkSettlement(r)) return;
    setLinkModal(r);
    setLinkSelect(
      r.effective_tax_settlement_id != null
        ? String(r.effective_tax_settlement_id)
        : r.tax_settlement_id != null
          ? String(r.tax_settlement_id)
          : '',
    );
    setLinkError('');
    setSettlementsLoading(true);
    setSettlementsOptions([]);
    try {
      const res = await taxSettlementsService.listPaged({
        company_id: String(r.company_id),
        status: 'emitida',
        page: 1,
        per_page: 200,
      });
      setSettlementsOptions(res.items);
    } catch {
      setSettlementsOptions([]);
    } finally {
      setSettlementsLoading(false);
    }
  };

  const submitLink = async () => {
    if (!linkModal) return;
    setLinkError('');
    setLinkSaving(true);
    try {
      if (!linkSelect) {
        await fiscalReceiptsService.patchTaxSettlement(linkModal.id, { unlink: true });
        window.dispatchEvent(
          new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Vínculo con liquidación quitado.' } }),
        );
      } else {
        const sid = Number(linkSelect);
        if (!Number.isFinite(sid) || sid <= 0) {
          setLinkError('Seleccione una liquidación emitida.');
          return;
        }
        await fiscalReceiptsService.patchTaxSettlement(linkModal.id, { tax_settlement_id: sid });
        window.dispatchEvent(
          new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Comprobante vinculado a la liquidación.' } }),
        );
      }
      setLinkModal(null);
      void fetchList();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : 'Error al guardar';
      setLinkError(typeof msg === 'string' ? msg : 'Error al guardar');
    } finally {
      setLinkSaving(false);
    }
  };

  const statusOptions = useMemo(
    () => [
      { value: '', label: 'Todos (conciliación)' },
      { value: 'pendiente_vincular', label: 'Pendiente de conciliación' },
      { value: 'vinculado', label: 'Vinculado a pago' },
      { value: 'descartado', label: 'Descartado' },
    ],
    [],
  );

  const originOptions = useMemo(
    () => [
      { value: '', label: 'Todos los orígenes' },
      { value: 'issued_local', label: 'Pagos / liquidación' },
      { value: 'pos_sale', label: 'POS' },
      { value: 'tukifac_sync', label: 'Importado (histórico)' },
    ],
    [],
  );

  if (!canView) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        No tienes permisos para ver esta pantalla.
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      <header className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-800">Comprobantes</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-relaxed max-w-3xl">
              Facturas, boletas y notas de venta emitidas en ZContable (POS, pagos y liquidaciones). Use la vista{' '}
              <strong className="font-medium text-slate-600">Pendientes de pago</strong> para registrar el cobro e imputar a
              deudas.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => applyStatusPreset('')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                !isPendingView
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => applyStatusPreset('pendiente_vincular')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                isPendingView
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-50'
              }`}
            >
              Pendientes de pago
            </button>
          </div>
        </div>
      </header>

      {isPendingView ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Comprobantes sin pago registrado. Confirme el cobro con método e imputación (FIFO o manual), igual que al pagar una deuda.
        </div>
      ) : null}

      {error ? (
        <div className="p-3 sm:p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Empresa</label>
            <SearchableSelect
              value={filterCompanyId}
              onChange={setFilterCompanyId}
              placeholder="Todas"
              options={[{ value: '', label: 'Todas' }, ...companies.map((c) => ({ value: String(c.id), label: c.business_name }))]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Estado conciliación</label>
            <SearchableSelect value={filterStatus} onChange={setFilterStatus} options={statusOptions} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Origen</label>
            <SearchableSelect value={filterOrigin} onChange={setFilterOrigin} options={originOptions} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">ID liquidación</label>
            <input
              type="text"
              inputMode="numeric"
              value={filterTaxSettlementId}
              onChange={(ev) => setFilterTaxSettlementId(ev.target.value)}
              placeholder="Filtrar por liquidación"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">RUC</label>
            <input
              type="text"
              value={filterRuc}
              onChange={(ev) => setFilterRuc(ev.target.value)}
              placeholder="Número de RUC"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nº comprobante</label>
            <input
              type="text"
              value={filterNumber}
              onChange={(ev) => setFilterNumber(ev.target.value)}
              placeholder="Ej. B002-907"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              autoComplete="off"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={filterNeedsSettlement}
                onChange={(ev) => setFilterNeedsSettlement(ev.target.checked)}
              />
              Solo sin liquidación
            </label>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            <i className="fas fa-spinner fa-spin mr-2" />
            Cargando…
          </div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            {isPendingView
              ? 'No hay comprobantes pendientes de pago con los filtros actuales.'
              : 'No hay comprobantes con los filtros actuales.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1040px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left">Tipo</th>
                  <th className="px-3 py-3 text-left">Serie / Número</th>
                  <th className="px-3 py-3 text-left">Emisión</th>
                  <th className="px-3 py-3 text-left">Cliente</th>
                  <th className="px-3 py-3 text-right">Monto</th>
                  <th className="px-3 py-3 text-left">Estado</th>
                  <th className="px-3 py-3 text-left">Origen</th>
                  <th className="px-3 py-3 text-left">Liquidación</th>
                  <th className="px-3 py-3 text-left">PDF</th>
                  <th className="px-3 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((r) => {
                  const kind = r.document_kind_label ?? '—';
                  const origin = r.origin_label ?? (r.origin === 'issued_local' ? 'Sistema' : r.origin === 'pos_sale' ? 'POS' : 'Externo');
                  const localPdf = isLocalFiscalReceipt(r.origin);
                  const recon = r.reconciliation_label ?? r.reconciliation_status;
                  const sunat = r.state_type_description?.trim();
                  const stBadge = r.settlement_link_status ?? (r.reconciliation_status === 'descartado' ? 'descartado' : 'pendiente');
                  const ticketUrl = (r.print_ticket_url ?? '').trim();
                  const pdfUrl = (r.pdf_url ?? '').trim();
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="px-3 py-3 text-slate-800 font-medium">{kind}</td>
                      <td className="px-3 py-3 text-slate-800 tabular-nums">{r.number}</td>
                      <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{formatEmissionDate(r)}</td>
                      <td className="px-3 py-3 text-slate-700 max-w-[200px] truncate" title={r.company?.business_name ?? r.customer_name}>
                        {r.company?.business_name ?? r.customer_name ?? r.customer_number ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-800">S/ {r.total.toFixed(2)}</td>
                      <td className="px-3 py-3 text-slate-600">
                        <div className="space-y-0.5">
                          <span className="block">{recon}</span>
                          {sunat ? <span className="block text-xs text-slate-500">{sunat}</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{origin}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-lg border text-xs font-medium ${settlementBadgeClass(stBadge)}`}
                          title={r.settlement_link_message}
                        >
                          {stBadge === 'vinculado' && (r.settlement_number || r.effective_tax_settlement_id != null)
                            ? `N° ${r.settlement_number || `#${r.effective_tax_settlement_id}`}`
                            : r.settlement_link_message ?? 'Pendiente de vincular a liquidación'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {localPdf ? (
                          <FiscalReceiptPdfActions receiptId={r.id} compact />
                        ) : ticketUrl || pdfUrl ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {ticketUrl ? (
                              <a
                                href={ticketUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 hover:bg-slate-100"
                                title="Enlace externo ticket"
                              >
                                <i className="fas fa-receipt text-[10px]" aria-hidden />
                                Ticket
                              </a>
                            ) : null}
                            {pdfUrl ? (
                              <a
                                href={pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50"
                                title="Enlace externo PDF"
                              >
                                <i className="fas fa-file-pdf text-[10px] text-red-600" aria-hidden />
                                A4
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex flex-col items-end gap-1">
                          {canRegisterPayment(r) ? (
                            <button
                              type="button"
                              onClick={() => setPaymentReceipt(r)}
                              className="text-xs font-medium text-primary-700 hover:text-primary-800"
                            >
                              Registrar pago
                            </button>
                          ) : null}
                          {canManualLinkSettlement(r) ? (
                            <button
                              type="button"
                              onClick={() => void openLinkModal(r)}
                              className="text-xs font-medium text-slate-600 hover:text-slate-800"
                            >
                              Vincular liquidación
                            </button>
                          ) : null}
                          {r.reconciliation_status === 'pendiente_vincular' && canDiscard ? (
                            <button
                              type="button"
                              onClick={() => void discardReceipt(r.id)}
                              className="text-xs text-slate-500 hover:text-red-600"
                            >
                              Descartar
                            </button>
                          ) : null}
                          {!canRegisterPayment(r) && !canManualLinkSettlement(r) ? (
                            <span className="text-slate-300">—</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && pagination.total > 0 ? (
          <div className="border-t border-slate-100 px-3 py-3">
            <Pagination
              page={pagination.page || initialPage}
              perPage={pagination.per_page || initialPerPage}
              total={pagination.total}
              onPageChange={handlePageChange}
              onPerPageChange={handlePerPageChange}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        ) : null}
      </div>

      <FiscalReceiptPaymentModal
        receipt={paymentReceipt}
        onClose={() => setPaymentReceipt(null)}
        onSuccess={() => void fetchList()}
      />

      {linkModal ? (
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center p-4 bg-slate-900/50"
          role="presentation"
          onClick={() => !linkSaving && setLinkModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4"
            role="dialog"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-800">Vincular a liquidación</h3>
            <p className="text-sm text-slate-600">
              Comprobante <span className="font-mono">{linkModal.number}</span> ·{' '}
              {linkModal.company?.business_name ?? linkModal.customer_name}
            </p>
            {linkError ? <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{linkError}</div> : null}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Liquidación emitida</label>
              {settlementsLoading ? (
                <p className="text-sm text-slate-500 py-2">
                  <i className="fas fa-spinner fa-spin mr-2" />
                  Cargando liquidaciones…
                </p>
              ) : (
                <SearchableSelect
                  value={linkSelect}
                  onChange={setLinkSelect}
                  placeholder="Seleccione… (vacío = quitar vínculo)"
                  options={[
                    { value: '', label: '— Sin liquidación (quitar vínculo)' },
                    ...settlementsOptions.map((s) => ({
                      value: String(s.id),
                      label: `${s.number || `#${s.id}`} · ${formatIssueDate(s.issue_date)}`,
                    })),
                  ]}
                />
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={linkSaving}
                onClick={() => setLinkModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={linkSaving || settlementsLoading}
                onClick={() => void submitLink()}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {linkSaving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Comprobantes;
