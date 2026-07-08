import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  formatStoredAt,
  computePdt621DueMeta,
  formatPdt621DueDetail,
  pdt621StatusBadgeClass,
  pdt621StatusLabel,
  PDT621_STATUSES,
  resolvePdt621DueDate,
} from '../../components/activity/pdt621Config';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activityModulePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import {
  supervisorsService,
  type SupervisorAttachment,
  type SupervisorDeclaration,
  type SupervisorObservation,
} from '../../services/supervisors';
import { pdt621Service, type Pdt621Detail } from '../../services/pdt621';
import { currentPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';

const PDT621_APPROVED_STATUSES = new Set(['aprobado', 'presentado', 'cerrado']);

type Pdt621DetailPageProps = {
  workspace: ActivityWorkspace;
};

const Pdt621DetailPage = ({ workspace }: Pdt621DetailPageProps) => {
  const { companyId: companyIdParam } = useParams();
  const companyId = Number(companyIdParam);
  const [searchParams] = useSearchParams();
  const periodYm = searchParams.get('period_ym') || currentPeriodYM();
  const listPath = `${activityModulePath(workspace, 'pdt-621')}?period_ym=${encodeURIComponent(periodYm)}`;

  const canUpdate = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsUpdate), []);
  const canUpload = useMemo(() => auth.hasPermission(P.supervisorsAttachmentsUpload), []);
  const canObserve = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsObserve), []);
  const canApprove = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsApprove), []);
  const canCreateObservation = useMemo(() => auth.hasPermission(P.supervisorsObservationsCreate), []);

  const [detail, setDetail] = useState<Pdt621Detail | null>(null);
  const [attachments, setAttachments] = useState<SupervisorAttachment[]>([]);
  const [observations, setObservations] = useState<SupervisorObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [obsText, setObsText] = useState('');
  const [obsSaving, setObsSaving] = useState(false);
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const declaration = detail?.declaration;

  const dueResolved = useMemo(() => {
    if (!detail || !declaration) return { dueDate: undefined, isOverdue: false, daysRemaining: null as number | null };
    const dueDate = resolvePdt621DueDate(declaration.due_date, detail.control_due_date);
    const meta = computePdt621DueMeta(declaration.status, dueDate);
    return { dueDate, ...meta };
  }, [detail, declaration]);

  const loadAttachments = useCallback(async (declarationId: number) => {
    const rows = await supervisorsService.listAttachments(0, declarationId);
    setAttachments(rows);
  }, []);

  const loadObservations = useCallback(async (declarationId: number) => {
    const rows = await supervisorsService.listObservations(0, declarationId);
    setObservations(rows);
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
      const data = await pdt621Service.getDetail(companyId, periodYm);
      setDetail(data);
      await Promise.all([
        loadAttachments(data.declaration.id),
        loadObservations(data.declaration.id),
      ]);
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar el detalle.'));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, periodYm, loadAttachments, loadObservations]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshDeclaration = (decl: SupervisorDeclaration) => {
    setDetail((d) => (d ? { ...d, declaration: decl } : d));
  };

  const handleStatusChange = async (status: string) => {
    if (!declaration || !canUpdate) return;
    try {
      setStatusSaving(true);
      setMsg('');
      const updated = await supervisorsService.updateDeclaration(declaration.id, { status });
      refreshDeclaration(updated);
      setMsg('Estado actualizado.');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'No se pudo actualizar el estado.'));
    } finally {
      setStatusSaving(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!declaration || !canUpload || !files?.length) return;
    try {
      setUploading(true);
      setMsg('');
      for (const file of Array.from(files)) {
        await supervisorsService.uploadAttachment(detail!.control_id, declaration.id, file);
      }
      await loadAttachments(declaration.id);
      setMsg('Archivo(s) subido(s) correctamente.');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'Error al subir archivo.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleAddObservation = async () => {
    if (!declaration || !canCreateObservation) return;
    const body = obsText.trim();
    if (!body) return;
    try {
      setObsSaving(true);
      setMsg('');
      await supervisorsService.createObservation({ declaration_id: declaration.id, body });
      setObsText('');
      await loadObservations(declaration.id);
      setMsg('Observación registrada.');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'No se pudo registrar la observación.'));
    } finally {
      setObsSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!declaration || !canApprove) return;
    try {
      setActionLoading(true);
      setMsg('');
      const updated = await supervisorsService.approveDeclaration(declaration.id);
      refreshDeclaration(updated);
      setMsg('Declaración aprobada.');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'No se pudo aprobar.'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleObserve = async () => {
    if (!declaration || !canObserve) return;
    const notes = supervisorNotes.trim();
    if (!notes) {
      setMsg('Ingrese el texto de la observación.');
      return;
    }
    try {
      setActionLoading(true);
      setMsg('');
      const updated = await supervisorsService.observeDeclaration(declaration.id, notes);
      refreshDeclaration(updated);
      setSupervisorNotes('');
      await loadObservations(declaration.id);
      setMsg('Observación registrada.');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'No se pudo observar.'));
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

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <Link to={listPath} className="text-sm text-primary-700 hover:underline">
        ← Volver al listado
      </Link>

      <div className="mt-2">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
          Control Vencimientos PDT 621 — {detail.business_name}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Período {periodYm} · RUC {detail.ruc} · Código {detail.code}
          {detail.dig ? ` · Dígito ${detail.dig}` : ''}
        </p>
      </div>

      {msg ? (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">{msg}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Empresa</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Asistente</dt>
            <dd className="text-slate-800">{detail.assistant_username || '—'}</dd>
            <dt className="text-slate-500">Estado</dt>
            <dd>
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pdt621StatusBadgeClass(declaration.status)}`}
              >
                {pdt621StatusLabel(declaration.status)}
              </span>
            </dd>
            <dt className="text-slate-500">Vencimiento</dt>
            <dd className={dueResolved.isOverdue ? 'text-red-700 font-medium' : 'text-slate-800'}>
              {formatPdt621DueDetail(dueResolved.dueDate, dueResolved.isOverdue, dueResolved.daysRemaining)}
            </dd>
          </dl>
          {canUpdate ? (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Cambiar estado</label>
              <select
                value={declaration.status}
                disabled={statusSaving}
                onChange={(e) => void handleStatusChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
              >
                {PDT621_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {(canApprove || canObserve) && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Revisión supervisor</h2>
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
              <button
                type="button"
                disabled={actionLoading || PDT621_APPROVED_STATUSES.has(declaration.status)}
                onClick={() => void handleApprove()}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                Aprobar
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Evidencias ({attachments.length})</h2>
          {canUpload ? (
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium cursor-pointer hover:bg-primary-700">
              <i className="fas fa-upload" aria-hidden />
              {uploading ? 'Subiendo…' : 'Subir archivos'}
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => void handleUpload(e.target.files)}
              />
            </label>
          ) : null}
        </div>
        {attachments.length === 0 ? (
          <p className="text-sm text-slate-500">Sin archivos cargados.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {attachments.map((a) => (
              <li key={a.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  <i className="fas fa-paperclip text-slate-400 mr-2" aria-hidden />
                  {a.file_name}
                </span>
                <span className="text-xs text-slate-500 shrink-0">{formatStoredAt(a.created_at)}</span>
                <a
                  href={a.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-700 text-xs font-medium shrink-0 hover:underline"
                >
                  Abrir
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Observaciones</h2>
        {canCreateObservation ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={obsText}
              onChange={(e) => setObsText(e.target.value)}
              placeholder="Nueva observación…"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="button"
              disabled={obsSaving || !obsText.trim()}
              onClick={() => void handleAddObservation()}
              className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        ) : null}
        {observations.length === 0 ? (
          <p className="text-sm text-slate-500">Sin observaciones.</p>
        ) : (
          <ul className="space-y-2">
            {observations.map((o) => (
              <li key={o.id} className="text-sm border border-slate-100 rounded-lg px-3 py-2 bg-slate-50/50">
                <p className="text-slate-800">{o.body}</p>
                <p className="text-xs text-slate-500 mt-1">{formatStoredAt(o.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Pdt621DetailPage;
