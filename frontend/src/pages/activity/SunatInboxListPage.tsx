import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import ActivityPeriodFilter from '../../components/activity/ActivityPeriodFilter';
import {
  MailboxCaptureSlotCell,
  MailboxCaptureSlotHeader,
} from '../../components/activity/MailboxCaptureSlotCell';
import {
  mailboxStatusBadgeClass,
  mailboxStatusLabel,
  MAILBOX_LIST_STATUS_FILTER,
} from '../../components/activity/sunatInboxConfig';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  activityModulePath,
  workspaceHomePath,
  type ActivityWorkspace,
} from '../../navigation/activityRoutes';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import {
  sunatInboxService,
  type MailboxType,
  type SunatInboxListMeta,
  type SunatInboxListRow,
} from '../../services/sunatInbox';
import { currentPeriodYM } from '../../utils/supervisorLabels';
import { defaultWeekStartForPeriod, formatMailboxWeekContext, formatWeekOptionLabel, weeksInPeriodYM } from '../../utils/mailboxWeek';
import { countMailboxWeekProgress, summarizeMailboxSlots } from '../../utils/mailboxCaptureUtils';
import { extractApiErrorMessage } from '../../utils/apiError';
import { exportSunatInboxReportExcel } from '../../utils/sunatInboxExcelExport';

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type SunatInboxListPageProps = {
  workspace: ActivityWorkspace;
};

const TH = 'px-3 py-3 text-left text-xs font-semibold uppercase text-slate-500';
const TD = 'px-3 py-3 text-sm text-slate-700 border-t border-slate-100 align-top';

const SunatInboxListPage = ({ workspace }: SunatInboxListPageProps) => {
  const homePath = workspaceHomePath(workspace);
  const canUpload = useMemo(
    () => workspace === 'assistant' && auth.hasPermission(P.supervisorsAttachmentsUpload),
    [workspace],
  );
  const canVerify = useMemo(
    () => workspace === 'supervisor' && auth.hasPermission(P.supervisorsDeclarationsApprove),
    [workspace],
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const initialPeriod = searchParams.get('period_ym') || currentPeriodYM();
  const initialWeek =
    searchParams.get('week_start') || defaultWeekStartForPeriod(initialPeriod);

  const [periodYm, setPeriodYm] = useState(initialPeriod);
  const [weekStart, setWeekStart] = useState(initialWeek);
  const [meta, setMeta] = useState<SunatInboxListMeta | null>(null);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [rows, setRows] = useState<SunatInboxListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  const capturesPerWeek = meta?.captures_per_week ?? 2;
  const weekOptions = meta?.weeks?.length ? meta.weeks : weeksInPeriodYM(periodYm);
  const selectedWeek = useMemo(
    () => weekOptions.find((w) => w.week_start === weekStart),
    [weekOptions, weekStart],
  );
  const weekContextLabel = formatMailboxWeekContext(selectedWeek, capturesPerWeek, periodYm);

  const weekProgress = useMemo(() => {
    const acc = { total: 0, pendiente: 0, cargado: 0, verificado: 0 };
    for (const row of rows) {
      const p = countMailboxWeekProgress(row.slots);
      acc.total += p.total;
      acc.pendiente += p.pendiente;
      acc.cargado += p.cargado;
      acc.verificado += p.verificado;
    }
    return acc;
  }, [rows]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('period_ym', periodYm);
        next.set('week_start', weekStart);
        return next;
      },
      { replace: true },
    );
  }, [periodYm, weekStart, setSearchParams]);

  const handlePeriodChange = (nextPeriod: string) => {
    setPeriodYm(nextPeriod);
    setWeekStart(defaultWeekStartForPeriod(nextPeriod));
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await sunatInboxService.list({
        period_ym: periodYm,
        week_start: weekStart,
        q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
        status: statusFilter || undefined,
        page,
        per_page: perPage,
      });
      setMeta(res.meta);
      setRows(res.data ?? []);
      setTotal(res.pagination?.total ?? 0);
      if (res.meta?.week_start && res.meta.week_start !== weekStart) {
        setWeekStart(res.meta.week_start);
      }
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar el Buzón SOL.'));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [periodYm, weekStart, debouncedQ, statusFilter, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [periodYm, weekStart, debouncedQ, statusFilter]);

  const detailLink = (companyId: number) => {
    const path = `${activityModulePath(workspace, 'sunat-inbox')}/${companyId}`;
    return `${path}?period_ym=${encodeURIComponent(periodYm)}&week_start=${encodeURIComponent(weekStart)}`;
  };

  const patchRowSlot = (companyId: number, updatedSlotIndex: number, slotData: SunatInboxListRow['slots'][0]) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.company_id !== companyId) return row;
        const slots = row.slots.map((s) => (s.slot_index === updatedSlotIndex ? slotData : s));
        return { ...row, slots, summary_status: summarizeMailboxSlots(slots) };
      }),
    );
  };

  const handleUpload = async (companyId: number, slotIndex: number, mailboxType: MailboxType, file: File) => {
    try {
      setMsg('');
      const slot = await sunatInboxService.uploadCapture(companyId, slotIndex, file, mailboxType, periodYm, weekStart);
      patchRowSlot(companyId, slotIndex, slot);
      setMsg('Archivo subido correctamente.');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'Error al subir archivo.'));
    }
  };

  const handleVerify = async (companyId: number, slotId: number, mailboxType: MailboxType) => {
    if (!slotId) {
      setVerifyError('No hay slot de captura registrado. Abra el detalle de la empresa primero.');
      return;
    }
    try {
      setMsg('');
      setVerifyError('');
      const slot = await sunatInboxService.verifyCapture(slotId, mailboxType);
      patchRowSlot(companyId, slot.slot_index, slot);
      setMsg('Buzón verificado.');
    } catch (err) {
      const text = extractApiErrorMessage(err, 'No se pudo verificar.');
      setVerifyError(text);
      setMsg('');
    }
  };

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    try {
      setExportingExcel(true);
      setError('');
      const qParam = debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined;
      const { captures_per_week, weeks, weeksData } = await sunatInboxService.fetchAllWeeksData({
        period_ym: periodYm,
        q: qParam,
        status: statusFilter || undefined,
      });
      await exportSunatInboxReportExcel({
        periodYm,
        weeks,
        weeksData,
        capturesPerWeek: captures_per_week,
        workspace,
      });
      setMsg('Excel generado correctamente.');
    } catch (err) {
      const text = extractApiErrorMessage(err, 'No se pudo exportar a Excel.');
      setError(text);
    } finally {
      setExportingExcel(false);
    }
  };

  const slotIndices = useMemo(
    () => Array.from({ length: capturesPerWeek }, (_, i) => i + 1),
    [capturesPerWeek],
  );

  const fixedColSpan = 7;
  const totalCols = fixedColSpan + capturesPerWeek;

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Buzón SOL SUNAT – SUNAFIL</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Capturas por semana laborable (lun–sáb). Configuración actual: {capturesPerWeek} carga
          {capturesPerWeek === 1 ? '' : 's'} por semana en Ajustes.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
        <ActivityPeriodFilter value={periodYm} onChange={handlePeriodChange} />
        <div className="min-w-[14rem]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Semana</label>
          <select
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          >
            {(weekOptions.length ? weekOptions : [{ week_start: weekStart, week_index: 1, label: 'Semana 1' }]).map((w) => (
              <option key={w.week_start} value={w.week_start}>
                {formatWeekOptionLabel(w)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Buscar</label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="RUC, razón social o código (mín. 2 caracteres)…"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="min-w-[12rem]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Filtrar empresas</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          >
            {MAILBOX_LIST_STATUS_FILTER.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {!loading && weekProgress.total > 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 shrink-0 min-w-[11rem]">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Buzones (página)</p>
            <p className="text-xs text-slate-700 mt-0.5 tabular-nums leading-snug">
              <span className="text-emerald-700">{weekProgress.verificado} verif.</span>
              {' · '}
              <span className="text-blue-700">{weekProgress.cargado} por verif.</span>
              {' · '}
              <span className="text-slate-600">{weekProgress.pendiente} pend.</span>
            </p>
          </div>
        ) : null}
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 shrink-0 min-w-[9rem]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Empresas</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums leading-tight">{loading ? '—' : total}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleExportExcel()}
          disabled={loading || exportingExcel}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50 shrink-0"
        >
          <i className={`fas ${exportingExcel ? 'fa-spinner fa-spin' : 'fa-file-excel'} text-xs`} aria-hidden />
          Excel
        </button>
      </div>

      {verifyError ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{verifyError}</div>
      ) : null}

      {msg ? (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">{msg}</div>
      ) : null}

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm max-w-full">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/80 text-xs text-slate-600">
          {weekContextLabel}
        </div>
        <div className="overflow-x-auto max-w-full custom-scrollbar">
          <table className="w-max min-w-full text-left table-auto">
            <thead className="bg-slate-50">
              <tr>
                <th className={`${TH} sticky left-0 z-10 bg-slate-50`}>Código</th>
                <th className={TH}>Dígito</th>
                <th className={TH}>Razón social</th>
                <th className={TH}>RUC</th>
                <th className={TH}>Asistente</th>
                <th className={TH}>Resumen</th>
                <th className={TH} />
                {slotIndices.map((idx) => (
                  <MailboxCaptureSlotHeader key={idx} slotIndex={idx} totalSlots={capturesPerWeek} />
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.company_id} className="hover:bg-slate-50/80">
                    <td className={`${TD} font-mono sticky left-0 z-10 bg-white`}>{row.code || '—'}</td>
                    <td className={TD}>{row.dig || '—'}</td>
                    <td className={`${TD} max-w-[12rem] font-medium`} title={row.business_name}>
                      <span className="block truncate">{row.business_name || '—'}</span>
                    </td>
                    <td className={`${TD} font-mono whitespace-nowrap`}>{row.ruc || '—'}</td>
                    <td className={TD}>{row.assistant_username || '—'}</td>
                    <td className={TD}>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${mailboxStatusBadgeClass(row.summary_status)}`}
                      >
                        {mailboxStatusLabel(row.summary_status)}
                      </span>
                    </td>
                    <td className={TD}>
                      <Link
                        to={detailLink(row.company_id)}
                        className="text-primary-700 text-sm font-medium hover:underline whitespace-nowrap"
                      >
                        Detalle
                      </Link>
                    </td>
                    {slotIndices.map((idx) => {
                      const slot = row.slots.find((s) => s.slot_index === idx) ?? {
                        slot_index: idx,
                        sunat: { status: 'pendiente' },
                        sunafil: { status: 'pendiente' },
                      };
                      return (
                        <td key={idx} className="px-2 py-2 text-sm text-slate-700 border-t border-slate-100 align-top min-w-[36.5rem] w-[36.5rem]">
                          <MailboxCaptureSlotCell
                            slot={slot}
                            canUpload={canUpload}
                            canVerify={canVerify}
                            uploadKey={`${row.company_id}-${weekStart}`}
                            onUpload={(slotIndex, mailboxType, file) =>
                              handleUpload(row.company_id, slotIndex, mailboxType, file)
                            }
                            onVerify={(slotId, mailboxType) =>
                              handleVerify(row.company_id, slotId, mailboxType)
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(next) => {
          setPerPage(next);
          setPage(1);
        }}
      />

      <p className="text-xs text-slate-400">
        <Link to={homePath} className="text-primary-700 hover:underline">
          ← Volver
        </Link>
      </p>
    </div>
  );
};

export default SunatInboxListPage;
