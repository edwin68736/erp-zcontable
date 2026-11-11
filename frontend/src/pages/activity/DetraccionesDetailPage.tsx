import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { resolveBackendUrl } from '../../api/client';
import DetraccionesStatusModal from '../../components/activity/DetraccionesStatusModal';
import {
  formatStoredAt,
  detraccionesAllowsUpload,
  detraccionesStatusBadgeClass,
  detraccionesStatusLabel,
  detraccionesShowStatusEdit,
  normalizeDetraccionesStatus,
} from '../../components/activity/detraccionesConfig';
import {
  formatTimelinessDate,
  timelinessBadgeClass,
  timelinessLabel,
} from '../../components/activity/timelinessConfig';
import FilePreviewModal from '../../components/FilePreviewModal';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activityModulePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { supervisorsService, type SupervisorAttachment, type SupervisorDeclaration } from '../../services/supervisors';
import { detraccionesService, type DetraccionesDetail } from '../../services/detracciones';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import { downloadRemoteFile } from '../../utils/downloadFile';
import Alert from '../../components/ui/Alert';
import { notify } from '../../utils/notify';

type DetraccionesDetailPageProps = {
  workspace: ActivityWorkspace;
};

function validatePdfClient(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf')) return 'Solo se permiten archivos PDF.';
  if (file.type && file.type !== 'application/pdf') return 'El archivo debe ser PDF.';
  return null;
}

const DetraccionesDetailPage = ({ workspace }: DetraccionesDetailPageProps) => {
  const { companyId: companyIdParam } = useParams();
  const companyId = Number(companyIdParam);
  const [searchParams] = useSearchParams();
  const periodYm = searchParams.get('period_ym') || previousMonthPeriodYM();
  const listPath = `${activityModulePath(workspace, 'detracciones')}?period_ym=${encodeURIComponent(periodYm)}`;

  const canUpload = useMemo(
    () => workspace === 'assistant' && auth.hasPermission(P.supervisorsAttachmentsUpload),
    [workspace],
  );
  const canVerify = useMemo(
    () => workspace === 'supervisor' && auth.hasPermission(P.supervisorsDeclarationsApprove),
    [workspace],
  );
  // «Sin clave» / «No corresponde»: permiso propio, lo pueden tener el asistente y el supervisor (no depende de la pantalla).
  const canSetStatus = useMemo(() => auth.hasPermission(P.supervisorsDetraccionesMarkStatus), []);
  // "Suspendida" (docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.7): Estado cta. detracciones
  // es el ÚNICO módulo de todo el sistema que la marca/desmarca — PDT 601/621 y Buzón SOL solo la
  // leen. Mismo permiso que subir el PDF (lo puede marcar tanto el asistente como el supervisor,
  // igual que el checkbox viejo de PDT 601 antes de este cambio).
  const canSuspend = useMemo(() => auth.hasPermission(P.supervisorsAttachmentsUpload), []);

  const [detail, setDetail] = useState<DetraccionesDetail | null>(null);
  const [attachments, setAttachments] = useState<SupervisorAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const declaration = detail?.declaration;
  const status = declaration ? normalizeDetraccionesStatus(declaration.status) : 'pendiente';
  const latestAttachment = attachments[0];
  const fileUrl = latestAttachment?.file_url ? resolveBackendUrl(latestAttachment.file_url) : '';
  const fileName = latestAttachment?.file_name?.trim() || 'Comprobante.pdf';

  const loadAttachments = useCallback(async (declarationId: number) => {
    const rows = await supervisorsService.listAttachments(0, declarationId);
    setAttachments(rows);
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
      const data = await detraccionesService.getDetail(companyId, periodYm);
      setDetail(data);
      await loadAttachments(data.declaration.id);
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar el detalle.'));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, periodYm, loadAttachments]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshDeclaration = (decl: SupervisorDeclaration) => {
    setDetail((d) => (d ? { ...d, declaration: decl } : d));
  };

  const handleUpload = async (files: FileList | null) => {
    if (!declaration || !canUpload || !files?.length) return;
    const file = files[0];
    const validationError = validatePdfClient(file);
    if (validationError) {
      notify.warning('Revise los datos', validationError);
      return;
    }
    if (!detraccionesAllowsUpload(status)) {
      notify.warning('Revise los datos', 'No se puede cargar PDF en el estado actual.');
      return;
    }
    try {
      setUploading(true);
      const updated = await detraccionesService.uploadPdf(companyId, periodYm, file);
      setDetail(updated);
      await loadAttachments(updated.declaration.id);
      notify.success('PDF cargado');
    } catch (err) {
      notify.fromMessage('error', extractApiErrorMessage(err, 'No se pudo subir el PDF'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleVerify = async () => {
    if (!declaration || !canVerify || workspace !== 'supervisor') return;
    try {
      setActionLoading(true);
      const updated = await detraccionesService.verify(declaration.id);
      refreshDeclaration(updated);
      notify.success('Registro verificado');
    } catch (err) {
      notify.fromMessage('error', extractApiErrorMessage(err, 'No se pudo verificar.'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetStatus = async (next: 'sin_clave' | 'no_corresponde') => {
    if (!declaration || workspace !== 'supervisor' || !canVerify) return;
    try {
      setActionLoading(true);
      const updated = await detraccionesService.setSupervisorStatus(declaration.id, next);
      refreshDeclaration(updated);
      setStatusModalOpen(false);
      notify.success('Estado actualizado');
    } catch (err) {
      notify.fromMessage('error', extractApiErrorMessage(err, 'No se pudo cambiar el estado.'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleSuspendida = async (next: boolean) => {
    if (!canSuspend) return;
    try {
      setActionLoading(true);
      const updated = await detraccionesService.setSuspendida(companyId, periodYm, next);
      setDetail(updated);
      notify.fromMessage('success', next ? 'Empresa marcada como suspendida.' : 'Empresa reactivada.');
    } catch (err) {
      notify.fromMessage('error', extractApiErrorMessage(err, 'No se pudo actualizar la suspensión.'));
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
        <Alert variant="error" className="mt-4">
          {error || 'No se encontró el registro.'}
        </Alert>
      </div>
    );
  }

  // Suspendida bloquea CUALQUIER otro registro en este módulo (docs/diseno-limpieza-control-detail-
  // 2026-09-16.md §5.9.7.3 punto 5, mismo criterio "una sola puerta" que PDT 601/621).
  // El mes en curso y los futuros se pueden mirar pero no cargar, marcar ni verificar nada.
  const periodEnabled = detail.period_enabled !== false;
  const showUpload = periodEnabled && canUpload && detraccionesAllowsUpload(status) && !detail.suspendida;
  const showVerify = periodEnabled && canVerify && workspace === 'supervisor' && status === 'cargado' && !detail.suspendida;
  const showStatusEdit = periodEnabled && detraccionesShowStatusEdit(canSetStatus, status, Boolean(detail.suspendida));

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <Link to={listPath} className="text-sm text-primary-700 hover:underline">
        ← Volver al listado
      </Link>

      <div className="mt-2">
        <h1 className="text-xl font-bold text-slate-800 tracking-tight leading-7">
          Estado cta. detracciones SUNAT — {detail.business_name}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Periodo {periodYm} · RUC {detail.ruc} · Código {detail.code}
          {detail.dig ? ` · Dígito ${detail.dig}` : ''}
        </p>
      </div>

      {!periodEnabled ? (
        <Alert variant="warning">
          <strong>Periodo {periodYm} aún no habilitado.</strong> Las detracciones se registran «pasando el mes»: solo se puede cargar, marcar o
          verificar información de periodos ya terminados. Este periodo se muestra únicamente para consulta.
        </Alert>
      ) : null}


      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Empresa</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Asistente</dt>
            <dd className="text-slate-800">{detail.assistant_username || '—'}</dd>
            <dt className="text-slate-500">Estado</dt>
            <dd>
              {showStatusEdit ? (
                <button
                  type="button"
                  onClick={() => setStatusModalOpen(true)}
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium hover:ring-2 hover:ring-primary-300 ${detraccionesStatusBadgeClass(status)}`}
                >
                  {detraccionesStatusLabel(status)}
                  <i className="fas fa-pen ml-1 text-3xs opacity-70" aria-hidden />
                </button>
              ) : (
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${detraccionesStatusBadgeClass(status)}`}
                >
                  {detraccionesStatusLabel(status)}
                </span>
              )}
            </dd>
            <dt className="text-slate-500">Cumplimiento</dt>
            <dd>
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${timelinessBadgeClass(detail.timeliness?.timeliness)}`}
              >
                {timelinessLabel(detail.timeliness?.timeliness)}
              </span>
            </dd>
            {detail.timeliness?.due_at ? (
              <>
                <dt className="text-slate-500">Plazo calendario</dt>
                <dd className="text-slate-800">{formatTimelinessDate(detail.timeliness.due_at)}</dd>
              </>
            ) : null}
            {detail.timeliness?.uploaded_at || latestAttachment?.created_at ? (
              <>
                <dt className="text-slate-500">Fecha carga PDF</dt>
                <dd className="text-slate-800">
                  {formatTimelinessDate(detail.timeliness?.uploaded_at ?? latestAttachment?.created_at)}
                </dd>
              </>
            ) : null}
          </dl>

          {/* Único checkbox de todo el sistema que marca/desmarca "suspendida" (§5.9.7) — PDT 601/621
              y Buzón SOL solo la leen desde su propio detalle/listado. */}
          <label
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${
              detail.suspendida ? 'border-purple-300 bg-purple-50 text-purple-900' : 'border-slate-200 bg-slate-50 text-slate-700'
            } ${canSuspend ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
          >
            <input
              type="checkbox"
              disabled={!canSuspend || !periodEnabled || actionLoading}
              checked={detail.suspendida}
              onChange={(e) => void handleToggleSuspendida(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
            <span>
              <span className="block font-medium">Esta empresa está suspendida en este periodo</span>
              <span className="block text-xs mt-0.5 opacity-80">
                Se aplica a Estado cta. detracciones, PDT 601, PDT 621 y Buzón SOL — no se registra
                ningún otro dato en ninguno de estos módulos mientras esté suspendida.
              </span>
            </span>
          </label>
        </div>

        {showVerify || showStatusEdit ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">{showVerify ? 'Revisión supervisor' : 'Estado del registro'}</h2>
            {showVerify ? (
              <button
                type="button"
                disabled={actionLoading || !fileUrl}
                onClick={() => void handleVerify()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                <i className="fas fa-check" aria-hidden />
                Marcar como verificado
              </button>
            ) : null}
            {showStatusEdit ? (
              <p className="text-xs text-slate-500">
                Si la empresa no requiere comprobante PDF, use el estado en la tarjeta de empresa para marcar «Sin clave» o «No corresponde».
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Comprobante PDF</h2>
          {showUpload ? (
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium cursor-pointer hover:bg-primary-700">
              <i className="fas fa-upload" aria-hidden />
              {uploading ? 'Subiendo…' : fileUrl ? 'Reemplazar PDF' : 'Cargar PDF'}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => void handleUpload(e.target.files)}
              />
            </label>
          ) : null}
        </div>
        {!fileUrl ? (
          <p className="text-sm text-slate-500">Sin PDF cargado.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="truncate">
              <i className="fas fa-file-pdf text-red-500 mr-2" aria-hidden />
              {fileName}
            </span>
            <span className="text-xs text-slate-500">{formatStoredAt(latestAttachment?.created_at)}</span>
            <button
              type="button"
              onClick={() => setPreview({ url: fileUrl, fileName })}
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
                void downloadRemoteFile(fileUrl, fileName).finally(() => setDownloading(false));
              }}
              className="inline-flex items-center gap-1.5 text-slate-600 text-xs font-medium hover:underline disabled:opacity-50"
            >
              <i className="fas fa-download" aria-hidden />
              {downloading ? 'Descargando…' : 'Descargar'}
            </button>
          </div>
        )}
      </div>

      {preview ? (
        <FilePreviewModal
          open
          url={preview.url}
          title={preview.fileName}
          onClose={() => setPreview(null)}
          onDownload={() => void downloadRemoteFile(fileUrl, fileName)}
        />
      ) : null}

      <DetraccionesStatusModal
        open={statusModalOpen}
        companyName={detail.business_name}
        currentStatus={status}
        saving={actionLoading}
        onClose={() => setStatusModalOpen(false)}
        onConfirm={(s) => void handleSetStatus(s)}
      />
    </div>
  );
};

export default DetraccionesDetailPage;
