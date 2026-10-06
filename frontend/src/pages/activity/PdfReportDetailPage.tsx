import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { resolveBackendUrl } from '../../api/client';
import {
  PDF_REPORT_MODULES,
  PDF_REPORT_TERMINAL_STATUSES,
  formatDateOnly,
  pdfReportDisplayStatus,
  todayDateStr,
} from '../../components/activity/pdfReportConfig';
import {
  computePdt601DueMeta,
  formatPdt601DueDetail,
  formatStoredAt,
  resolvePdt601DueDate,
} from '../../components/activity/pdt601Config';
import { timelinessBadgeClass, timelinessLabel } from '../../components/activity/timelinessConfig';
import FilePreviewModal from '../../components/FilePreviewModal';
import Button from '../../components/ui/Button';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activityModulePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { pdfReportService, type PdfReportDetail, type PdfReportSlug } from '../../services/pdfReports';
import { supervisorsService, type SupervisorAttachment, type SupervisorDeclaration } from '../../services/supervisors';
import { extractApiErrorMessage } from '../../utils/apiError';
import { downloadRemoteFile } from '../../utils/downloadFile';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';

type PdfReportDetailPageProps = {
  workspace: ActivityWorkspace;
  slug: PdfReportSlug;
};

type Tone = 'success' | 'error' | 'info';

const MAX_BYTES = 10 * 1024 * 1024;

function msgBannerClass(tone: Tone): string {
  if (tone === 'success') return 'bg-primary-50 border-primary-200 text-primary-800';
  if (tone === 'error') return 'bg-red-50 border-red-200 text-red-700';
  return 'bg-slate-50 border-slate-200 text-slate-700';
}
function msgBannerIcon(tone: Tone): string {
  if (tone === 'success') return 'fa-check-circle';
  if (tone === 'error') return 'fa-exclamation-circle';
  return 'fa-info-circle';
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Detalle de un módulo de informe en PDF (Informe detracciones / Siscont balances) para una empresa y
 * período. El asistente carga un solo PDF con su fecha de cumplimiento (cargar otro lo reemplaza; se
 * admite arrastrar y soltar); el supervisor lo aprueba ("Entregado") u observa con un motivo, y con el
 * permiso dedicado puede reabrir una entrega ya aprobada.
 */
const PdfReportDetailPage = ({ workspace, slug }: PdfReportDetailPageProps) => {
  const mod = PDF_REPORT_MODULES[slug];
  const { companyId: companyIdParam } = useParams();
  const companyId = Number(companyIdParam);
  const [searchParams] = useSearchParams();
  const periodYm = searchParams.get('period_ym') || previousMonthPeriodYM();
  const listPath = `${activityModulePath(workspace, mod.moduleId)}?period_ym=${encodeURIComponent(periodYm)}`;

  const canObserve = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsObserve), []);
  const canApprove = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsApprove), []);
  const canReopen = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsReopen), []);
  const canUpload = useMemo(() => auth.hasPermission(P.supervisorsAttachmentsUpload), []);

  const [detail, setDetail] = useState<PdfReportDetail | null>(null);
  const [attachment, setAttachment] = useState<SupervisorAttachment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [msgTone, setMsgTone] = useState<Tone>('info');
  const [fechaEntrega, setFechaEntrega] = useState(todayDateStr());
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const declaration = detail?.declaration;
  const suspendida = !!detail?.control_suspendida;
  const locked = !!declaration && PDF_REPORT_TERMINAL_STATUSES.has(declaration.status);
  const showRevisionSupervisor = workspace === 'supervisor' && (canApprove || canObserve);
  const canSubmit = canUpload && !locked && !suspendida;

  const showMsg = (text: string, tone: Tone = 'info') => {
    setMsg(text);
    setMsgTone(tone);
  };

  const loadAttachment = useCallback(async (declarationId: number) => {
    const rows = await supervisorsService.listAttachments(0, declarationId);
    // Listado por id descendente: el primero es el vigente (la regla de un solo archivo deja uno).
    setAttachment(rows[0] ?? null);
  }, []);

  const load = useCallback(async () => {
    if (!Number.isFinite(companyId) || companyId <= 0) {
      setError('Empresa inválida.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const data = await pdfReportService.getDetail(slug, companyId, periodYm);
      setDetail(data);
      await loadAttachment(data.declaration.id);
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar el detalle.'));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [slug, companyId, periodYm, loadAttachment]);

  useEffect(() => {
    void load();
  }, [load]);

  const display = useMemo(
    () =>
      pdfReportDisplayStatus({
        status: declaration?.status ?? '',
        suspendida,
        timeliness: detail?.timeliness,
      }),
    [declaration?.status, suspendida, detail?.timeliness],
  );

  const dueResolved = useMemo(() => {
    if (!detail || !declaration) return { dueDate: undefined, isOverdue: false, daysRemaining: null as number | null };
    const dueDate = resolvePdt601DueDate(detail.calendar_due_date);
    return { dueDate, ...computePdt601DueMeta(declaration.status, dueDate, false, suspendida) };
  }, [detail, declaration, suspendida]);

  const refreshDeclaration = (decl: SupervisorDeclaration) => {
    setDetail((d) => (d ? { ...d, declaration: { ...d.declaration, ...decl } } : d));
  };

  const handleFiles = async (files: FileList | null) => {
    if (!detail || !canSubmit || !files?.length) return;
    // Un solo archivo: si se sueltan varios, se rechaza en vez de elegir uno por el usuario.
    if (files.length > 1) {
      showMsg('Solo se puede cargar un archivo a la vez.', 'error');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    const file = files[0];
    if (!isPdf(file)) {
      showMsg('Solo se permite un archivo PDF.', 'error');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      showMsg('El archivo supera el máximo de 10 MB.', 'error');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      setUploading(true);
      showMsg('');
      const replaced = !!attachment;
      const updated = await pdfReportService.submit(slug, companyId, periodYm, file, fechaEntrega);
      setDetail(updated);
      await loadAttachment(updated.declaration.id);
      setFechaEntrega(todayDateStr());
      showMsg(
        replaced ? 'Archivo reemplazado — queda por revisar.' : 'Archivo cargado — queda por revisar.',
        'success',
      );
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'No se pudo cargar el archivo.'), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!canSubmit || uploading) return;
    void handleFiles(e.dataTransfer.files);
  };

  const handleApprove = async () => {
    if (!declaration || !canApprove) return;
    try {
      setActionLoading(true);
      showMsg('');
      refreshDeclaration(await supervisorsService.approveDeclaration(declaration.id));
      showMsg('Entrega aprobada.', 'success');
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'No se pudo aprobar.'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleObserve = async () => {
    if (!declaration || !canObserve) return;
    const notes = supervisorNotes.trim();
    if (!notes) {
      showMsg('Ingrese el texto de la observación.', 'error');
      return;
    }
    try {
      setActionLoading(true);
      showMsg('');
      refreshDeclaration(await supervisorsService.observeDeclaration(declaration.id, notes));
      setSupervisorNotes('');
      showMsg('Observación registrada.', 'success');
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'No se pudo observar.'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReopen = async () => {
    if (!declaration || !canReopen) return;
    const reason = reopenReason.trim();
    if (!reason) {
      showMsg('Ingrese el motivo de la reapertura.', 'error');
      return;
    }
    try {
      setActionLoading(true);
      showMsg('');
      refreshDeclaration(await supervisorsService.reopenDeclaration(declaration.id, reason));
      setReopenReason('');
      setReopenOpen(false);
      showMsg('Entrega reabierta — volvió a "Por revisar".', 'success');
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'No se pudo reabrir.'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`${PAGE_WORKSPACE_CLASS} text-center text-slate-500 py-12`}>
        <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
        Cargando detalle…
      </div>
    );
  }

  if (error || !detail || !declaration) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <Link to={listPath} className="text-sm text-primary-700 hover:underline">
          ← Volver al listado
        </Link>
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error || 'No se encontró el registro.'}
        </div>
      </div>
    );
  }

  const fileUrl = attachment ? resolveBackendUrl(attachment.file_url) : '';

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <Link to={listPath} className="text-sm text-primary-700 hover:underline">
        ← Volver al listado
      </Link>

      <div className="mt-2">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
          {mod.title} — {detail.business_name}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Período {periodYm} · RUC {detail.ruc} · Código {detail.code}
          {detail.dig ? ` · Dígito ${detail.dig}` : ''}
        </p>
      </div>

      {msg ? (
        <div className={`flex items-center gap-2 p-3 border rounded-lg text-sm font-medium ${msgBannerClass(msgTone)}`}>
          <i className={`fas ${msgBannerIcon(msgTone)}`} aria-hidden />
          {msg}
        </div>
      ) : null}

      {declaration.status === 'observado' && declaration.notes ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <i className="fas fa-exclamation-triangle mt-0.5" aria-hidden />
          <span>
            <span className="block font-medium">Observación del supervisor</span>
            <span className="block mt-0.5 whitespace-pre-wrap">{declaration.notes}</span>
            {workspace === 'assistant' ? (
              <span className="block text-xs mt-1 opacity-80">
                Corrija y cargue el archivo nuevamente — reemplaza al anterior y vuelve a revisión.
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className={`grid gap-4 ${showRevisionSupervisor ? 'lg:grid-cols-2' : ''}`}>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Empresa</h2>
          <div
            className={`grid gap-x-6 gap-y-3 text-sm ${
              showRevisionSupervisor ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
            }`}
          >
            <div>
              <p className="text-slate-500">Asistente</p>
              <p className="text-slate-800">{detail.assistant_username || '—'}</p>
            </div>
            <div>
              <p className="text-slate-500">Estado</p>
              <p>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${display.className}`}>
                  {display.label}
                </span>
              </p>
            </div>
            <div>
              <p className="text-slate-500">Fecha límite</p>
              <p className={dueResolved.isOverdue ? 'text-red-700 font-medium' : 'text-slate-800'}>
                {formatPdt601DueDetail(dueResolved.dueDate, dueResolved.isOverdue, dueResolved.daysRemaining)}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Fecha de cumplimiento</p>
              <p className="text-slate-800">
                {formatDateOnly(detail.fecha_entrega)}
                {detail.fecha_entrega && !suspendida ? (
                  <span
                    className={`ml-2 inline-block px-2 py-0.5 rounded-full text-2xs font-medium ${timelinessBadgeClass(detail.timeliness)}`}
                  >
                    {timelinessLabel(detail.timeliness)}
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        </div>

        {showRevisionSupervisor ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Revisión supervisor</h2>
            {suspendida ? (
              <p className="flex items-start gap-2 text-sm text-slate-500">
                <i className="fas fa-ban mt-0.5 text-purple-600" aria-hidden />
                Esta empresa está marcada "Suspendida" en este período (desde Control de Detracciones) — no aplica
                observar ni aprobar.
              </p>
            ) : locked ? (
              <div className="space-y-3">
                <p className="flex items-start gap-2 text-sm text-slate-500">
                  <i className="fas fa-check-circle mt-0.5 text-primary-600" aria-hidden />
                  Esta entrega ya fue aprobada — no aplica observar ni aprobar de nuevo.
                </p>
                {canReopen ? (
                  reopenOpen ? (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Motivo de la reapertura</label>
                      <textarea
                        value={reopenReason}
                        onChange={(e) => setReopenReason(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
                        placeholder="Indique por qué se reabre…"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => void handleReopen()}
                          className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                        >
                          Confirmar reapertura
                        </button>
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => {
                            setReopenOpen(false);
                            setReopenReason('');
                          }}
                          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReopenOpen(true)}
                      className="px-4 py-2 rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm font-medium hover:bg-red-100"
                    >
                      Reabrir
                    </button>
                  )
                ) : null}
              </div>
            ) : declaration.status !== 'por_revisar' ? (
              <p className="flex items-start gap-2 text-sm text-slate-500">
                <i className="fas fa-hourglass-half mt-0.5 text-slate-400" aria-hidden />
                {declaration.status === 'observado'
                  ? 'Esperando que el asistente corrija la observación y vuelva a cargar el archivo.'
                  : 'Esperando que el asistente cargue el archivo.'}
              </p>
            ) : (
              <>
                {canObserve ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Observar</label>
                    <textarea
                      value={supervisorNotes}
                      onChange={(e) => setSupervisorNotes(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="Indique la observación…"
                    />
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => void handleObserve()}
                      className="mt-2 px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
                    >
                      Observar
                    </button>
                  </div>
                ) : null}
                {canApprove ? (
                  <Button disabled={actionLoading} onClick={() => void handleApprove()}>
                    Dar visto bueno (Aprobar)
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div
        className={`bg-white rounded-xl border p-4 shadow-sm space-y-3 transition-colors ${
          dragOver && canSubmit ? 'border-primary-400 bg-primary-50/40' : 'border-slate-200'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          if (canSubmit && !uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <h2 className="text-sm font-semibold text-slate-800">Archivo PDF</h2>

        {suspendida ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-purple-300 bg-purple-50 px-3 py-2.5 text-sm text-purple-900">
            <i className="fas fa-ban mt-0.5" aria-hidden />
            <span>
              <span className="block font-medium">Esta empresa está suspendida en este período</span>
              <span className="block text-xs mt-0.5 opacity-80">
                Se marcó desde Control de Detracciones — no se puede cargar nada mientras esté suspendida.
              </span>
            </span>
          </div>
        ) : locked ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-700">
            <i className="fas fa-lock mt-0.5" aria-hidden />
            <span>
              Esta entrega ya fue aprobada ({display.label}) — no se puede reemplazar el archivo. Si hace falta corregir
              algo, pida que la reabran.
            </span>
          </div>
        ) : null}

        {canSubmit ? (
          <div className="space-y-3">
            <div className="max-w-xs">
              <label className="block text-xs text-slate-500 mb-1">Fecha de cumplimiento</label>
              <input
                type="date"
                max={todayDateStr()}
                value={fechaEntrega}
                disabled={uploading}
                onChange={(e) => setFechaEntrega(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50"
              />
            </div>
            <label
              className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-primary-400 bg-primary-50 text-primary-700'
                  : 'border-slate-300 bg-slate-50 text-slate-500 hover:border-primary-300 hover:bg-primary-50/40'
              } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
            >
              <i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'} text-2xl`} aria-hidden />
              <span className="text-sm font-medium">
                {uploading ? 'Subiendo…' : `Arrastre aquí el ${mod.documentLabel} (PDF) o haga clic para elegirlo`}
              </span>
              <span className="text-xs">
                Un solo archivo, máximo 10 MB{attachment ? ' — reemplaza al que ya está cargado' : ''}.
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </label>
          </div>
        ) : null}

        {attachment ? (
          <div className="rounded-lg border border-slate-200 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="truncate min-w-0">
              <i className="fas fa-file-pdf text-red-500 mr-2" aria-hidden />
              {attachment.file_name}
            </span>
            <span className="text-xs text-slate-500 shrink-0">Cargado {formatStoredAt(attachment.created_at)}</span>
            <span className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setPreview({ url: fileUrl, fileName: attachment.file_name })}
                className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-medium hover:underline"
              >
                <i className="fas fa-eye" aria-hidden />
                Ver
              </button>
              <button
                type="button"
                disabled={downloading}
                onClick={() => {
                  setDownloading(true);
                  void downloadRemoteFile(fileUrl, attachment.file_name).finally(() => setDownloading(false));
                }}
                className="inline-flex items-center gap-1.5 text-slate-600 text-xs font-medium hover:underline disabled:opacity-50"
              >
                <i className="fas fa-download" aria-hidden />
                {downloading ? 'Descargando…' : 'Descargar'}
              </button>
            </span>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Sin archivo cargado.</p>
        )}
      </div>

      {preview ? (
        <FilePreviewModal
          open
          url={preview.url}
          title={preview.fileName}
          onClose={() => setPreview(null)}
          onDownload={() => void downloadRemoteFile(preview.url, preview.fileName)}
        />
      ) : null}
    </div>
  );
};

export default PdfReportDetailPage;
