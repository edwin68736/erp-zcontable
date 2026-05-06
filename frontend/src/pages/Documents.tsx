import { useState, useEffect, useMemo, useRef, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { Company, Document, Payment } from '../types/dashboard';
import { formatInTimeZone } from 'date-fns-tz';
import { documentsService } from '../services/documents';
import type {
  PaginationMeta as ApiPaginationMeta,
  CompanyDebtSummary,
  DocumentsListMode,
} from '../services/documents';
import { companiesService } from '../services/companies';
import { paymentsService, type PaymentTukifacIssuePayload } from '../services/payments';
import {
  ensureTukifacSeriesCached,
  getCachedDocumentSeries,
  getCachedSaleNoteSeries,
  pickDefaultSeries,
} from '../services/tukifacSeriesCache';
import { auth } from '../services/auth';
import { dateInputToRFC3339MidnightPeru } from '../utils/peruDates';
import SearchableSelect from '../components/SearchableSelect';
import Pagination from '../components/Pagination';
import ConfirmDialog from '../components/ConfirmDialog';
import TukifacIssueLinksDialog from '../components/TukifacIssueLinksDialog';
import { parseTukifacReceiptViewLinks, type TukifacReceiptViewLinks } from '../utils/tukifacReceiptLinks';

const pad2 = (n: number) => String(n).padStart(2, '0');

const formatDateInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

type DocumentWithPayments = Document & { payments?: Payment[] };

function getTukifacErrorMessage(e: unknown): string {
  if (!e || typeof e !== 'object') return 'Error al enviar el comprobante a Tukifac';
  if (!('response' in e)) return 'Error al enviar el comprobante a Tukifac';
  const maybe = e as { response?: { data?: unknown } };
  const data = maybe.response?.data;
  if (data && typeof data === 'object' && 'error' in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return 'Error al enviar el comprobante a Tukifac';
}

function getDocumentTypeLabel(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';

  const map: Record<string, string> = {
    '01': 'FACTURA',
    '03': 'BOLETA',
    '07': 'NOTA DE CREDITO',
    '08': 'NOTA DE DEBITO',
    '09': 'GUIA DE REMISION',
    '20': 'COMPROBANTE DE RETENCIÓN',
    '40': 'COMPROBANTE DE PERCEPCIÓN',
  };

  const upper = raw.toUpperCase();
  if (map[raw]) return map[raw];
  if (map[upper]) return map[upper];

  if (upper === 'FACTURA') return 'Factura';
  if (upper === 'BOLETA') return 'Boleta';
  if (upper === 'NOTA DE CREDITO' || upper === 'NOTA DE CRÉDITO') return 'Nota de crédito';
  if (upper === 'NOTA DE DEBITO' || upper === 'NOTA DE DÉBITO') return 'Nota de débito';
  if (raw === 'nota_venta') return 'Nota de venta';
  if (raw === 'recibo') return 'Recibo';
  if (raw === 'liquidacion_impuestos') return 'Liquidación de impuestos';
  /** Deuda interna DEU-LIQ-* generada al emitir liquidación (`source: liquidacion`). */
  if (raw === 'LI' || upper === 'LI') return 'Liquidación';
  if (upper === 'PLAN') return 'Mensualidad (plan)';

  return raw;
}

/** Número de deuda en pantalla (liquidación: DEU-LI-… desde el backend). */
function documentDebtNumber(doc: Document): string {
  const d = (doc.display_number ?? '').trim();
  return d || doc.number;
}

/** Periodo contable AAAA-MM (deuda manual / liquidación) o mensualidad plan. */
function formatDebtPeriod(doc: Document): string {
  const p = (doc.accounting_period ?? '').trim() || (doc.service_month ?? '').trim();
  return p || '—';
}

/** Celda tipo: solo "LI" para deudas generadas al emitir liquidación (tipo `LI` o legado Otro+liquidacion). */
function debtTypeCell(doc: Document): ReactNode {
  const fromLiquidacion = String(doc.source ?? '').trim() === 'liquidacion';
  const typeNorm = String(doc.type ?? '').trim();
  const isLITipo = typeNorm === 'LI' || typeNorm.toUpperCase() === 'LI';
  if (fromLiquidacion || isLITipo) {
    return (
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold font-mono tracking-tight bg-violet-100 text-violet-900 border border-violet-200"
        title="Deuda generada desde liquidación de impuestos emitida"
      >
        LI
      </span>
    );
  }
  return getDocumentTypeLabel(doc.type);
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i <= 0) return fallback;
  return i;
}

const getCurrentMonthRange = () => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: formatDateInput(from), to: formatDateInput(to) };
};

const Documents = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCompanyId = searchParams.get('company_id') ?? '';
  const initialStatus = searchParams.get('status') ?? '';
  const initialOverdue = searchParams.get('overdue') ?? '';
  const initialDateFrom = searchParams.get('date_from') ?? '';
  const initialDateTo = searchParams.get('date_to') ?? '';
  const initialPage = parsePositiveInt(searchParams.get('page'), 1);
  const initialPerPage = parsePositiveInt(searchParams.get('per_page'), 20);
  const currentMonthRange = getCurrentMonthRange();
  const allCompaniesDefaultFrom = initialDateFrom || currentMonthRange.from;
  const allCompaniesDefaultTo = initialDateTo || currentMonthRange.to;

  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [status, setStatus] = useState(() => {
    const st = searchParams.get('status') ?? '';
    if (searchParams.get('overdue') === '1' && !st) return 'vencido';
    if (st === 'all') return 'all';
    if (st) return st;
    return searchParams.get('company_id') ? '' : 'pendiente';
  });
  const [overdue, setOverdue] = useState(initialOverdue === '1');
  const [dateFrom, setDateFrom] = useState(
    initialCompanyId ? initialDateFrom : allCompaniesDefaultFrom,
  );
  const [dateTo, setDateTo] = useState(initialCompanyId ? initialDateTo : allCompaniesDefaultTo);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [listMode, setListMode] = useState<DocumentsListMode>('documents');
  const [companySummaries, setCompanySummaries] = useState<CompanyDebtSummary[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<ApiPaginationMeta>({
    page: initialPage,
    per_page: initialPerPage,
    total: 0,
    total_pages: 0,
  });
  const peruvianToday = useMemo(() => formatInTimeZone(new Date(), 'America/Lima', 'yyyy-MM-dd'), []);

  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [payDoc, setPayDoc] = useState<Document | null>(null);
  const [payBalance, setPayBalance] = useState<number | null>(null);
  const [payLoadingDoc, setPayLoadingDoc] = useState(false);
  const [paySaving, setPaySaving] = useState(false);
  const [payUploading, setPayUploading] = useState(false);
  const [payError, setPayError] = useState('');
  const [payDate, setPayDate] = useState(peruvianToday);
  const [payMethod, setPayMethod] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payAttachmentName, setPayAttachmentName] = useState('');
  const [payAttachmentFile, setPayAttachmentFile] = useState<File | null>(null);
  const [payNotes, setPayNotes] = useState('');
  const [payTukifacKind, setPayTukifacKind] = useState<'boleta' | 'factura' | 'sale_note'>('sale_note');
  const [payTukifacSerie, setPayTukifacSerie] = useState('');
  const [payTukifacSaleNoteSeriesId, setPayTukifacSaleNoteSeriesId] = useState('');
  const [payTukifacSeriesRefresh, setPayTukifacSeriesRefresh] = useState(0);
  const [tukifacPostPayLinks, setTukifacPostPayLinks] = useState<TukifacReceiptViewLinks | null>(null);

  const [itemsModalOpen, setItemsModalOpen] = useState(false);
  const [itemsModalDoc, setItemsModalDoc] = useState<Document | null>(null);
  const [itemsModalDetail, setItemsModalDetail] = useState<Document | null>(null);
  const [itemsModalLoading, setItemsModalLoading] = useState(false);
  const [itemsModalError, setItemsModalError] = useState('');

  const [debtsCompanyModalOpen, setDebtsCompanyModalOpen] = useState(false);
  const [debtsCompanySummary, setDebtsCompanySummary] = useState<CompanyDebtSummary | null>(null);
  const [debtsCompanyDocs, setDebtsCompanyDocs] = useState<Document[]>([]);
  const [debtsCompanyLoading, setDebtsCompanyLoading] = useState(false);
  const [debtsCompanyError, setDebtsCompanyError] = useState('');

  /** Tabla agrupada: sin empresa en URL y (respuesta by_company o primera carga en curso). */
  const useGroupedLayout = useMemo(
    () =>
      !initialCompanyId &&
      (listMode === 'by_company' ||
        (loading && companySummaries.length === 0 && documents.length === 0)),
    [initialCompanyId, listMode, loading, companySummaries.length, documents.length],
  );

  const openItemsModal = async (doc: Document) => {
    setItemsModalDoc(doc);
    setItemsModalDetail(null);
    setItemsModalError('');
    setItemsModalOpen(true);
    setItemsModalLoading(true);
    try {
      const full = await documentsService.get(doc.id);
      setItemsModalDetail(full);
    } catch (e) {
      console.error(e);
      setItemsModalError('No se pudo cargar el detalle de la deuda');
    } finally {
      setItemsModalLoading(false);
    }
  };

  const closeItemsModal = () => {
    setItemsModalOpen(false);
    setItemsModalDoc(null);
    setItemsModalDetail(null);
    setItemsModalError('');
  };

  const buildPagedListParams = (opts: {
    page: number;
    perPage: number;
    companyId: string;
    includeGroupBy: boolean;
  }): Parameters<typeof documentsService.listPaged>[0] => {
    const { page, perPage, companyId, includeGroupBy } = opts;
    const params: Parameters<typeof documentsService.listPaged>[0] = {
      company_id: companyId || undefined,
      status:
        initialOverdue === '1'
          ? undefined
          : initialStatus === 'all'
            ? 'all'
            : initialStatus || undefined,
      overdue: initialOverdue === '1' ? '1' : undefined,
      page,
      per_page: perPage,
    };
    if (includeGroupBy && !companyId) {
      params.group_by_company = '1';
    }
    if (!companyId) {
      params.date_from = initialDateFrom || currentMonthRange.from;
      params.date_to = initialDateTo || currentMonthRange.to;
    } else if (initialDateFrom && initialDateTo) {
      params.date_from = initialDateFrom;
      params.date_to = initialDateTo;
    }
    return params;
  };

  const openDebtsForCompanyModal = async (row: CompanyDebtSummary) => {
    setDebtsCompanySummary(row);
    setDebtsCompanyDocs([]);
    setDebtsCompanyError('');
    setDebtsCompanyModalOpen(true);
    setDebtsCompanyLoading(true);
    try {
      const res = await documentsService.listPaged(
        buildPagedListParams({
          page: 1,
          perPage: 100,
          companyId: String(row.company_id),
          includeGroupBy: false,
        }),
      );
      setDebtsCompanyDocs(res.items);
    } catch (e) {
      console.error(e);
      setDebtsCompanyError('No se pudo cargar las deudas de la empresa');
    } finally {
      setDebtsCompanyLoading(false);
    }
  };

  const closeDebtsCompanyModal = () => {
    setDebtsCompanyModalOpen(false);
    setDebtsCompanySummary(null);
    setDebtsCompanyDocs([]);
    setDebtsCompanyError('');
  };

  useEffect(() => {
    if (initialCompanyId) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      let changed = false;
      if (!initialDateFrom || !initialDateTo) {
        next.set('date_from', currentMonthRange.from);
        next.set('date_to', currentMonthRange.to);
        changed = true;
      }
      return changed ? next : prev;
    }, { replace: true });
  }, [
    currentMonthRange.from,
    currentMonthRange.to,
    initialCompanyId,
    initialDateFrom,
    initialDateTo,
    setSearchParams,
  ]);

  useEffect(() => {
    setCompanyId(initialCompanyId);
    setStatus(
      initialOverdue === '1' && !initialStatus
        ? 'vencido'
        : initialStatus === 'all'
          ? 'all'
          : initialStatus || (initialCompanyId ? '' : 'pendiente'),
    );
    setOverdue(initialOverdue === '1');
    if (initialCompanyId) {
      setDateFrom(initialDateFrom);
      setDateTo(initialDateTo);
    } else {
      setDateFrom(initialDateFrom || currentMonthRange.from);
      setDateTo(initialDateTo || currentMonthRange.to);
    }
  }, [
    initialCompanyId,
    initialDateFrom,
    initialDateTo,
    initialOverdue,
    initialStatus,
    currentMonthRange.from,
    currentMonthRange.to,
  ]);

  useEffect(() => {
    fetchCompanies();
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [
    initialCompanyId,
    initialDateFrom,
    initialDateTo,
    initialOverdue,
    initialPage,
    initialPerPage,
    initialStatus,
    currentMonthRange.from,
    currentMonthRange.to,
  ]);

  const fetchCompanies = async () => {
    try {
      setError('');
      const comps = await companiesService.list();
      setCompanies(comps);
    } catch (e) {
      console.error(e);
    } finally {
    }
  };

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await documentsService.listPaged(
        buildPagedListParams({
          page: initialPage,
          perPage: initialPerPage,
          companyId: initialCompanyId,
          includeGroupBy: true,
        }),
      );
      setListMode(res.list_mode);
      if (res.list_mode === 'by_company') {
        setCompanySummaries(res.company_summaries);
        setDocuments([]);
      } else {
        setDocuments(res.items);
        setCompanySummaries([]);
      }
      setPagination(res.pagination);
    } catch (e) {
      console.error(e);
      setError('Error al cargar deudas');
    } finally {
      setLoading(false);
    }
  };

  const handleCompanyChange = (v: string) => {
    const prev = companyId;
    setCompanyId(v);
    if (v && !prev) {
      setDateFrom('');
      setDateTo('');
    } else if (!v && prev) {
      setDateFrom(currentMonthRange.from);
      setDateTo(currentMonthRange.to);
    }
  };

  const deleteConfirmMessage = (doc: Document) => {
    const hint = (
      doc.description?.trim() ||
      documentDebtNumber(doc).trim() ||
      `Deuda #${doc.id}`
    ).slice(0, 120);
    return `¿Eliminar «${hint}»? Esta acción no se puede deshacer.`;
  };

  const confirmDeleteDebt = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await documentsService.delete(deleteTarget.id);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'success', message: 'Deuda eliminada correctamente.' },
        }),
      );
      setDeleteTarget(null);
      fetchDocuments();
    } catch (e) {
      console.error(e);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al eliminar la deuda' } }),
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  const partialDateFilterWarned = useRef(false);
  const lastDocumentsFilterKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const filterKey = [companyId, status, String(overdue), dateFrom, dateTo].join('\t');

    if (companyId && ((dateFrom && !dateTo) || (!dateFrom && dateTo))) {
      if (!partialDateFilterWarned.current) {
        partialDateFilterWarned.current = true;
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: {
              type: 'error',
              message: 'Indique ambas fechas (desde y hasta) o déjelas vacías para ver todo el saldo pendiente.',
            },
          }),
        );
      }
      return;
    }
    partialDateFilterWarned.current = false;

    const prevFilterKey = lastDocumentsFilterKeyRef.current;
    const filtersJustChanged = prevFilterKey !== null && prevFilterKey !== filterKey;

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (companyId) next.set('company_id', companyId);
        else next.delete('company_id');
        if (overdue || status === 'vencido') next.set('overdue', '1');
        else next.delete('overdue');
        if (status === 'vencido') {
          next.delete('status');
        } else if (status === 'all') {
          next.set('status', 'all');
        } else if (status) {
          next.set('status', status);
        } else {
          if (companyId) {
            next.delete('status');
          } else {
            next.set('status', 'pendiente');
          }
        }
        if (companyId) {
          if (dateFrom && dateTo) {
            next.set('date_from', dateFrom);
            next.set('date_to', dateTo);
          } else {
            next.delete('date_from');
            next.delete('date_to');
          }
        } else {
          next.set('date_from', dateFrom || currentMonthRange.from);
          next.set('date_to', dateTo || currentMonthRange.to);
        }
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

    lastDocumentsFilterKeyRef.current = filterKey;
  }, [
    companyId,
    status,
    overdue,
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
  const canUpsert = role === 'Administrador' || role === 'Supervisor' || role === 'Contador';
  const canDelete = role === 'Administrador' || role === 'Supervisor';
  const canCreatePayment = role === 'Administrador' || role === 'Supervisor' || role === 'Contador' || role === 'Asistente';
  const canIssueTukifac = useMemo(
    () => role === 'Administrador' || role === 'Supervisor' || role === 'Contador',
    [role],
  );

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

  useEffect(() => {
    if (!isPayModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPayModalOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPayModalOpen]);

  useEffect(() => {
    if (!isPayModalOpen || !canIssueTukifac) return;
    let cancelled = false;
    void ensureTukifacSeriesCached()
      .then(() => {
        if (!cancelled) setPayTukifacSeriesRefresh((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) setPayTukifacSeriesRefresh((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [isPayModalOpen, canIssueTukifac]);

  useEffect(() => {
    if (!isPayModalOpen || !canIssueTukifac) return;
    if (payTukifacKind === 'sale_note') {
      const rows = getCachedSaleNoteSeries();
      const d = pickDefaultSeries(rows);
      setPayTukifacSaleNoteSeriesId((prev) => {
        if (prev && rows.some((r) => String(r.id) === prev)) return prev;
        return d ? String(d.id) : '';
      });
      return;
    }
    const sunat = payTukifacKind === 'factura' ? '01' : '03';
    const rows = getCachedDocumentSeries().filter((r) => (r.document_type_id ?? '').trim() === sunat);
    const d = pickDefaultSeries(rows);
    setPayTukifacSerie((prev) => {
      const ok = rows.some((r) => r.number === prev);
      if (ok) return prev;
      return d?.number ?? '';
    });
  }, [isPayModalOpen, canIssueTukifac, payTukifacKind, payTukifacSeriesRefresh]);

  const openPayModal = async (doc: Document) => {
    setPayDoc(doc);
    setPayBalance(null);
    setPayLoadingDoc(true);
    setPaySaving(false);
    setPayUploading(false);
    setPayError('');
    setPayDate(peruvianToday);
    setPayMethod('');
    setPayReference('');
    setPayAttachmentName('');
    setPayAttachmentFile(null);
    setPayNotes('');
    setPayTukifacKind('sale_note');
    setPayTukifacSerie('');
    setPayTukifacSaleNoteSeriesId('');
    setIsPayModalOpen(true);

    try {
      const detail = (await documentsService.get(doc.id)) as unknown as DocumentWithPayments;
      const paid = (detail.payments ?? []).reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0);
      const balance = Math.max(0, (detail.total_amount ?? doc.total_amount ?? 0) - paid);
      setPayBalance(balance);
    } catch (e) {
      console.error(e);
      setPayError('No se pudo cargar el detalle de la deuda');
      setPayBalance(null);
    } finally {
      setPayLoadingDoc(false);
    }
  };

  const closePayModal = () => {
    setIsPayModalOpen(false);
    setPayDoc(null);
    setPayBalance(null);
    setPayError('');
  };

  const handlePayAttachmentSelect = (file: File | null) => {
    setPayAttachmentFile(file);
    setPayAttachmentName(file?.name ?? '');
  };

  const handlePaySubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!payDoc) return;
    if (!canCreatePayment) {
      setPayError('No tienes permisos para realizar esta acción');
      return;
    }
    if (!payDate) {
      setPayError('La fecha es requerida');
      return;
    }
    if (!payMethod.trim()) {
      setPayError('El método de pago es requerido');
      return;
    }
    const amount = payBalance ?? payDoc.total_amount;
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError('El monto del pago es inválido');
      return;
    }

    const tryTukifacAfterCreate = canIssueTukifac;
    if (tryTukifacAfterCreate && payTukifacKind === 'sale_note') {
      const sid = Number(payTukifacSaleNoteSeriesId);
      const nvRows = getCachedSaleNoteSeries();
      if (!Number.isFinite(sid) || sid <= 0) {
        setPayError(
          nvRows.length
            ? 'Seleccione la serie de nota de venta para Tukifac.'
            : 'No hay series de nota de venta disponibles en Tukifac para este usuario.',
        );
        return;
      }
    }
    if (tryTukifacAfterCreate && (payTukifacKind === 'boleta' || payTukifacKind === 'factura')) {
      const sunat = payTukifacKind === 'factura' ? '01' : '03';
      const fbRows = getCachedDocumentSeries().filter((r) => (r.document_type_id ?? '').trim() === sunat);
      if (fbRows.length > 0 && !payTukifacSerie.trim()) {
        setPayError('Seleccione la serie del comprobante (factura o boleta) para Tukifac.');
        return;
      }
    }

    try {
      setPaySaving(true);
      setPayError('');

      let attachmentUrl = '';
      if (payAttachmentFile) {
        setPayUploading(true);
        try {
          attachmentUrl = await paymentsService.uploadAttachment(payAttachmentFile);
        } finally {
          setPayUploading(false);
        }
      }

      const created = await paymentsService.create({
        company_id: payDoc.company_id,
        document_id: payDoc.id,
        type: 'applied',
        date: dateInputToRFC3339MidnightPeru(payDate),
        amount,
        method: payMethod.trim(),
        reference: payReference.trim() || undefined,
        attachment: attachmentUrl || undefined,
        notes: payNotes.trim() || undefined,
      });
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Pago registrado correctamente.' } }),
      );
      if (tryTukifacAfterCreate) {
        try {
          const tukBody: PaymentTukifacIssuePayload = {
            kind: payTukifacKind,
            serie_documento: payTukifacSerie.trim() || undefined,
            sale_note_series_id:
              payTukifacKind === 'sale_note' ? Number(payTukifacSaleNoteSeriesId) : undefined,
            payment_method_type_id: '01',
            payment_destination_id: 'cash',
            payment_reference: payMethod.trim() || payReference.trim() || 'Caja',
          };
          const issueOut = await paymentsService.issueTukifacFromPayment(created.id, tukBody);
          window.dispatchEvent(
            new CustomEvent('miweb:toast', {
              detail: { type: 'success', message: 'Comprobante enviado a Tukifac correctamente.' },
            }),
          );
          const viewLinks = parseTukifacReceiptViewLinks(issueOut.receipt);
          if (viewLinks) {
            setTukifacPostPayLinks(viewLinks);
            closePayModal();
            void fetchDocuments();
            return;
          }
        } catch (te) {
          console.error(te);
          window.dispatchEvent(
            new CustomEvent('miweb:toast', {
              detail: {
                type: 'error',
                message: `Pago guardado. No se pudo emitir en Tukifac: ${getTukifacErrorMessage(te)}`,
              },
            }),
          );
        }
      }
      closePayModal();
      fetchDocuments();
    } catch (err) {
      console.error(err);
      const maybe = err as { response?: { data?: { error?: string } } };
      const msg = maybe?.response?.data?.error ? String(maybe.response.data.error) : 'Error al registrar el pago';
      setPayError(msg);
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'error', message: msg } }));
    } finally {
      setPaySaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <TukifacIssueLinksDialog
        open={Boolean(tukifacPostPayLinks)}
        links={tukifacPostPayLinks}
        onContinue={() => {
          setTukifacPostPayLinks(null);
        }}
        continueLabel="Cerrar"
      />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-800">Deudas</h2>
          <p className="text-sm text-slate-500">
            Cargos en cuentas por cobrar (nota de venta, recibo interno, planes). La sincronización con Tukifac está en el menú <strong className="font-medium text-slate-600">Documentos Tukifac</strong>.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          {canUpsert ? (
            <Link
              to="/documents/new"
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 transition"
            >
              <i className="fas fa-plus text-xs"></i>
              <span>Nueva deuda</span>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="w-full max-w-full bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 xl:grid-cols-12 gap-3 w-full items-end">
          <div className="sm:col-span-2 lg:col-span-2 xl:col-span-5 min-w-0 w-full">
            <label className="block text-xs font-medium text-slate-500 mb-1">Empresa</label>
            <SearchableSelect
              value={companyId}
              onChange={handleCompanyChange}
              className="w-full min-w-0"
              searchPlaceholder="Buscar empresa..."
              options={[
                { value: '', label: 'Todas' },
                ...companies.map((c) => ({ value: String(c.id), label: c.business_name })),
              ]}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-2 xl:col-span-3 min-w-0 w-full">
            <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
            <SearchableSelect
              value={status}
              onChange={(v) => {
                setStatus(v);
                setOverdue(v === 'vencido');
              }}
              className="w-full min-w-0"
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'parcial', label: 'Parcial' },
                { value: 'pagado', label: 'Pagado' },
                { value: 'anulado', label: 'Anulado' },
                { value: 'vencido', label: 'Vencido' },
              ]}
            />
          </div>
          <div className="lg:col-span-1 xl:col-span-2 min-w-0 w-full">
            <label className="block text-xs font-medium text-slate-500 mb-1">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(ev) => setDateFrom(ev.target.value)}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div className="lg:col-span-1 xl:col-span-2 min-w-0 w-full">
            <label className="block text-xs font-medium text-slate-500 mb-1">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={(ev) => setDateTo(ev.target.value)}
              className="w-full min-h-[44px] px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
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
              {useGroupedLayout ? (
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">Código</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3 whitespace-nowrap">RUC</th>
                  <th className="px-4 py-3 text-right">N.º deudas</th>
                  <th className="px-4 py-3 text-right">Total saldo abierto</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 whitespace-nowrap">Periodo</th>
                  <th className="px-4 py-3">Número</th>
                  <th className="px-4 py-3 min-w-[140px] max-w-[280px]">Descripción</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Pago</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading &&
              (useGroupedLayout ? companySummaries.length === 0 : documents.length === 0) ? (
                 <tr>
                   <td
                     colSpan={useGroupedLayout ? 6 : 10}
                     className="px-4 py-6 text-center text-slate-500 text-sm"
                   >
                     <i className="fas fa-spinner fa-spin mr-2"></i> Cargando deudas...
                   </td>
                 </tr>
              ) : listMode === 'by_company' && companySummaries.length > 0 ? (
                companySummaries.map((row) => (
                  <tr key={row.company_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700 font-mono text-xs tabular-nums whitespace-nowrap">
                      {(row.company?.code ?? '').trim() || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-medium">
                      {row.company?.business_name?.trim()
                        ? row.company.business_name
                        : `Empresa #${row.company_id}`}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-mono text-xs tabular-nums whitespace-nowrap">
                      {(row.company?.ruc ?? '').trim() || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{row.document_count}</td>
                    <td className="px-4 py-3 text-right text-slate-800 font-semibold whitespace-nowrap">
                      S/ {row.open_balance_total.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          title="Ver deudas de esta empresa"
                          onClick={() => void openDebtsForCompanyModal(row)}
                          className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <i className="fas fa-list-ul mr-1"></i> Ítems
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : documents.length > 0 ? (
                documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{doc.issue_date ? doc.issue_date.slice(0, 10) : '—'}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium">
                      {doc.company ? doc.company.business_name : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{debtTypeCell(doc)}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs tabular-nums whitespace-nowrap">
                      {formatDebtPeriod(doc)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-mono text-xs">{documentDebtNumber(doc)}</td>
                    <td
                      className="px-4 py-3 text-slate-600 text-xs max-w-[280px] align-top"
                      title={doc.description?.trim() ? doc.description : undefined}
                    >
                      {doc.description?.trim() ? (
                        <span className="line-clamp-2">{doc.description.trim()}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-800 font-semibold whitespace-nowrap">
                      S/ {doc.total_amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const dueDate = doc.due_date ? new Date(doc.due_date) : null;
                        const isOverdue = Boolean(
                          dueDate &&
                            Number.isFinite(dueDate.getTime()) &&
                            dueDate.getTime() < Date.now() &&
                            doc.status !== 'pagado' &&
                            doc.status !== 'anulado',
                        );
                        const label = isOverdue ? 'vencido' : doc.status;
                        const cls =
                          label === 'pendiente'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : label === 'parcial'
                              ? 'bg-sky-50 text-sky-700 border border-sky-200'
                              : label === 'pagado'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : label === 'anulado'
                                  ? 'bg-slate-50 text-slate-700 border border-slate-200'
                                  : 'bg-red-50 text-red-700 border border-red-200';

                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        {doc.status !== 'pagado' && doc.status !== 'anulado' && canCreatePayment ? (
                          <button
                            type="button"
                            onClick={() => openPayModal(doc)}
                            className="inline-flex items-center px-3 py-1.5 rounded-full border border-emerald-200 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            <i className="fas fa-hand-holding-usd mr-1"></i> Pagar
                          </button>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void openItemsModal(doc)}
                          className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <i className="fas fa-list-ul mr-1"></i> Ítems
                        </button>
                        {canUpsert ? (
                          <Link
                            to={`/documents/${doc.id}/edit`}
                            className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <i className="fas fa-pen mr-1"></i> Editar
                          </Link>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(doc)}
                            className="inline-flex items-center px-3 py-1.5 rounded-full border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            <i className="fas fa-trash mr-1"></i> Eliminar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={useGroupedLayout ? 6 : 10}
                    className="px-4 py-6 text-center text-slate-500 text-sm"
                  >
                    {loading ? 'Cargando...' : 'No hay deudas registradas.'}
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

      {isPayModalOpen && payDoc
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={closePayModal}
            aria-label="Cerrar pago"
          ></button>

          <div className="relative w-full max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-6rem)]">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100 bg-white/90 backdrop-blur shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Registrar pago</h3>
                <p className="text-xs text-slate-500">
                  {payDoc.company?.business_name ?? '—'} · {getDocumentTypeLabel(payDoc.type)}{' '}
                  {documentDebtNumber(payDoc)}
                </p>
              </div>
              <button
                type="button"
                onClick={closePayModal}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Cerrar"
              >
                <i className="fas fa-times text-xs"></i>
              </button>
            </div>

            <form onSubmit={handlePaySubmit} className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
              {canIssueTukifac ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <p className="text-xs text-slate-500">
                      Tukifac: comprobante al guardar (una línea por el monto aplicado a esta deuda).
                    </p>
                  </div>
                  <div>
                    <label htmlFor="pay-tukifac-kind" className="block text-xs font-medium text-slate-500 mb-1">
                      Tipo de comprobante
                    </label>
                    <select
                      id="pay-tukifac-kind"
                      value={payTukifacKind}
                      onChange={(ev) =>
                        setPayTukifacKind(ev.target.value as 'boleta' | 'factura' | 'sale_note')
                      }
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    >
                      <option value="sale_note">Nota de venta</option>
                      <option value="boleta">Boleta</option>
                      <option value="factura">Factura</option>
                    </select>
                  </div>
                  {payTukifacKind === 'sale_note' ? (
                    <div>
                      <label htmlFor="pay-tukifac-nv" className="block text-xs font-medium text-slate-500 mb-1">
                        Serie (nota de venta)
                      </label>
                      <select
                        id="pay-tukifac-nv"
                        value={payTukifacSaleNoteSeriesId}
                        onChange={(ev) => setPayTukifacSaleNoteSeriesId(ev.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                      >
                        <option value="">Seleccione…</option>
                        {getCachedSaleNoteSeries().map((r) => (
                          <option key={r.id} value={String(r.id)}>
                            {r.number}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="pay-tukifac-serie" className="block text-xs font-medium text-slate-500 mb-1">
                        Serie (SUNAT)
                      </label>
                      <select
                        id="pay-tukifac-serie"
                        value={payTukifacSerie}
                        onChange={(ev) => setPayTukifacSerie(ev.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                      >
                        <option value="">Seleccione…</option>
                        {getCachedDocumentSeries()
                          .filter(
                            (r) =>
                              (r.document_type_id ?? '').trim() ===
                              (payTukifacKind === 'factura' ? '01' : '03'),
                          )
                          .map((r) => (
                            <option key={r.id} value={r.number}>
                              {r.number}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : null}

              {payError ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{payError}</div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <div className="text-xs font-medium text-slate-500">Monto</div>
                  <div className="mt-1 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-800 font-semibold">
                    S/ {(payBalance ?? payDoc.total_amount).toFixed(2)}
                    {payLoadingDoc ? <span className="ml-2 text-xs text-slate-400">Calculando...</span> : null}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(ev) => setPayDate(ev.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Método</label>
                  <SearchableSelect
                    value={payMethod}
                    onChange={setPayMethod}
                    options={payMethodOptions}
                    placeholder="Selecciona…"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Referencia</label>
                  <input
                    type="text"
                    value={payReference}
                    onChange={(ev) => setPayReference(ev.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    placeholder="Opcional"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Comprobante</label>
                  <input
                    id="pay-attachment"
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={payUploading}
                    onChange={(ev) => {
                      const file = ev.target.files?.[0] ?? null;
                      handlePayAttachmentSelect(file);
                      ev.currentTarget.value = '';
                    }}
                    className="hidden"
                  />

                  <label
                    htmlFor="pay-attachment"
                    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition cursor-pointer ${
                      payUploading
                        ? 'border-slate-200 bg-slate-50 opacity-70 cursor-not-allowed'
                        : payAttachmentFile
                          ? 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50'
                          : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`inline-flex items-center justify-center w-10 h-10 rounded-xl border ${
                          payAttachmentFile ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <i
                          className={`fas ${
                            payUploading ? 'fa-spinner fa-spin' : payAttachmentFile ? 'fa-check' : 'fa-cloud-upload-alt'
                          } text-slate-600`}
                        ></i>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">
                          {payUploading
                            ? 'Subiendo comprobante...'
                            : payAttachmentName
                              ? payAttachmentName
                              : 'Subir comprobante'}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {payAttachmentFile ? 'Listo para subir al guardar' : 'JPG, PNG o PDF'}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-xs font-semibold text-primary-700">Elegir</div>
                  </label>

                  {payAttachmentFile ? (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPayAttachmentName('');
                          setPayAttachmentFile(null);
                        }}
                        className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700"
                      >
                        <i className="fas fa-times"></i>
                        <span>Quitar</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Notas</label>
                  <textarea
                    value={payNotes}
                    onChange={(ev) => setPayNotes(ev.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[96px]"
                    placeholder="Opcional"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closePayModal}
                  className="inline-flex items-center px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={paySaving || payUploading || payLoadingDoc || (payBalance !== null && payBalance <= 0)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 transition disabled:opacity-60"
                >
                  {paySaving ? <i className="fas fa-spinner fa-spin text-xs"></i> : <i className="fas fa-save text-xs"></i>}
                  <span>Registrar pago</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
            document.body,
          )
        : null}

      {debtsCompanyModalOpen && debtsCompanySummary
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={closeDebtsCompanyModal}
                aria-label="Cerrar"
              />
              <div className="relative w-full max-w-5xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[min(92vh,760px)]">
                <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-slate-100 shrink-0">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-slate-800">Deudas de la empresa</h3>
                    <p className="text-xs text-slate-500 truncate">
                      {debtsCompanySummary.company?.business_name?.trim()
                        ? debtsCompanySummary.company.business_name
                        : `Empresa #${debtsCompanySummary.company_id}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeDebtsCompanyModal}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
                    aria-label="Cerrar"
                  >
                    <i className="fas fa-times text-xs" />
                  </button>
                </div>
                <div className="px-2 sm:px-4 py-3 overflow-y-auto flex-1 min-h-0">
                  {debtsCompanyError ? (
                    <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm mb-3">
                      {debtsCompanyError}
                    </div>
                  ) : null}
                  {debtsCompanyLoading ? (
                    <div className="py-12 text-center text-sm text-slate-500">
                      <i className="fas fa-spinner fa-spin mr-2" />
                      Cargando deudas…
                    </div>
                  ) : debtsCompanyDocs.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500">No hay deudas en este criterio.</div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-100">
                      <table className="min-w-full text-sm text-left">
                        <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Fecha</th>
                            <th className="px-3 py-2">Tipo</th>
                            <th className="px-3 py-2 whitespace-nowrap">Periodo</th>
                            <th className="px-3 py-2">Número</th>
                            <th className="px-3 py-2 text-right">Monto</th>
                            <th className="px-3 py-2">Estado</th>
                            <th className="px-3 py-2 text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {debtsCompanyDocs.map((doc) => (
                            <tr key={doc.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-700">
                                {doc.issue_date ? doc.issue_date.slice(0, 10) : '—'}
                              </td>
                              <td className="px-3 py-2 text-slate-700">{debtTypeCell(doc)}</td>
                              <td className="px-3 py-2 text-slate-600 font-mono text-xs tabular-nums whitespace-nowrap">
                                {formatDebtPeriod(doc)}
                              </td>
                              <td className="px-3 py-2 text-slate-700 font-mono text-xs">
                                {documentDebtNumber(doc)}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-800 font-semibold whitespace-nowrap">
                                S/ {doc.total_amount.toFixed(2)}
                              </td>
                              <td className="px-3 py-2">
                                {(() => {
                                  const dueDate = doc.due_date ? new Date(doc.due_date) : null;
                                  const isOverdue = Boolean(
                                    dueDate &&
                                      Number.isFinite(dueDate.getTime()) &&
                                      dueDate.getTime() < Date.now() &&
                                      doc.status !== 'pagado' &&
                                      doc.status !== 'anulado',
                                  );
                                  const label = isOverdue ? 'vencido' : doc.status;
                                  const cls =
                                    label === 'pendiente'
                                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                      : label === 'parcial'
                                        ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                        : label === 'pagado'
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                          : label === 'anulado'
                                            ? 'bg-slate-50 text-slate-700 border border-slate-200'
                                            : 'bg-red-50 text-red-700 border border-red-200';
                                  return (
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
                                    >
                                      {label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  {doc.status !== 'pagado' && doc.status !== 'anulado' && canCreatePayment ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        closeDebtsCompanyModal();
                                        void openPayModal(doc);
                                      }}
                                      className="inline-flex items-center px-2.5 py-1 rounded-full border border-emerald-200 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50"
                                    >
                                      <i className="fas fa-hand-holding-usd mr-1" />
                                      Pagar
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => void openItemsModal(doc)}
                                    className="inline-flex items-center px-2.5 py-1 rounded-full border border-slate-200 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    <i className="fas fa-list-ul mr-1" />
                                    Ítems
                                  </button>
                                  {canUpsert ? (
                                    <Link
                                      to={`/documents/${doc.id}/edit`}
                                      className="inline-flex items-center px-2.5 py-1 rounded-full border border-slate-300 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                      <i className="fas fa-pen mr-1" />
                                      Editar
                                    </Link>
                                  ) : null}
                                  {canDelete ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        closeDebtsCompanyModal();
                                        setDeleteTarget(doc);
                                      }}
                                      className="inline-flex items-center px-2.5 py-1 rounded-full border border-red-200 text-[11px] font-medium text-red-700 hover:bg-red-50"
                                    >
                                      <i className="fas fa-trash mr-1" />
                                      Eliminar
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {itemsModalOpen && itemsModalDoc
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={closeItemsModal}
                aria-label="Cerrar"
              />
              <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[min(90vh,560px)]">
                <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-slate-100 shrink-0">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-slate-800">Ítems de la deuda</h3>
                    <p className="text-xs text-slate-500 truncate">
                      {itemsModalDoc.company?.business_name ?? '—'} · {getDocumentTypeLabel(itemsModalDoc.type)}{' '}
                      <span className="font-mono">{documentDebtNumber(itemsModalDoc)}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeItemsModal}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
                    aria-label="Cerrar"
                  >
                    <i className="fas fa-times text-xs" />
                  </button>
                </div>
                <div className="px-4 sm:px-5 py-4 overflow-y-auto flex-1 min-h-0 space-y-3">
                  {itemsModalError ? (
                    <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{itemsModalError}</div>
                  ) : null}
                  {itemsModalLoading ? (
                    <div className="py-10 text-center text-sm text-slate-500">
                      <i className="fas fa-spinner fa-spin mr-2" />
                      Cargando…
                    </div>
                  ) : itemsModalDetail?.items && itemsModalDetail.items.length > 0 ? (
                    <>
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-semibold uppercase text-slate-500 border-b border-slate-100">
                            <th className="py-2 pr-2">Descripción</th>
                            <th className="py-2 text-right whitespace-nowrap w-28">Monto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {itemsModalDetail.items.map((it) => (
                            <tr key={it.id}>
                              <td className="py-2.5 pr-2 text-slate-800">{it.description}</td>
                              <td className="py-2.5 text-right font-medium tabular-nums text-slate-900">
                                S/{' '}
                                {it.amount.toLocaleString('es-PE', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex justify-between items-baseline pt-2 border-t border-slate-100 text-sm">
                        <span className="font-semibold text-slate-700">Total</span>
                        <span className="text-base font-bold text-slate-900 tabular-nums">
                          S/{' '}
                          {itemsModalDetail.total_amount.toLocaleString('es-PE', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-600 space-y-2">
                      <p>
                        Esta deuda no tiene líneas guardadas en el catálogo (registros anteriores o carga única). El monto
                        total es:
                      </p>
                      <p className="text-lg font-semibold tabular-nums text-slate-900">
                        S/{' '}
                        {(itemsModalDetail ?? itemsModalDoc).total_amount.toLocaleString('es-PE', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                      {(itemsModalDetail ?? itemsModalDoc).description?.trim() ? (
                        <p className="text-xs text-slate-500 pt-1 border-t border-slate-100">
                          {(itemsModalDetail ?? itemsModalDoc).description?.trim()}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Eliminar deuda"
        message={deleteTarget ? deleteConfirmMessage(deleteTarget) : ''}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        danger
        loading={deleteLoading}
        onClose={() => {
          if (!deleteLoading) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDeleteDebt()}
      />
    </div>
  );
};

export default Documents;
