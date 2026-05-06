import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Payment, Company } from '../types/dashboard';
import { paymentsService } from '../services/payments';
import type { PaginationMeta as ApiPaginationMeta } from '../services/payments';
import { companiesService } from '../services/companies';
import { auth } from '../services/auth';
import SearchableSelect from '../components/SearchableSelect';
import Pagination from '../components/Pagination';
import ConfirmDialog from '../components/ConfirmDialog';
import { resolveBackendUrl } from '../api/client';

const pad2 = (n: number) => String(n).padStart(2, '0');

const formatDateInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const getCurrentMonthRange = () => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: formatDateInput(from), to: formatDateInput(to) };
};

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i <= 0) return fallback;
  return i;
}

const Payments = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCompanyId = searchParams.get('company_id') ?? '';
  const initialType = searchParams.get('type') ?? '';
  const initialDateFrom = searchParams.get('date_from') ?? '';
  const initialDateTo = searchParams.get('date_to') ?? '';
  const initialPage = parsePositiveInt(searchParams.get('page'), 1);
  const initialPerPage = parsePositiveInt(searchParams.get('per_page'), 20);
  const currentMonthRange = getCurrentMonthRange();
  const effectiveInitialDateFrom = initialDateFrom || currentMonthRange.from;
  const effectiveInitialDateTo = initialDateTo || currentMonthRange.to;

  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [type, setType] = useState(initialType);
  const [dateFrom, setDateFrom] = useState(effectiveInitialDateFrom);
  const [dateTo, setDateTo] = useState(effectiveInitialDateTo);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<ApiPaginationMeta>({
    page: initialPage,
    per_page: initialPerPage,
    total: 0,
    total_pages: 0,
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (!initialDateFrom || !initialDateTo) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('date_from', currentMonthRange.from);
        next.set('date_to', currentMonthRange.to);
        return next;
      }, { replace: true });
    }
  }, [currentMonthRange.from, currentMonthRange.to, initialDateFrom, initialDateTo, setSearchParams]);

  useEffect(() => {
    setCompanyId(initialCompanyId);
    setType(initialType);
    setDateFrom(effectiveInitialDateFrom);
    setDateTo(effectiveInitialDateTo);
  }, [effectiveInitialDateFrom, effectiveInitialDateTo, initialCompanyId, initialType]);

  useEffect(() => {
    fetchCompanies();
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [effectiveInitialDateFrom, effectiveInitialDateTo, initialCompanyId, initialPage, initialPerPage, initialType]);

  const getTypeLabel = (p: Payment) => {
    const normalized = (p.type ?? '').toLowerCase().trim();
    return normalized === 'on_account' || !p.document_id ? 'a cuenta' : 'aplicado';
  };

  const isAppliedPayment = (p: Payment) => {
    const normalized = (p.type ?? '').toLowerCase().trim();
    return normalized === 'applied' || Boolean(p.document_id);
  };

  const getTypeClass = (p: Payment) => {
    const label = getTypeLabel(p);
    return label === 'a cuenta'
      ? 'bg-slate-50 text-slate-700 border border-slate-200'
      : 'bg-primary-50 text-primary-700 border border-primary-200';
  };

  const fetchCompanies = async () => {
    try {
      setError('');
      const comps = await companiesService.list();
      setCompanies(comps);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPayments = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await paymentsService.listPaged({
        company_id: initialCompanyId || undefined,
        type: initialType || undefined,
        date_from: effectiveInitialDateFrom || undefined,
        date_to: effectiveInitialDateTo || undefined,
        page: initialPage,
        per_page: initialPerPage,
      });
      setPayments(res.items);
      setPagination(res.pagination);
    } catch (e) {
      console.error(e);
      setError('Error al cargar pagos');
    } finally {
      setLoading(false);
    }
  };

  const deletePaymentMessage = (p: Payment) => {
    const empresa = p.company?.business_name?.trim() || 'empresa';
    const fecha = p.date ? p.date.slice(0, 10) : '—';
    const monto = Number.isFinite(p.amount)
      ? p.amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
    return `Se eliminará el pago del ${fecha} por S/ ${monto} (${empresa}). Se quitarán las imputaciones a deudas, se actualizarán los estados de los documentos y, si aplica, se desvinculará el comprobante Tukifac. Esta acción no se puede deshacer.`;
  };

  const confirmDeletePayment = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await paymentsService.delete(deleteTarget.id);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Pago eliminado correctamente.' } }),
      );
      setDeleteTarget(null);
      fetchPayments();
    } catch (e) {
      console.error(e);
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: {
            type: 'error',
            message: typeof msg === 'string' && msg.trim() ? msg : 'Error al eliminar el pago',
          },
        }),
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  const lastPaymentsFilterKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const filterKey = [companyId, type, dateFrom, dateTo].join('\t');
    const prevFilterKey = lastPaymentsFilterKeyRef.current;
    const filtersJustChanged = prevFilterKey !== null && prevFilterKey !== filterKey;

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (companyId) next.set('company_id', companyId);
        else next.delete('company_id');
        if (type) next.set('type', type);
        else next.delete('type');
        next.set('date_from', dateFrom || currentMonthRange.from);
        next.set('date_to', dateTo || currentMonthRange.to);
        if (filtersJustChanged) {
          next.set('page', '1');
        } else {
          const p = prev.get('page');
          next.set('page', p && /^[1-9]\d*$/.test(p) ? p : '1');
        }
        if (next.get('per_page') == null) next.set('per_page', String(initialPerPage));
        if (next.toString() === prev.toString()) return prev;
        return next;
      },
      { replace: true },
    );

    lastPaymentsFilterKeyRef.current = filterKey;
  }, [
    companyId,
    type,
    dateFrom,
    dateTo,
    currentMonthRange.from,
    currentMonthRange.to,
    initialPerPage,
    setSearchParams,
  ]);

  const handlePageChange = (nextPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      if (next.get('per_page') == null) next.set('per_page', String(initialPerPage));
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

  const role = auth.getRole() ?? '';
  const canCreate = role === 'Administrador' || role === 'Supervisor' || role === 'Contador' || role === 'Asistente';
  const canEdit = role === 'Administrador' || role === 'Supervisor' || role === 'Contador';
  const canDeletePayment = role === 'Administrador';

  const closePreview = () => setPreviewUrl(null);
  const isPdf = (url: string) => url.toLowerCase().split('?')[0].endsWith('.pdf');

  return (
    <div className="space-y-4">
      {previewUrl ? (
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Cerrar"
              onClick={closePreview}
              className="absolute inset-0 bg-slate-900/50"
            />
            <div className="relative w-full max-w-4xl rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <div className="text-sm font-semibold text-slate-800">Comprobante</div>
                <button
                  type="button"
                  onClick={closePreview}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-slate-100 text-slate-600"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
              <div className="p-3 bg-slate-50">
                {isPdf(previewUrl) ? (
                  <iframe title="Comprobante" src={previewUrl} className="w-full h-[70vh] rounded-lg bg-white" />
                ) : (
                  <img
                    src={previewUrl}
                    alt="Comprobante"
                    className="w-full max-h-[70vh] object-contain rounded-lg bg-white"
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-800">Pagos</h2>
          <p className="text-sm text-slate-500">Registro de pagos realizados por las empresas.</p>
        </div>
        {canCreate ? (
          <Link
            to="/payments/new"
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 transition"
          >
            <i className="fas fa-plus text-xs"></i>
            <span>Nuevo pago</span>
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Empresa</label>
          <SearchableSelect
            value={companyId}
            onChange={setCompanyId}
            className="min-w-[200px]"
            searchPlaceholder="Buscar empresa..."
            options={[
              { value: '', label: 'Todas' },
              ...companies.map((c) => ({ value: String(c.id), label: c.business_name })),
            ]}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
          <SearchableSelect
            value={type}
            onChange={setType}
            className="min-w-[200px]"
            options={[
              { value: '', label: 'Todos' },
              { value: 'applied', label: 'Aplicado' },
              { value: 'on_account', label: 'A cuenta' },
            ]}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(ev) => setDateFrom(ev.target.value)}
            className="w-[160px] px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(ev) => setDateTo(ev.target.value)}
            className="w-[160px] px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Tukifac</th>
                <th className="px-4 py-3">PDF</th>
                <th className="px-4 py-3">Deuda</th>
                <th className="px-4 py-3">Método</th>
                <th className="px-4 py-3 text-right">Monto</th>
                <th className="px-4 py-3">Comprobante</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && payments.length === 0 ? (
                 <tr>
                   <td colSpan={10} className="px-4 py-6 text-center text-slate-500 text-sm">
                     <i className="fas fa-spinner fa-spin mr-2"></i> Cargando pagos...
                   </td>
                 </tr>
              ) : payments.length > 0 ? (
                payments.map((payment) => {
                  const tukRec = payment.tukifac_fiscal_receipt;
                  const ticketUrl = (tukRec?.print_ticket_url ?? '').trim();
                  const pdfUrl = (tukRec?.pdf_url ?? '').trim();
                  return (
                  <tr key={payment.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{payment.date ? payment.date.slice(0, 10) : '—'}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium">
                      {payment.company ? payment.company.business_name : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getTypeClass(payment)}`}
                      >
                        {getTypeLabel(payment)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-mono text-xs">
                      {tukRec?.number ? (
                        <span title={`ID Tukifac: ${tukRec.external_id}`}>
                          {tukRec.number}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-sans">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!ticketUrl && !pdfUrl ? (
                        <span className="text-slate-400 text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {ticketUrl ? (
                            <a
                              href={ticketUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 hover:bg-slate-100"
                              title="Vista ticket (Tukifac)"
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
                              title="PDF A4 (Tukifac)"
                            >
                              <i className="fas fa-file-pdf text-[10px] text-red-600" aria-hidden />
                              A4
                            </a>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {payment.document ? payment.document.number : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{payment.method}</td>
                    <td className="px-4 py-3 text-right text-slate-800 font-semibold">
                      S/ {payment.amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {payment.attachment ? (
                        <button
                          type="button"
                          onClick={() => setPreviewUrl(payment.attachment ? resolveBackendUrl(payment.attachment) : null)}
                          className="inline-flex items-center gap-2 text-primary-600 hover:underline text-xs font-medium"
                        >
                          <i className="fas fa-eye"></i>
                          <span>Ver</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Sin adjunto</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {canEdit && !isAppliedPayment(payment) ? (
                          <Link
                            to={`/payments/${payment.id}/edit`}
                            className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <i className="fas fa-pen mr-1"></i> Editar
                          </Link>
                        ) : null}
                        {canDeletePayment ? (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(payment)}
                            className="inline-flex items-center px-3 py-1.5 rounded-full border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            <i className="fas fa-trash mr-1"></i> Eliminar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-500 text-sm">
                    {loading ? "Cargando..." : "No hay pagos registrados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 sm:px-6 py-4 border-t border-slate-100">
          <Pagination
            page={pagination.page || initialPage}
            perPage={pagination.per_page || initialPerPage}
            total={pagination.total ?? 0}
            onPageChange={handlePageChange}
            onPerPageChange={handlePerPageChange}
          />
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Eliminar pago"
        message={deleteTarget ? deletePaymentMessage(deleteTarget) : ''}
        confirmLabel="Eliminar pago"
        cancelLabel="Cancelar"
        danger
        loading={deleteLoading}
        onClose={() => {
          if (!deleteLoading) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDeletePayment()}
      />
    </div>
  );
};

export default Payments;
