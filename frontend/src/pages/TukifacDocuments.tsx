import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../services/auth';
import { documentsService } from '../services/documents';
import SearchableSelect from '../components/SearchableSelect';

type TukifacDocument = {
  id: number;
  date_of_issue?: string;
  date_of_due?: string;
  number?: string;
  customer_name?: string;
  customer_number?: string;
  currency_type_id?: string;
  total?: number | string;
  state_type_description?: string;
  document_type_description?: string;
  has_xml?: boolean;
  has_pdf?: boolean;
  has_cdr?: boolean;
  download_xml?: string;
  download_pdf?: string;
  download_cdr?: string;
};

const sanitizeUrl = (value?: string) => (value ?? '').replace(/`/g, '').trim();

function formatDocTotal(doc: TukifacDocument): string {
  const t = doc.total;
  if (typeof t === 'number' && Number.isFinite(t)) return t.toFixed(2);
  if (typeof t === 'string' && t.trim() !== '') return t.trim();
  return '—';
}

function DownloadLinks({ doc, compact }: { doc: TukifacDocument; compact?: boolean }) {
  const xml = sanitizeUrl(doc.download_xml);
  const pdf = sanitizeUrl(doc.download_pdf);
  const cdr = sanitizeUrl(doc.download_cdr);
  const btn =
    compact === true
      ? 'inline-flex items-center justify-center min-h-[40px] min-w-[40px] px-2 py-1.5 rounded-lg border text-xs font-medium'
      : 'inline-flex items-center px-3 py-1.5 rounded-full border text-xs font-medium';
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'justify-start' : 'justify-end'}`}>
      {doc.has_pdf && pdf ? (
        <a href={pdf} target="_blank" rel="noreferrer" className={`${btn} border-red-200 text-red-700 hover:bg-red-50`} title="PDF">
          <i className="fas fa-file-pdf sm:mr-1"></i>
          <span className="hidden sm:inline">PDF</span>
        </a>
      ) : null}
      {doc.has_xml && xml ? (
        <a href={xml} target="_blank" rel="noreferrer" className={`${btn} border-slate-200 text-slate-700 hover:bg-slate-50`} title="XML">
          <i className="fas fa-file-code sm:mr-1"></i>
          <span className="hidden sm:inline">XML</span>
        </a>
      ) : null}
      {doc.has_cdr && cdr ? (
        <a href={cdr} target="_blank" rel="noreferrer" className={`${btn} border-emerald-200 text-emerald-700 hover:bg-emerald-50`} title="CDR">
          <i className="fas fa-file-archive sm:mr-1"></i>
          <span className="hidden sm:inline">CDR</span>
        </a>
      ) : null}
      {!doc.has_pdf && !doc.has_xml && !doc.has_cdr ? <span className="text-slate-400 text-xs py-2">—</span> : null}
    </div>
  );
}

type TukifacSourceTab = 'invoices' | 'sale_notes';

const TukifacDocuments = () => {
  const role = auth.getRole() ?? '';
  const canView = useMemo(
    () => role === 'Administrador' || role === 'Supervisor' || role === 'Contador' || role === 'Asistente',
    [role],
  );
  const [documents, setDocuments] = useState<TukifacDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [sourceTab, setSourceTab] = useState<TukifacSourceTab>('invoices');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState('20');

  const perPageNum = useMemo(() => {
    const n = Number.parseInt(perPage, 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
  }, [perPage]);

  const totalItems = documents.length;
  const totalPages = useMemo(() => {
    if (totalItems <= 0) return 1;
    return Math.max(1, Math.ceil(totalItems / perPageNum));
  }, [perPageNum, totalItems]);

  const pagedDocuments = useMemo(() => {
    if (totalItems <= 0) return [];
    const start = (page - 1) * perPageNum;
    const end = start + perPageNum;
    return documents.slice(start, end);
  }, [documents, page, perPageNum, totalItems]);

  const pageInfo = useMemo(() => {
    if (totalItems <= 0) return { from: 0, to: 0 };
    const from = (page - 1) * perPageNum + 1;
    const to = Math.min(totalItems, page * perPageNum);
    return { from, to };
  }, [page, perPageNum, totalItems]);

  const loadList = useCallback(
    async (range?: { start_date?: string; end_date?: string }) => {
      if (!canView) return;
      try {
        setLoading(true);
        setError('');
        const list =
          sourceTab === 'sale_notes'
            ? await documentsService.listTukifacSaleNotes<TukifacDocument>(range ?? {})
            : await documentsService.listTukifacDocuments<TukifacDocument>(range ?? {});
        setDocuments(list);
        setPage(1);
      } catch (e) {
        console.error(e);
        const err = e as { response?: { data?: { error?: string } } };
        const msg = err?.response?.data?.error
          ? String(err.response.data.error)
          : sourceTab === 'sale_notes'
            ? 'Error al cargar notas de venta desde Tukifac'
            : 'Error al cargar documentos de Tukifac';
        setError(msg);
        setDocuments([]);
      } finally {
        setLoading(false);
      }
    },
    [canView, sourceTab],
  );

  const runSync = async (kind: 'invoices' | 'sale_notes') => {
    if ((startDate && !endDate) || (!startDate && endDate)) {
      setError('Debe enviar fecha inicio y fecha fin');
      return;
    }
    const params = startDate && endDate ? { start_date: startDate, end_date: endDate } : {};
    try {
      setSyncing(true);
      setError('');
      const res =
        kind === 'sale_notes'
          ? await documentsService.syncTukifacSaleNotes(params)
          : await documentsService.syncTukifac(params);
      const count = res.receipts_processed ?? res.documents_processed ?? 0;
      const companies = res.companies_created || 0;
      const suffix = companies > 0 ? ` (${companies} empresas creadas)` : '';
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: {
            type: 'success',
            message: `${res.message || 'Sincronización completada'} (${count} registros)${suffix}. Puedes conciliar en Conciliación Tukifac.`,
          },
        }),
      );
    } catch (e) {
      console.error(e);
      const err = e as { response?: { data?: { error?: string } } };
      const msg = err?.response?.data?.error ? String(err.response.data.error) : 'Error al sincronizar con Tukifac';
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'error', message: msg } }));
      setError(msg);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      setDocuments([]);
      return;
    }
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : undefined;
    void loadList(range);
    // Fechas: solo al cambiar de pestaña o permisos; para filtrar fechas usa el formulario "Filtrar".
  }, [canView, sourceTab, loadList]);

  useEffect(() => {
    if (totalItems <= 0) {
      if (page !== 1) setPage(1);
      return;
    }
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [page, totalItems, totalPages]);

  return (
    <div className="space-y-3 sm:space-y-4 w-full min-w-0 max-w-full">
      {/* Encabezado siempre en columna: evita columna estrecha + hueco vacío en tablets */}
      <header className="w-full min-w-0 space-y-2 sm:space-y-3">
        <div className="w-full min-w-0">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-800 pr-1">Documentos Tukifac</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-2 leading-relaxed text-pretty max-w-none w-full">
            Al sincronizar, los registros pasan a Conciliación Tukifac para imputar pagos contra las deudas del cliente. La emisión de
            comprobantes hacia Tukifac se hace al registrar el pago de una liquidación emitida (formulario de pagos), con ítems según las
            imputaciones del pago.
          </p>
        </div>
      </header>

      {!canView ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No tienes permisos para acceder a esta pantalla
        </div>
      ) : null}

      {error ? (
        <div className="p-3 sm:p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs sm:text-sm break-words">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Pestañas + acciones: un solo bloque tipo panel */}
        <div className="border-b border-slate-200 bg-slate-50/90">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-4 px-2 sm:px-3 pt-2 pb-0 min-w-0">
            <nav className="min-w-0 flex-1" aria-label="Tipo de documentos en Tukifac">
              <div role="tablist" className="flex gap-0.5 sm:gap-1">
                <button
                  type="button"
                  role="tab"
                  id="tab-tukifac-invoices"
                  aria-selected={sourceTab === 'invoices'}
                  aria-controls="tukifac-list-panel"
                  onClick={() => setSourceTab('invoices')}
                  className={`inline-flex items-center justify-center gap-2 rounded-t-lg border px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold transition min-h-[44px] sm:min-h-[46px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                    sourceTab === 'invoices'
                      ? 'relative z-[1] -mb-px border-slate-200 border-b-white bg-white text-primary-800 shadow-[0_-1px_0_0_white]'
                      : 'border-transparent border-b-0 text-slate-600 hover:bg-white/60 hover:text-slate-900'
                  }`}
                >
                  <i className="fas fa-file-invoice text-[11px] sm:text-xs opacity-90 shrink-0" aria-hidden />
                  <span className="whitespace-nowrap sm:hidden">Fact. / Boletas</span>
                  <span className="whitespace-nowrap hidden sm:inline">Facturas y boletas</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id="tab-tukifac-sale-notes"
                  aria-selected={sourceTab === 'sale_notes'}
                  aria-controls="tukifac-list-panel"
                  onClick={() => setSourceTab('sale_notes')}
                  className={`inline-flex items-center justify-center gap-2 rounded-t-lg border px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold transition min-h-[44px] sm:min-h-[46px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                    sourceTab === 'sale_notes'
                      ? 'relative z-[1] -mb-px border-slate-200 border-b-white bg-white text-primary-800 shadow-[0_-1px_0_0_white]'
                      : 'border-transparent border-b-0 text-slate-600 hover:bg-white/60 hover:text-slate-900'
                  }`}
                >
                  <i className="fas fa-receipt text-[11px] sm:text-xs opacity-90 shrink-0" aria-hidden />
                  <span className="whitespace-nowrap sm:hidden">Notas venta</span>
                  <span className="whitespace-nowrap hidden sm:inline">Notas de venta</span>
                </button>
              </div>
            </nav>
            <div
              className="flex flex-wrap items-center gap-2 pb-2 lg:pb-3 lg:self-center shrink-0 lg:border-l lg:border-slate-200/80 lg:pl-4"
              aria-label="Acciones del listado"
            >
              <Link
                to="/documents/fiscal-receipts"
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-50 transition"
              >
                <i className="fas fa-link text-[11px] shrink-0" aria-hidden />
                <span>Conciliación</span>
              </Link>
              <button
                type="button"
                onClick={() => runSync(sourceTab === 'sale_notes' ? 'sale_notes' : 'invoices')}
                disabled={loading || syncing}
                title={sourceTab === 'sale_notes' ? 'Sincronizar notas de venta' : 'Sincronizar comprobantes'}
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-2 rounded-lg border border-primary-200 bg-white text-primary-700 text-xs sm:text-sm font-medium hover:bg-primary-50 transition disabled:opacity-60"
              >
                <i className={`fas ${syncing ? 'fa-spinner fa-spin' : 'fa-cloud-download-alt'} text-[11px] shrink-0`} aria-hidden />
                <span>{syncing ? 'Sincronizando…' : 'Sincronizar'}</span>
              </button>
              <button
                type="button"
                onClick={() => loadList(startDate && endDate ? { start_date: startDate, end_date: endDate } : undefined)}
                disabled={loading || syncing}
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-50 transition disabled:opacity-60"
              >
                <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-sync-alt'} text-[11px] shrink-0`} aria-hidden />
                <span>Actualizar</span>
              </button>
            </div>
          </div>
        </div>

        <div
          id="tukifac-list-panel"
          role="tabpanel"
          aria-labelledby={sourceTab === 'sale_notes' ? 'tab-tukifac-sale-notes' : 'tab-tukifac-invoices'}
        >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!startDate && !endDate) {
            void loadList(undefined);
            return;
          }
          if (!startDate || !endDate) {
            setError('Debe enviar fecha inicio y fecha fin');
            return;
          }
          void loadList({ start_date: startDate, end_date: endDate });
        }}
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end border-b border-slate-100 bg-white px-3 py-3 sm:p-4"
      >
        <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3 w-full min-w-0 md:flex-1">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Desde</label>
            <input
              type="date"
              value={startDate}
              onChange={(ev) => setStartDate(ev.target.value)}
              disabled={loading}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">Hasta</label>
            <input
              type="date"
              value={endDate}
              onChange={(ev) => setEndDate(ev.target.value)}
              disabled={loading}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
            />
          </div>
        </div>
        <div className="flex flex-col min-[400px]:flex-row gap-2 w-full sm:w-auto shrink-0">
          <button
            type="submit"
            disabled={loading || syncing}
            className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 disabled:opacity-60 flex-1 min-[400px]:flex-none"
          >
            <i className="fas fa-filter mr-2 text-xs"></i>
            <span>Filtrar</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStartDate('');
              setEndDate('');
              void loadList(undefined);
            }}
            disabled={loading || syncing}
            className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 rounded-full border border-slate-200 bg-white text-slate-700 text-sm font-medium shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 disabled:opacity-60 flex-1 min-[400px]:flex-none"
          >
            <i className="fas fa-times mr-2 text-xs"></i>
            <span>Limpiar</span>
          </button>
        </div>
      </form>

      <div className="bg-white overflow-hidden">
        <div className="flex flex-col gap-3 px-3 py-3 sm:px-4 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="text-xs text-slate-500 min-w-0">
            {loading ? (
              <span className="inline-flex items-center gap-2 text-slate-600">
                <i className="fas fa-spinner fa-spin" aria-hidden />
                {sourceTab === 'sale_notes' ? 'Cargando notas de venta…' : 'Cargando comprobantes…'}
              </span>
            ) : totalItems > 0 ? (
              <span className="leading-relaxed">
                <span className="font-semibold text-slate-700">
                  {pageInfo.from}–{pageInfo.to}
                </span>
                <span className="text-slate-400"> / </span>
                <span className="font-semibold text-slate-700">{totalItems}</span>
                <span className="hidden sm:inline"> registros</span>
              </span>
            ) : (
              <span>Sin registros</span>
            )}
          </div>

          <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-center min-[480px]:justify-end">
            <div className="flex items-center gap-2 w-full min-[480px]:w-auto">
              <span className="text-xs font-medium text-slate-500 shrink-0">Por página</span>
              <div className="flex-1 min-w-0 min-[480px]:flex-initial min-[480px]:min-w-[120px]">
                <SearchableSelect
                  value={perPage}
                  onChange={(v) => {
                    setPerPage(v || '20');
                    setPage(1);
                  }}
                  className="w-full"
                  options={[
                    { value: '10', label: '10' },
                    { value: '20', label: '20' },
                    { value: '50', label: '50' },
                    { value: '100', label: '100' },
                  ]}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <button
                type="button"
                disabled={loading || totalItems <= 0 || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] sm:min-w-0 px-3 py-2 rounded-full border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                aria-label="Página anterior"
              >
                <i className="fas fa-chevron-left sm:mr-1.5"></i>
                <span className="hidden sm:inline">Anterior</span>
              </button>
              <div className="text-xs text-slate-500 text-center px-1 tabular-nums">
                <span className="font-semibold text-slate-700">{page}</span>
                <span className="text-slate-400"> / </span>
                <span className="font-semibold text-slate-700">{totalPages}</span>
              </div>
              <button
                type="button"
                disabled={loading || totalItems <= 0 || page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] sm:min-w-0 px-3 py-2 rounded-full border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                aria-label="Página siguiente"
              >
                <span className="hidden sm:inline">Siguiente </span>
                <i className="fas fa-chevron-right sm:ml-1.5"></i>
              </button>
            </div>
          </div>
        </div>

        {/* Móvil / tablet: tarjetas */}
        <div className="lg:hidden divide-y divide-slate-100">
          {loading ? (
            <div className="px-4 py-10 text-center text-slate-500 text-sm">
              <i className="fas fa-spinner fa-spin mr-2"></i>
              {sourceTab === 'sale_notes' ? 'Cargando notas de venta...' : 'Cargando comprobantes...'}
            </div>
          ) : documents.length > 0 ? (
            pagedDocuments.map((doc) => (
              <div key={`${sourceTab}-${doc.id}-m`} className="p-4 space-y-3">
                <div className="flex justify-between gap-3 items-start min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{doc.number ?? '—'}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mt-0.5 line-clamp-2">
                      {doc.document_type_description ?? '—'}
                    </p>
                  </div>
                  <p className="text-right text-sm font-bold text-slate-800 tabular-nums shrink-0">
                    <span className="text-slate-500 font-normal text-xs block">{doc.currency_type_id ?? 'PEN'}</span>
                    {formatDocTotal(doc)}
                  </p>
                </div>
                <div className="text-sm min-w-0">
                  <p className="font-medium text-slate-800 break-words">{doc.customer_name ?? '—'}</p>
                  {doc.customer_number ? <p className="text-xs text-slate-500 font-mono mt-0.5">{doc.customer_number}</p> : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>
                    <span className="text-slate-400">Emisión </span>
                    {doc.date_of_issue ?? '—'}
                  </span>
                  <span>
                    <span className="text-slate-400">Venc. </span>
                    {doc.date_of_due ?? '—'}
                  </span>
                </div>
                {doc.state_type_description ? (
                  <p className="text-xs text-slate-600">
                    <span className="text-slate-400">Estado </span>
                    {doc.state_type_description}
                  </p>
                ) : null}
                <DownloadLinks doc={doc} compact />
              </div>
            ))
          ) : (
            <div className="px-4 py-10 text-center text-slate-500 text-sm">
              {loading
                ? 'Cargando...'
                : sourceTab === 'sale_notes'
                  ? 'No hay notas de venta en Tukifac para este criterio.'
                  : 'No hay comprobantes en Tukifac para este criterio.'}
            </div>
          )}
        </div>

        {/* Escritorio: tabla con scroll horizontal suave */}
        <div className="hidden lg:block overflow-x-auto overscroll-x-contain -mx-0 [scrollbar-gutter:stable]">
          <table className="w-full min-w-[920px] text-sm text-left">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">Emisión</th>
                <th className="px-4 py-3 whitespace-nowrap">Venc.</th>
                <th className="px-4 py-3 whitespace-nowrap">Número</th>
                <th className="px-4 py-3 min-w-[200px]">Cliente</th>
                <th className="px-4 py-3 min-w-[160px]">Tipo</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Total</th>
                <th className="px-4 py-3 min-w-[120px]">Estado</th>
                <th className="px-4 py-3 text-right min-w-[200px]">Descargas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    {sourceTab === 'sale_notes' ? 'Cargando notas de venta...' : 'Cargando comprobantes...'}
                  </td>
                </tr>
              ) : documents.length > 0 ? (
                pagedDocuments.map((doc) => (
                  <tr key={`${sourceTab}-${doc.id}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{doc.date_of_issue ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{doc.date_of_due ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium whitespace-nowrap">{doc.number ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="min-w-0 max-w-[280px]">
                        <div className="font-medium text-slate-800 truncate">{doc.customer_name ?? '—'}</div>
                        <div className="text-xs text-slate-500 truncate">{doc.customer_number ?? ''}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="text-xs font-semibold uppercase text-slate-500 line-clamp-2">
                        {doc.document_type_description ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-800 font-semibold tabular-nums whitespace-nowrap">
                      {doc.currency_type_id ?? '—'} {formatDocTotal(doc)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{doc.state_type_description ?? '—'}</td>
                    <td className="px-4 py-3">
                      <DownloadLinks doc={doc} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500 text-sm">
                    {loading
                      ? 'Cargando...'
                      : sourceTab === 'sale_notes'
                        ? 'No hay notas de venta en Tukifac para este criterio.'
                        : 'No hay comprobantes en Tukifac para este criterio.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
};

export default TukifacDocuments;
