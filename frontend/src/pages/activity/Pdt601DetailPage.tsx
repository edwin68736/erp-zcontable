import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { resolveBackendUrl } from '../../api/client';
import {
  computePdt601DueMeta,
  formatPdt601DueDetail,
  formatStoredAt,
  pdt601DisplayStatus,
  PDT601_TERMINAL_STATUSES,
  PDT601_REGIMEN_LABORAL_OPTIONS,
  resolvePdt601DueDate,
} from '../../components/activity/pdt601Config';
import FilePreviewModal from '../../components/FilePreviewModal';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activityModulePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import {
  supervisorsService,
  type SupervisorAttachment,
  type SupervisorDeclaration,
} from '../../services/supervisors';
import {
  pdt601Service,
  type Pdt601Detail,
  type Pdt601Planilla,
  type Pdt601PlanillaInput,
} from '../../services/pdt601';
import { currentPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import { downloadRemoteFile } from '../../utils/downloadFile';

const EMPTY_PLANILLA: Pdt601PlanillaInput = {
  sin_planilla: false,
  regimen_laboral: '',
  trabajadores_onp: 0,
  trabajadores_afp: 0,
  essalud: 0,
  onp: 0,
  afp: 0,
  sis: 0,
  rta_4ta: 0,
  rta_5ta: 0,
  sctr: 0,
  rh: 0,
  fecha_entrega: '',
  hora_entrega: '',
  observaciones: '',
  fecha_declaracion_pdt: '',
  nps: '',
  ticket_afp: '',
  estado_envio_boletas: '',
  fecha_envio_nps_tickets_boletas: '',
};

/** Campos que no aplican cuando se marca "sin planilla" (se limpian al activar el flag). */
const SIN_PLANILLA_RESET: Partial<Pdt601PlanillaInput> = {
  trabajadores_onp: 0,
  trabajadores_afp: 0,
  essalud: 0,
  onp: 0,
  afp: 0,
  sis: 0,
  rta_4ta: 0,
  rta_5ta: 0,
  sctr: 0,
  rh: 0,
  fecha_entrega: '',
  hora_entrega: '',
  fecha_declaracion_pdt: '',
  nps: '',
  ticket_afp: '',
  estado_envio_boletas: '',
  fecha_envio_nps_tickets_boletas: '',
};

/** Fecha de hoy (AAAA-MM-DD) y hora actual (HH:MM) en horario local — valor por defecto de
 * "Fecha/Hora de entrega" cuando el registro todavía no tiene uno guardado. */
function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowTimeStr(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Mapea la planilla que devuelve el backend al formulario editable. Si aún no hay fecha/hora de
 * entrega guardada, se prellenan con el momento actual (no pisa un valor ya guardado) — salvo que
 * la empresa esté marcada "sin planilla": ahí no aplica seguimiento, así que NO se autocompleta
 * (si se autocompletara, un guardado posterior por otro motivo, p. ej. corregir Observaciones,
 * persistiría una fecha/hora de entrega inventada para una empresa que no tiene nada que entregar). */
function planillaToInput(p: Pdt601Planilla | null | undefined): Pdt601PlanillaInput {
  const base: Pdt601PlanillaInput = !p
    ? { ...EMPTY_PLANILLA }
    : {
        sin_planilla: p.sin_planilla ?? false,
        regimen_laboral: p.regimen_laboral ?? '',
        trabajadores_onp: p.trabajadores_onp ?? 0,
        trabajadores_afp: p.trabajadores_afp ?? 0,
        essalud: p.essalud ?? 0,
        onp: p.onp ?? 0,
        afp: p.afp ?? 0,
        sis: p.sis ?? 0,
        rta_4ta: p.rta_4ta ?? 0,
        rta_5ta: p.rta_5ta ?? 0,
        sctr: p.sctr ?? 0,
        rh: p.rh ?? 0,
        fecha_entrega: p.fecha_entrega ?? '',
        hora_entrega: p.hora_entrega ?? '',
        observaciones: p.observaciones ?? '',
        fecha_declaracion_pdt: p.fecha_declaracion_pdt ?? '',
        nps: p.nps ?? '',
        ticket_afp: p.ticket_afp ?? '',
        estado_envio_boletas: p.estado_envio_boletas ?? '',
        fecha_envio_nps_tickets_boletas: p.fecha_envio_nps_tickets_boletas ?? '',
      };
  if (base.sin_planilla) {
    // Autocorrige registros previos a este fix que hayan quedado con fecha/hora de entrega (u
    // otro campo de seguimiento) colgada pese a estar marcados "sin planilla": si se guarda de
    // nuevo (p. ej. al corregir Observaciones), sale limpio.
    return { ...base, ...SIN_PLANILLA_RESET };
  }
  return {
    ...base,
    fecha_entrega: base.fecha_entrega || todayDateStr(),
    hora_entrega: base.hora_entrega || nowTimeStr(),
  };
}

const ESTADO_BOLETAS_OPTIONS = ['', 'Pendiente', 'Enviado', 'No corresponde'];
const NPS_OPTIONS = ['', 'OK', 'Detracciones', 'Parcial Detracc', 'No corresponde'];
const TICKET_AFP_OPTIONS = ['', 'Enviado', 'No corresponde'];

const PLANILLA_INPUT =
  'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-500';

/** Clase + ícono del banner de mensaje según resultado (éxito/error/info) — para que se note
 * claramente si una acción (guardar, cambiar estado, aprobar, observar) funcionó o no. */
function msgBannerClass(tone: 'success' | 'error' | 'info'): string {
  if (tone === 'success') return 'bg-emerald-50 border-emerald-200 text-emerald-800';
  if (tone === 'error') return 'bg-red-50 border-red-200 text-red-700';
  return 'bg-slate-50 border-slate-200 text-slate-700';
}
function msgBannerIcon(tone: 'success' | 'error' | 'info'): string {
  if (tone === 'success') return 'fa-check-circle';
  if (tone === 'error') return 'fa-exclamation-circle';
  return 'fa-info-circle';
}
/** Solo el color de texto (sin fondo/borde) — para repetir el mensaje junto al botón "Guardar". */
function msgTextClass(tone: 'success' | 'error' | 'info'): string {
  if (tone === 'success') return 'text-emerald-700';
  if (tone === 'error') return 'text-red-700';
  return 'text-slate-600';
}

type Pdt601DetailPageProps = {
  workspace: ActivityWorkspace;
};

const Pdt601DetailPage = ({ workspace }: Pdt601DetailPageProps) => {
  const { companyId: companyIdParam } = useParams();
  const companyId = Number(companyIdParam);
  const [searchParams] = useSearchParams();
  const periodYm = searchParams.get('period_ym') || currentPeriodYM();
  const listPath = `${activityModulePath(workspace, 'pdt-601')}?period_ym=${encodeURIComponent(periodYm)}`;

  const canUpdate = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsUpdate), []);
  const canObserve = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsObserve), []);
  const canApprove = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsApprove), []);
  const canReopen = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsReopen), []);
  const canUpload = useMemo(() => auth.hasPermission(P.supervisorsAttachmentsUpload), []);

  const [detail, setDetail] = useState<Pdt601Detail | null>(null);
  const [attachments, setAttachments] = useState<SupervisorAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [msgTone, setMsgTone] = useState<'success' | 'error' | 'info'>('info');
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [planilla, setPlanilla] = useState<Pdt601PlanillaInput>({ ...EMPTY_PLANILLA });
  const [planillaSaving, setPlanillaSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const declaration = detail?.declaration;
  // El asistente solo registra Fecha/Hora de entrega — el resto del seguimiento (declaración PDT,
  // NPS, ticket AFP, envío de boletas) lo completa el supervisor después de revisar.
  const seguimientoReadOnlyForAssistant = workspace === 'assistant';
  // "Revisión supervisor" solo se muestra en el workspace supervisor (ver más abajo) — cuando no
  // se muestra, la tarjeta "Empresa" pasa a ocupar todo el ancho en vez de quedar en una grilla de
  // 2 columnas con la mitad derecha vacía.
  const showRevisionSupervisor = workspace === 'supervisor' && (canApprove || canObserve);
  // Terminal: una vez "Entregado", nadie edita nada (ni el asistente ni el supervisor) salvo que se
  // reabra con el permiso dedicado — docs/diseno-estados-pdt601-pdt621-2026-09-16.md §8. Antes esto
  // solo bloqueaba al asistente (assistantLocked); ahora aplica a los dos roles por igual.
  const declarationLocked = !!declaration && PDT601_TERMINAL_STATUSES.has(declaration.status);
  // Suspendida (docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.7) ya NO se marca desde este
  // módulo — se lee de solo lectura desde el control (Control de Detracciones es el único que la
  // escribe). formLocked bloquea el formulario igual que declarationLocked.
  const controlSuspendida = !!detail?.control_suspendida;
  const formLocked = declarationLocked || controlSuspendida;
  const displayStatus = useMemo(
    () =>
      pdt601DisplayStatus({
        status: declaration?.status ?? '',
        sinPlanilla: planilla.sin_planilla,
        suspendida: controlSuspendida,
        timeliness: detail?.timeliness,
      }),
    [declaration?.status, planilla.sin_planilla, controlSuspendida, detail?.timeliness],
  );
  const trabajadoresTotal = (planilla.trabajadores_onp || 0) + (planilla.trabajadores_afp || 0);
  // RH queda fuera de "Total aportes" a pedido — no se suma junto con ESSALUD/ONP/AFP/SIS/4TA/5TA/SCTR.
  const totalAportes =
    (planilla.essalud || 0) +
    (planilla.onp || 0) +
    (planilla.afp || 0) +
    (planilla.sis || 0) +
    (planilla.rta_4ta || 0) +
    (planilla.rta_5ta || 0) +
    (planilla.sctr || 0);

  const showMsg = (text: string, tone: 'success' | 'error' | 'info' = 'info') => {
    setMsg(text);
    setMsgTone(tone);
  };

  const patchPlanilla = (patch: Partial<Pdt601PlanillaInput>) => {
    setPlanilla((prev) => ({ ...prev, ...patch }));
  };
  const patchPlanillaNumber = (key: keyof Pdt601PlanillaInput, raw: string) => {
    const n = Number(raw);
    patchPlanilla({ [key]: Number.isFinite(n) ? n : 0 } as Partial<Pdt601PlanillaInput>);
  };
  const handleToggleSinPlanilla = (checked: boolean) => {
    setPlanilla((prev) =>
      checked
        ? { ...prev, sin_planilla: true, ...SIN_PLANILLA_RESET }
        : {
            ...prev,
            sin_planilla: false,
            fecha_entrega: prev.fecha_entrega || todayDateStr(),
            hora_entrega: prev.hora_entrega || nowTimeStr(),
          },
    );
  };

  // Fecha límite por grupo de RUC del calendario interno (docs/diseno-limpieza-control-detail-2026-
  // 09-16.md §5.7b) — reemplaza a declaration.due_date (0% de uso real, §3.1) como fuente de
  // "Vencimiento", con la fecha genérica del control como respaldo si el período no tiene ninguna
  // actividad "pdt_601" configurada en el calendario.
  const dueResolved = useMemo(() => {
    if (!detail || !declaration) return { dueDate: undefined, isOverdue: false, daysRemaining: null as number | null };
    const dueDate = resolvePdt601DueDate(detail.calendar_due_date, detail.control_due_date);
    const meta = computePdt601DueMeta(declaration.status, dueDate, detail.planilla?.sin_planilla, detail.control_suspendida);
    return { dueDate, ...meta };
  }, [detail, declaration]);

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
      const data = await pdt601Service.getDetail(companyId, periodYm);
      setDetail(data);
      setPlanilla(planillaToInput(data.planilla));
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
      const updated = await supervisorsService.reopenDeclaration(declaration.id, reason);
      refreshDeclaration(updated);
      setReopenReason('');
      setReopenOpen(false);
      showMsg('Declaración reabierta — volvió a "Por revisar".', 'success');
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'No se pudo reabrir.'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!declaration || !canUpload || !files?.length) return;
    try {
      setUploading(true);
      showMsg('');
      for (const file of Array.from(files)) {
        await supervisorsService.uploadAttachment(detail!.control_id, declaration.id, file);
      }
      await loadAttachments(declaration.id);
      showMsg('Archivo(s) subido(s) correctamente.', 'success');
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'Error al subir archivo.'), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSavePlanilla = async () => {
    if (!canUpdate || formLocked) return;
    // Régimen laboral es obligatorio siempre (a diferencia de NPS/Ticket AFP, que solo aplican al
    // seguimiento del supervisor): se muestra y edita en la tarjeta "Empresa", visible para ambos
    // workspaces, independientemente de sin_planilla/suspendida.
    if (!planilla.regimen_laboral) {
      showMsg('Seleccione el régimen laboral.', 'error');
      return;
    }
    // NPS/Ticket AFP los completa el supervisor en el seguimiento posterior — el asistente no
    // puede editarlos (quedan readonly), así que exigirlos acá lo dejaría sin poder guardar nunca.
    if (!planilla.sin_planilla && !controlSuspendida && workspace !== 'assistant') {
      if (!planilla.nps) {
        showMsg('Seleccione un valor para NPS.', 'error');
        return;
      }
      if (!planilla.ticket_afp) {
        showMsg('Seleccione un valor para Ticket AFP.', 'error');
        return;
      }
    }
    try {
      setPlanillaSaving(true);
      showMsg('');
      const updated = await pdt601Service.savePlanilla(companyId, periodYm, planilla);
      // El guardado puede haber disparado la entrega automática (Pendiente/Observado → Por revisar,
      // docs/diseno-estados-pdt601-pdt621-2026-09-16.md §9) — se refleja acá también el estado y la
      // puntualidad recalculada, no solo la planilla.
      setDetail((d) =>
        d
          ? {
              ...d,
              planilla: updated.planilla,
              declaration: updated.declaration,
              timeliness: updated.timeliness,
              control_suspendida: updated.control_suspendida,
            }
          : d,
      );
      setPlanilla(planillaToInput(updated.planilla));
      showMsg('Planilla guardada correctamente.', 'success');
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'No se pudo guardar la planilla.'), 'error');
    } finally {
      setPlanillaSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!declaration || !canApprove) return;
    try {
      setActionLoading(true);
      showMsg('');
      const updated = await supervisorsService.approveDeclaration(declaration.id);
      refreshDeclaration(updated);
      showMsg('Declaración aprobada.', 'success');
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
      const updated = await supervisorsService.observeDeclaration(declaration.id, notes);
      refreshDeclaration(updated);
      setSupervisorNotes('');
      showMsg('Observación registrada.', 'success');
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'No se pudo observar.'), 'error');
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
          Control Planillas PDT 601 — {detail.business_name}
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

      <div className={`grid gap-4 ${showRevisionSupervisor ? 'lg:grid-cols-2' : ''}`}>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Empresa</h2>
          {/* Bloques independientes (no dt/dd en fila) para que etiqueta+valor de cada campo se
              mantengan juntos sin importar en cuántas columnas se acomoden. */}
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
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${displayStatus.className}`}>
                  {displayStatus.label}
                </span>
              </p>
            </div>
            <div>
              <p className="text-slate-500">Vencimiento</p>
              <p className={dueResolved.isOverdue ? 'text-red-700 font-medium' : 'text-slate-800'}>
                {formatPdt601DueDetail(dueResolved.dueDate, dueResolved.isOverdue, dueResolved.daysRemaining)}
              </p>
            </div>
            {!showRevisionSupervisor && canUpdate ? (
              <div>
                <p className="text-slate-500 mb-1">Régimen laboral</p>
                <select
                  required
                  value={planilla.regimen_laboral}
                  disabled={formLocked}
                  onChange={(e) => patchPlanilla({ regimen_laboral: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-500"
                >
                  {PDT601_REGIMEN_LABORAL_OPTIONS.map((opt) => (
                    <option key={opt.value || 'none'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          {showRevisionSupervisor && canUpdate ? (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Régimen laboral</label>
              <select
                required
                value={planilla.regimen_laboral}
                disabled={formLocked}
                onChange={(e) => patchPlanilla({ regimen_laboral: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-500"
              >
                {PDT601_REGIMEN_LABORAL_OPTIONS.map((opt) => (
                  <option key={opt.value || 'none'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {showRevisionSupervisor && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Revisión supervisor</h2>
            {controlSuspendida ? (
              // Suspendida bloquea TODO registro, incluido el flujo de observar/aprobar.
              <p className="flex items-start gap-2 text-sm text-slate-500">
                <i className="fas fa-ban mt-0.5 text-purple-600" aria-hidden />
                Esta empresa está marcada "Suspendida" en este período (desde Control de
                Detracciones) — no aplica observar ni aprobar.
              </p>
            ) : planilla.sin_planilla ? (
              // Sin planilla no hay nada que revisar/aprobar.
              <p className="flex items-start gap-2 text-sm text-slate-500">
                <i className="fas fa-ban mt-0.5 text-amber-600" aria-hidden />
                Esta empresa está marcada "Sin planilla" en este período — no aplica observar ni
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
              // Todavía no hay nada que revisar (Pendiente) u observado esperando corrección — los
              // botones de Observar/Aprobar solo aplican desde "Por revisar".
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
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Planilla PDT 601 — Período {periodYm}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Datos de planilla del período. Se guardan por empresa y período.
          </p>
        </div>

        {declarationLocked ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-700">
            <i className="fas fa-lock mt-0.5" aria-hidden />
            <span>
              Esta declaración ya fue entregada ({displayStatus.label}) — no se puede editar. Si hace
              falta corregir algo, pida que la reabran.
            </span>
          </div>
        ) : null}

        {controlSuspendida ? (
          // Suspendida (§5.9.7) ya NO se marca desde este módulo — es de solo lectura, se marca
          // desde Control de Detracciones. Bloquea todo el formulario, igual que declarationLocked.
          <div className="flex items-start gap-2.5 rounded-lg border border-purple-300 bg-purple-50 px-3 py-2.5 text-sm text-purple-900">
            <i className="fas fa-ban mt-0.5" aria-hidden />
            <span>
              <span className="block font-medium">Esta empresa está suspendida en este período</span>
              <span className="block text-xs mt-0.5 opacity-80">
                Se marcó desde Control de Detracciones — no se puede editar nada acá mientras esté
                suspendida. Para reactivarla, desmarque la suspensión en Control de Detracciones.
              </span>
            </span>
          </div>
        ) : (
          <label
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${
              planilla.sin_planilla
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-slate-200 bg-slate-50 text-slate-700'
            } ${canUpdate && !formLocked ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
          >
            <input
              type="checkbox"
              disabled={!canUpdate || formLocked}
              checked={planilla.sin_planilla}
              onChange={(e) => handleToggleSinPlanilla(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span>
              <span className="block font-medium">Esta empresa no tiene planilla en este período</span>
              <span className="block text-xs mt-0.5 opacity-80">
                No es necesario registrar N° de trabajadores, importes ni seguimiento.
              </span>
            </span>
          </label>
        )}

        {!planilla.sin_planilla && !controlSuspendida ? (
          <>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                N° de trabajadores
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">ONP</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    disabled={!canUpdate || declarationLocked}
                    value={planilla.trabajadores_onp || ''}
                    onChange={(e) => patchPlanillaNumber('trabajadores_onp', e.target.value)}
                    placeholder="0"
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">AFP</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    disabled={!canUpdate || declarationLocked}
                    value={planilla.trabajadores_afp || ''}
                    onChange={(e) => patchPlanillaNumber('trabajadores_afp', e.target.value)}
                    placeholder="0"
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Total</label>
                  <input
                    type="number"
                    disabled
                    value={trabajadoresTotal}
                    className={`${PLANILLA_INPUT} font-semibold`}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                PDT 601 (importes)
              </h3>
              <div className="grid gap-3 sm:grid-cols-4">
                {([
                  ['essalud', 'ESSALUD'],
                  ['onp', 'ONP'],
                  ['afp', 'AFP'],
                  ['sis', 'SIS'],
                  ['rta_4ta', '4TA'],
                  ['rta_5ta', '5TA'],
                  ['sctr', 'SCTR'],
                  ['rh', 'RH'],
                ] as Array<[keyof Pdt601PlanillaInput, string]>).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs text-slate-500 mb-1">{label}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!canUpdate || declarationLocked}
                      value={(planilla[key] as number) || ''}
                      onChange={(e) => patchPlanillaNumber(key, e.target.value)}
                      placeholder="0.00"
                      className={PLANILLA_INPUT}
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Total aportes</label>
                  <input
                    type="number"
                    disabled
                    value={totalAportes.toFixed(2)}
                    className={`${PLANILLA_INPUT} font-semibold`}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Seguimiento
              </h3>
              {seguimientoReadOnlyForAssistant ? (
                <p className="text-xs text-slate-500 mb-2">
                  Registre la fecha y hora de entrega. Los demás campos de seguimiento los completa el supervisor.
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha de entrega</label>
                  <input
                    type="date"
                    disabled={!canUpdate || declarationLocked}
                    value={planilla.fecha_entrega}
                    onChange={(e) => patchPlanilla({ fecha_entrega: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Hora de entrega</label>
                  <input
                    type="time"
                    disabled={!canUpdate || declarationLocked}
                    value={planilla.hora_entrega}
                    onChange={(e) => patchPlanilla({ hora_entrega: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha de declaración PDT</label>
                  <input
                    type="date"
                    disabled={!canUpdate || declarationLocked || seguimientoReadOnlyForAssistant}
                    value={planilla.fecha_declaracion_pdt}
                    onChange={(e) => patchPlanilla({ fecha_declaracion_pdt: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">NPS</label>
                  <select
                    required={!seguimientoReadOnlyForAssistant}
                    disabled={!canUpdate || declarationLocked || seguimientoReadOnlyForAssistant}
                    value={planilla.nps}
                    onChange={(e) => patchPlanilla({ nps: e.target.value })}
                    className={PLANILLA_INPUT}
                  >
                    {NPS_OPTIONS.map((opt) => (
                      <option key={opt || 'none'} value={opt}>
                        {opt || 'Seleccione'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Ticket AFP</label>
                  <select
                    required={!seguimientoReadOnlyForAssistant}
                    disabled={!canUpdate || declarationLocked || seguimientoReadOnlyForAssistant}
                    value={planilla.ticket_afp}
                    onChange={(e) => patchPlanilla({ ticket_afp: e.target.value })}
                    className={PLANILLA_INPUT}
                  >
                    {TICKET_AFP_OPTIONS.map((opt) => (
                      <option key={opt || 'none'} value={opt}>
                        {opt || 'Seleccione'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Estado de envío boletas de trabajadores</label>
                  <select
                    disabled={!canUpdate || declarationLocked || seguimientoReadOnlyForAssistant}
                    value={planilla.estado_envio_boletas}
                    onChange={(e) => patchPlanilla({ estado_envio_boletas: e.target.value })}
                    className={PLANILLA_INPUT}
                  >
                    {ESTADO_BOLETAS_OPTIONS.map((opt) => (
                      <option key={opt || 'none'} value={opt}>
                        {opt || '—'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha de envío de NPS, tickets y boletas</label>
                  <input
                    type="date"
                    disabled={!canUpdate || declarationLocked || seguimientoReadOnlyForAssistant}
                    value={planilla.fecha_envio_nps_tickets_boletas}
                    onChange={(e) => patchPlanilla({ fecha_envio_nps_tickets_boletas: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
              </div>
            </div>
          </>
        ) : null}

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
            Observaciones
          </label>
          <textarea
            rows={2}
            disabled={!canUpdate || formLocked}
            value={planilla.observaciones}
            onChange={(e) => patchPlanilla({ observaciones: e.target.value })}
            placeholder="Observaciones de la planilla…"
            className={PLANILLA_INPUT}
          />
        </div>

        {canUpdate ? (
          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {/* Mismo mensaje que arriba, repetido acá: el botón queda al final de un formulario
                largo — sin esto, guardar no parecía hacer nada porque la confirmación aparecía
                fuera de la vista, arriba de todo. */}
            {msg ? (
              <span className={`flex items-center gap-1.5 text-sm font-medium ${msgTextClass(msgTone)}`}>
                <i className={`fas ${msgBannerIcon(msgTone)}`} aria-hidden />
                {msg}
              </span>
            ) : null}
            <button
              type="button"
              disabled={planillaSaving || formLocked}
              onClick={() => void handleSavePlanilla()}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {planillaSaving ? 'Guardando…' : 'Guardar planilla'}
            </button>
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">PDT 601 ({attachments.length})</h2>
          {canUpload ? (
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium cursor-pointer hover:bg-primary-700">
              <i className="fas fa-upload" aria-hidden />
              {uploading ? 'Subiendo…' : 'Cargar PDT 601'}
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

export default Pdt601DetailPage;
