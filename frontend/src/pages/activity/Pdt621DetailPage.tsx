import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { resolveBackendUrl } from '../../api/client';
import {
  formatStoredAt,
  computePdt621DueMeta,
  formatPdt621DueDetail,
  pdt621DisplayStatus,
  PDT621_TERMINAL_STATUSES,
  resolvePdt621DueDate,
  SIRE_ENVIO_OPTIONS,
} from '../../components/activity/pdt621Config';
import FilePreviewModal from '../../components/FilePreviewModal';
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
import { pdt621Service, type Pdt621Detail, type Pdt621Record, type Pdt621RecordInput } from '../../services/pdt621';
import { currentPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import { downloadRemoteFile } from '../../utils/downloadFile';

const EMPTY_RECORD: Pdt621RecordInput = {
  primera_entrega_fecha: '',
  primera_entrega_hora: '',
  observacion: '',
  segunda_entrega_fecha: '',
  segunda_entrega_hora: '',
  fecha_declaracion: '',
  total_ventas: 0,
  total_compras: 0,
  igv: 0,
  rta: 0,
  cantidad_comprobantes_venta: 0,
  cantidad_comprobantes_compra: 0,
  envio_sire: '',
  fecha_envio_sire: '',
  motivo_no_envio: '',
};

function recordToInput(r: Pdt621Record | null | undefined): Pdt621RecordInput {
  if (!r) return { ...EMPTY_RECORD };
  return {
    primera_entrega_fecha: r.primera_entrega_fecha ?? '',
    primera_entrega_hora: r.primera_entrega_hora ?? '',
    observacion: r.observacion ?? '',
    segunda_entrega_fecha: r.segunda_entrega_fecha ?? '',
    segunda_entrega_hora: r.segunda_entrega_hora ?? '',
    fecha_declaracion: r.fecha_declaracion ?? '',
    total_ventas: r.total_ventas ?? 0,
    total_compras: r.total_compras ?? 0,
    igv: r.igv ?? 0,
    rta: r.rta ?? 0,
    cantidad_comprobantes_venta: r.cantidad_comprobantes_venta ?? 0,
    cantidad_comprobantes_compra: r.cantidad_comprobantes_compra ?? 0,
    envio_sire: r.envio_sire ?? '',
    fecha_envio_sire: r.fecha_envio_sire ?? '',
    motivo_no_envio: r.motivo_no_envio ?? '',
  };
}

const FIELD_INPUT =
  'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-500';

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
  const canReopen = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsReopen), []);
  const canCreateObservation = useMemo(() => auth.hasPermission(P.supervisorsObservationsCreate), []);

  const [detail, setDetail] = useState<Pdt621Detail | null>(null);
  const [attachments, setAttachments] = useState<SupervisorAttachment[]>([]);
  const [observations, setObservations] = useState<SupervisorObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [obsText, setObsText] = useState('');
  const [obsSaving, setObsSaving] = useState(false);
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [record, setRecord] = useState<Pdt621RecordInput>({ ...EMPTY_RECORD });
  const [recordSaving, setRecordSaving] = useState(false);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const declaration = detail?.declaration;
  // Terminal: una vez "Entregado", nadie edita nada (ni el asistente ni el supervisor) salvo que se
  // reabra con el permiso dedicado — mismo criterio que Pdt601DetailPage.tsx.
  const declarationLocked = !!declaration && PDT621_TERMINAL_STATUSES.has(declaration.status);
  // Suspendida (docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.7) ya NO se marca desde este
  // módulo — se lee de solo lectura desde el control (Control de Detracciones es el único que la
  // escribe). formLocked bloquea el formulario igual que declarationLocked.
  const controlSuspendida = !!detail?.control_suspendida;
  const formLocked = declarationLocked || controlSuspendida;
  const displayStatus = useMemo(
    () =>
      pdt621DisplayStatus({
        status: declaration?.status ?? '',
        suspendida: controlSuspendida,
        assistantTimeliness: detail?.assistant_timeliness,
      }),
    [declaration?.status, controlSuspendida, detail?.assistant_timeliness],
  );

  // Estos 4 campos se llenan por sincronización desde la liquidación (ver syncPdt621Record en
  // SupervisorLiquidacionCreatePage.tsx) — si ya tienen algún valor, dejarlos editables a mano
  // no sirve de nada (la liquidación es la fuente de verdad y los va a volver a sobreescribir en
  // el próximo guardado), así que se bloquean. Si están todos en cero es porque aún no hay
  // liquidación registrada para esta empresa/período — ahí se siguen llenando a mano como antes.
  const pdt621Locked = useMemo(() => {
    const rec = detail?.record;
    if (!rec) return false;
    return rec.total_ventas > 0 || rec.total_compras > 0 || rec.igv !== 0 || rec.rta > 0;
  }, [detail?.record]);

  // Fecha límite por grupo de RUC del calendario interno (docs/diseno-limpieza-control-detail-2026-
  // 09-16.md §5.7b) — reemplaza a declaration.due_date (0% de uso real, §3.1) como fuente de
  // "Vencimiento", con la fecha genérica del control como respaldo si el período no tiene ninguna
  // actividad "pdt_621" configurada en el calendario.
  const dueResolved = useMemo(() => {
    if (!detail || !declaration) return { dueDate: undefined, isOverdue: false, daysRemaining: null as number | null };
    const dueDate = resolvePdt621DueDate(detail.calendar_due_date, detail.control_due_date);
    const meta = computePdt621DueMeta(declaration.status, dueDate, controlSuspendida);
    return { dueDate, ...meta };
  }, [detail, declaration, controlSuspendida]);

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
      setRecord(recordToInput(data.record));
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

  const handleReopen = async () => {
    if (!declaration || !canReopen) return;
    const reason = reopenReason.trim();
    if (!reason) {
      setMsg('Ingrese el motivo de la reapertura.');
      return;
    }
    try {
      setActionLoading(true);
      setMsg('');
      const updated = await supervisorsService.reopenDeclaration(declaration.id, reason);
      refreshDeclaration(updated);
      setReopenReason('');
      setReopenOpen(false);
      setMsg('Declaración reabierta — volvió a "Por revisar".');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'No se pudo reabrir.'));
    } finally {
      setActionLoading(false);
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

  const patchRecord = (patch: Partial<Pdt621RecordInput>) => {
    setRecord((prev) => ({ ...prev, ...patch }));
  };

  const handleSaveRecord = async () => {
    if (!canUpdate || formLocked) return;
    if (record.envio_sire === 'no' && !record.motivo_no_envio.trim()) {
      setMsg('Ingrese el motivo por el que no se envió SIRE.');
      return;
    }
    try {
      setRecordSaving(true);
      setMsg('');
      const updated = await pdt621Service.saveRecord(companyId, periodYm, record);
      // El guardado puede haber disparado la entrega automática (Pendiente/Observado → Por revisar,
      // docs/diseno-estados-pdt601-pdt621-2026-09-16.md §9) — se refleja acá también el estado y la
      // puntualidad recalculada, no solo el registro.
      setDetail((d) =>
        d
          ? {
              ...d,
              record: updated.record,
              declaration: updated.declaration,
              assistant_timeliness: updated.assistant_timeliness,
              control_suspendida: updated.control_suspendida,
            }
          : d,
      );
      setRecord(recordToInput(updated.record));
      setMsg('Registro guardado.');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'No se pudo guardar el registro.'));
    } finally {
      setRecordSaving(false);
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
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${displayStatus.className}`}>
                {displayStatus.label}
              </span>
            </dd>
            <dt className="text-slate-500">Vencimiento</dt>
            <dd className={dueResolved.isOverdue ? 'text-red-700 font-medium' : 'text-slate-800'}>
              {formatPdt621DueDetail(dueResolved.dueDate, dueResolved.isOverdue, dueResolved.daysRemaining)}
            </dd>
          </dl>
          {controlSuspendida ? (
            // Suspendida (§5.9.7) ya NO se marca desde este módulo — de solo lectura, se marca
            // desde Control de Detracciones.
            <p className="flex items-start gap-2 text-sm text-slate-500">
              <i className="fas fa-ban mt-0.5 text-purple-600" aria-hidden />
              Esta empresa está marcada "Suspendida" en este período (desde Control de
              Detracciones).
            </p>
          ) : null}
        </div>

        {(canApprove || canObserve) && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Revisión supervisor</h2>
            {controlSuspendida ? (
              // Suspendida bloquea TODO registro, incluido el flujo de observar/aprobar.
              <p className="flex items-start gap-2 text-sm text-slate-500">
                <i className="fas fa-ban mt-0.5 text-purple-600" aria-hidden />
                Esta empresa está marcada "Suspendida" en este período — no aplica observar ni
                aprobar.
              </p>
            ) : declarationLocked ? (
              // Terminal: ya no aplica observar/aprobar — la única salida es Reabrir, si se tiene
              // el permiso dedicado (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §7).
              <div className="space-y-3">
                <p className="flex items-start gap-2 text-sm text-slate-500">
                  <i className="fas fa-check-circle mt-0.5 text-emerald-600" aria-hidden />
                  Esta declaración ya fue entregada — no aplica observar ni aprobar de nuevo.
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
              // Todavía no hay nada que revisar (Pendiente) u observado esperando corrección.
              <p className="flex items-start gap-2 text-sm text-slate-500">
                <i className="fas fa-hourglass-half mt-0.5 text-slate-400" aria-hidden />
                {declaration.status === 'observado'
                  ? 'Esperando que el asistente corrija la observación y vuelva a entregar.'
                  : 'Esperando que el asistente entregue su registro.'}
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
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => void handleApprove()}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Aprobar
                  </button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Revisión de archivadores</h2>

        {declarationLocked ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-700">
            <i className="fas fa-lock mt-0.5" aria-hidden />
            <span>
              Esta declaración ya fue entregada ({displayStatus.label}) — no se puede editar. Si hace
              falta corregir algo, pida que la reabran.
            </span>
          </div>
        ) : null}

        {/* Una sola puerta para todo lo que no aplica con Suspendida (antes eran 4 condicionales
            sueltas: entregas, importes/comprobantes/SIRE, más el select de estado ya eliminado) —
            mismo criterio de "una sola puerta" que Pdt601DetailPage.tsx. */}
        {controlSuspendida ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-purple-300 bg-purple-50 px-3 py-2.5 text-sm text-purple-900">
            <i className="fas fa-ban mt-0.5" aria-hidden />
            <span>
              <span className="block font-medium">Esta empresa está suspendida en este período</span>
              <span className="block text-xs mt-0.5 opacity-80">
                No es necesario (ni se permite) registrar entregas, importes ni SIRE.
              </span>
            </span>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">1ra entrega — Fecha</label>
                <input
                  type="date"
                  disabled={!canUpdate || declarationLocked}
                  value={record.primera_entrega_fecha}
                  onChange={(e) => patchRecord({ primera_entrega_fecha: e.target.value })}
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">1ra entrega — Hora</label>
                <input
                  type="time"
                  disabled={!canUpdate || declarationLocked}
                  value={record.primera_entrega_hora}
                  onChange={(e) => patchRecord({ primera_entrega_hora: e.target.value })}
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">2da entrega — Fecha</label>
                <input
                  type="date"
                  disabled={!canUpdate || declarationLocked}
                  value={record.segunda_entrega_fecha}
                  onChange={(e) => patchRecord({ segunda_entrega_fecha: e.target.value })}
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">2da entrega — Hora</label>
                <input
                  type="time"
                  disabled={!canUpdate || declarationLocked}
                  value={record.segunda_entrega_hora}
                  onChange={(e) => patchRecord({ segunda_entrega_hora: e.target.value })}
                  className={FIELD_INPUT}
                />
              </div>
            </div>

            <h2 className="text-sm font-semibold text-slate-800 pt-2 border-t border-slate-100">
              Fecha de declaración e importes PDT 621
            </h2>
            {pdt621Locked ? (
              <p className="text-xs text-slate-500 -mt-2">
                Total ventas, Total compras, IGV y Renta se sincronizan desde la liquidación de esta empresa/período — no
                se editan a mano acá.
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Fecha de declaración</label>
                <input
                  type="date"
                  disabled={!canUpdate || declarationLocked}
                  value={record.fecha_declaracion}
                  onChange={(e) => patchRecord({ fecha_declaracion: e.target.value })}
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Total ventas</label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!canUpdate || declarationLocked || pdt621Locked}
                  value={record.total_ventas}
                  onChange={(e) => patchRecord({ total_ventas: Number(e.target.value) || 0 })}
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Total compras</label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!canUpdate || declarationLocked || pdt621Locked}
                  value={record.total_compras}
                  onChange={(e) => patchRecord({ total_compras: Number(e.target.value) || 0 })}
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">IGV</label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!canUpdate || declarationLocked || pdt621Locked}
                  value={record.igv}
                  onChange={(e) => patchRecord({ igv: Number(e.target.value) || 0 })}
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Renta</label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!canUpdate || declarationLocked || pdt621Locked}
                  value={record.rta}
                  onChange={(e) => patchRecord({ rta: Number(e.target.value) || 0 })}
                  className={FIELD_INPUT}
                />
              </div>
            </div>

            {/* Cantidad de comprobantes (NO montos) — solo registro manual del supervisor, nunca se
                sincroniza desde la liquidación, así que no entra al candado `pdt621Locked` de arriba. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Cantidad de comprobantes de venta</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  disabled={!canUpdate || declarationLocked}
                  value={record.cantidad_comprobantes_venta || ''}
                  onChange={(e) => patchRecord({ cantidad_comprobantes_venta: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Cantidad de comprobantes de compra</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  disabled={!canUpdate || declarationLocked}
                  value={record.cantidad_comprobantes_compra || ''}
                  onChange={(e) => patchRecord({ cantidad_comprobantes_compra: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className={FIELD_INPUT}
                />
              </div>
            </div>

            <h2 className="text-sm font-semibold text-slate-800 pt-2 border-t border-slate-100">SIRE</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">¿Se envió SIRE?</label>
                <select
                  disabled={!canUpdate || declarationLocked}
                  value={record.envio_sire}
                  onChange={(e) => {
                    const envio_sire = e.target.value;
                    patchRecord(envio_sire === 'si' ? { envio_sire, motivo_no_envio: '' } : { envio_sire });
                  }}
                  className={FIELD_INPUT}
                >
                  {SIRE_ENVIO_OPTIONS.map((opt) => (
                    <option key={opt.value || 'none'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Fecha de envío</label>
                <input
                  type="date"
                  disabled={!canUpdate || declarationLocked}
                  value={record.fecha_envio_sire}
                  onChange={(e) => patchRecord({ fecha_envio_sire: e.target.value })}
                  className={FIELD_INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Motivo por el que no se envió{record.envio_sire === 'no' ? ' *' : ''}
                </label>
                <input
                  type="text"
                  disabled={!canUpdate || declarationLocked || record.envio_sire !== 'no'}
                  value={record.motivo_no_envio}
                  onChange={(e) => patchRecord({ motivo_no_envio: e.target.value })}
                  placeholder={record.envio_sire === 'no' ? 'Indique el motivo…' : '—'}
                  className={FIELD_INPUT}
                />
              </div>
            </div>
          </>
        )}

        <div>
          <label className="block text-xs text-slate-500 mb-1">Observación</label>
          <textarea
            disabled={!canUpdate || formLocked}
            value={record.observacion}
            onChange={(e) => patchRecord({ observacion: e.target.value })}
            rows={2}
            className={FIELD_INPUT}
            placeholder="Observación sobre la revisión del archivador…"
          />
        </div>

        {canUpdate ? (
          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={recordSaving || formLocked}
              onClick={() => void handleSaveRecord()}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {recordSaving ? 'Guardando…' : 'Guardar registro'}
            </button>
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">PDT 621 ({attachments.length})</h2>
          {canUpload ? (
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium cursor-pointer hover:bg-primary-700">
              <i className="fas fa-upload" aria-hidden />
              {uploading ? 'Subiendo…' : 'Cargar PDT 621'}
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
            {attachments.map((a) => {
              const fileUrl = resolveBackendUrl(a.file_url);
              return (
                <li key={a.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    <i className="fas fa-paperclip text-slate-400 mr-2" aria-hidden />
                    {a.file_name}
                  </span>
                  <span className="text-xs text-slate-500 shrink-0">{formatStoredAt(a.created_at)}</span>
                  <span className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreview({ url: fileUrl, fileName: a.file_name })}
                      className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-medium hover:underline"
                    >
                      <i className="fas fa-eye" aria-hidden />
                      Ver
                    </button>
                    <button
                      type="button"
                      disabled={downloadingId === a.id}
                      onClick={() => {
                        setDownloadingId(a.id);
                        void downloadRemoteFile(fileUrl, a.file_name).finally(() => setDownloadingId(null));
                      }}
                      className="inline-flex items-center gap-1.5 text-slate-600 text-xs font-medium hover:underline disabled:opacity-50"
                    >
                      <i className="fas fa-download" aria-hidden />
                      {downloadingId === a.id ? 'Descargando…' : 'Descargar'}
                    </button>
                  </span>
                </li>
              );
            })}
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

export default Pdt621DetailPage;
