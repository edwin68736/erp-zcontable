import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  computePdt601DueMeta,
  formatPdt601DueDetail,
  pdt601StatusBadgeClass,
  pdt601StatusLabel,
  PDT601_APPROVED_STATUSES,
  resolvePdt601DueDate,
} from '../../components/activity/pdt601Config';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activityModulePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { supervisorsService, type SupervisorDeclaration } from '../../services/supervisors';
import {
  pdt601Service,
  type Pdt601Detail,
  type Pdt601Planilla,
  type Pdt601PlanillaInput,
} from '../../services/pdt601';
import { currentPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';

const EMPTY_PLANILLA: Pdt601PlanillaInput = {
  sin_planilla: false,
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
 * entrega guardada, se prellenan con el momento actual (no pisa un valor ya guardado). */
function planillaToInput(p: Pdt601Planilla | null | undefined): Pdt601PlanillaInput {
  const base: Pdt601PlanillaInput = !p
    ? { ...EMPTY_PLANILLA }
    : {
        sin_planilla: p.sin_planilla ?? false,
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
  return {
    ...base,
    fecha_entrega: base.fecha_entrega || todayDateStr(),
    hora_entrega: base.hora_entrega || nowTimeStr(),
  };
}

/** Estados que ve el asistente en "Cambiar estado": el flujo de revisión (En revisión, Observado,
 * Aprobado, ...) lo maneja el supervisor después de que el asistente entrega sus datos. */
const ASSISTANT_STATUS_OPTIONS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_elaboracion', label: 'En elaboración' },
  { value: 'sin_planilla', label: 'Sin planilla' },
];

/** Estados que ve el supervisor al revisar lo que entregó el asistente — "Pendiente"/"En
 * elaboración" son etapas del asistente, no algo que el supervisor deba fijar. "Observado" y
 * "Aprobado" TAMPOCO están acá a propósito: ya tienen sus propios botones dedicados más abajo
 * ("Observar"/"Aprobar", panel "Revisión supervisor"), que además de cambiar el estado hacen cosas
 * que este select genérico no hace — Observar exige y guarda la nota, crea el registro de
 * observación y actualiza el estado del control mensual; Aprobar registra quién aprobó y el
 * avance. Dejarlos acá permitiría "aprobar"/"observar" sin nada de eso, así que solo se ofrece
 * "En revisión" (sin acción dedicada propia) y "Sin planilla" (compartido con el asistente). */
const SUPERVISOR_STATUS_OPTIONS = [
  { value: 'en_revision', label: 'En revisión' },
  { value: 'sin_planilla', label: 'Sin planilla' },
];

const STATUS_OPTIONS_BY_WORKSPACE: Record<ActivityWorkspace, { value: string; label: string }[]> = {
  assistant: ASSISTANT_STATUS_OPTIONS,
  supervisor: SUPERVISOR_STATUS_OPTIONS,
};

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

  const [detail, setDetail] = useState<Pdt601Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [msgTone, setMsgTone] = useState<'success' | 'error' | 'info'>('info');
  const [statusSaving, setStatusSaving] = useState(false);
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [planilla, setPlanilla] = useState<Pdt601PlanillaInput>({ ...EMPTY_PLANILLA });
  const [planillaSaving, setPlanillaSaving] = useState(false);

  const declaration = detail?.declaration;
  // El asistente solo registra Fecha/Hora de entrega — el resto del seguimiento (declaración PDT,
  // NPS, ticket AFP, envío de boletas) lo completa el supervisor después de revisar.
  const seguimientoReadOnlyForAssistant = workspace === 'assistant';
  // "Revisión supervisor" solo se muestra en el workspace supervisor (ver más abajo) — cuando no
  // se muestra, la tarjeta "Empresa" pasa a ocupar todo el ancho en vez de quedar en una grilla de
  // 2 columnas con la mitad derecha vacía.
  const showRevisionSupervisor = workspace === 'supervisor' && (canApprove || canObserve);
  // Una vez que el supervisor aprobó (o pasó a presentado/cerrado), el asistente ya no puede seguir
  // editando su registro — el supervisor sí conserva edición para corregir/reabrir si hace falta.
  const assistantLocked = workspace === 'assistant' && !!declaration && PDT601_APPROVED_STATUSES.has(declaration.status);
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

  // "Cambiar estado" une el estado de la declaración con planilla.sin_planilla en un solo select,
  // acotado a lo que le corresponde fijar a cada workspace (ver STATUS_OPTIONS_BY_WORKSPACE) — el
  // asistente entrega (Pendiente/En elaboración/Sin planilla), el supervisor revisa (En revisión/
  // Observado/Aprobado/Sin planilla). "Sin planilla" no es un estado de la declaración — es
  // planilla.sin_planilla — así que se muestra/edita acá pero no dispara handleStatusChange.
  const combinedStatusValue = planilla.sin_planilla ? 'sin_planilla' : declaration?.status ?? '';
  const statusSelectOptions = useMemo(() => {
    const base = STATUS_OPTIONS_BY_WORKSPACE[workspace];
    if (base.some((o) => o.value === combinedStatusValue)) {
      return base;
    }
    // El estado real quedó fuera del set reducido (p. ej. una etapa de la que ya no es dueño este
    // workspace): se antepone para que el select siga reflejando la realidad en vez de mostrar un
    // valor que no corresponde.
    return [{ value: combinedStatusValue, label: pdt601StatusLabel(combinedStatusValue) }, ...base];
  }, [workspace, combinedStatusValue]);

  const handleCombinedStatusChange = async (value: string) => {
    if (assistantLocked) return;
    if (value === 'sin_planilla') {
      if (!planilla.sin_planilla) handleToggleSinPlanilla(true);
      return;
    }
    if (planilla.sin_planilla) handleToggleSinPlanilla(false);
    if (value !== declaration?.status) {
      await handleStatusChange(value);
    }
  };

  const dueResolved = useMemo(() => {
    if (!detail || !declaration) return { dueDate: undefined, isOverdue: false, daysRemaining: null as number | null };
    const dueDate = resolvePdt601DueDate(declaration.due_date, detail.control_due_date);
    const meta = computePdt601DueMeta(declaration.status, dueDate, detail.planilla?.sin_planilla);
    return { dueDate, ...meta };
  }, [detail, declaration]);

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
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar el detalle.'));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, periodYm]);

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
      showMsg('');
      const updated = await supervisorsService.updateDeclaration(declaration.id, { status });
      refreshDeclaration(updated);
      showMsg('Estado actualizado.', 'success');
    } catch (err) {
      showMsg(extractApiErrorMessage(err, 'No se pudo actualizar el estado.'), 'error');
    } finally {
      setStatusSaving(false);
    }
  };

  const handleSavePlanilla = async () => {
    if (!canUpdate || assistantLocked) return;
    // NPS/Ticket AFP los completa el supervisor en el seguimiento posterior — el asistente no
    // puede editarlos (quedan readonly), así que exigirlos acá lo dejaría sin poder guardar nunca.
    if (!planilla.sin_planilla && workspace !== 'assistant') {
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
      setDetail((d) => (d ? { ...d, planilla: updated.planilla } : d));
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
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pdt601StatusBadgeClass(combinedStatusValue)}`}
                >
                  {pdt601StatusLabel(combinedStatusValue)}
                </span>
              </p>
            </div>
            <div>
              <p className="text-slate-500">Vencimiento</p>
              <p className={dueResolved.isOverdue ? 'text-red-700 font-medium' : 'text-slate-800'}>
                {formatPdt601DueDetail(dueResolved.dueDate, dueResolved.isOverdue, dueResolved.daysRemaining)}
              </p>
            </div>
            {/* Ancho completo (asistente, o supervisor sin panel de revisión): "Cambiar estado"
                entra en la misma fila horizontal que Asistente/Estado/Vencimiento en vez de quedar
                debajo, en su propio bloque. */}
            {!showRevisionSupervisor && canUpdate ? (
              <div>
                <p className="text-slate-500 mb-1">Cambiar estado</p>
                <select
                  value={combinedStatusValue}
                  disabled={statusSaving || assistantLocked}
                  onChange={(e) => void handleCombinedStatusChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-500"
                >
                  {statusSelectOptions.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          {showRevisionSupervisor && canUpdate ? (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Cambiar estado</label>
              <select
                value={combinedStatusValue}
                disabled={statusSaving}
                onChange={(e) => void handleCombinedStatusChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
              >
                {statusSelectOptions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {showRevisionSupervisor && (
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
                disabled={actionLoading || PDT601_APPROVED_STATUSES.has(declaration.status)}
                onClick={() => void handleApprove()}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                Aprobar
              </button>
            ) : null}
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

        {assistantLocked ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-700">
            <i className="fas fa-lock mt-0.5" aria-hidden />
            <span>
              El supervisor ya revisó esta planilla ({pdt601StatusLabel(combinedStatusValue)}) — ya no se puede
              editar. Si hace falta corregir algo, coordine con el supervisor.
            </span>
          </div>
        ) : null}

        {workspace === 'assistant' ? (
          // La vista asistente no repite el toggle acá: "Sin planilla" se elige arriba, en el
          // select "Cambiar estado" (unificado con Pendiente/En elaboración) — esto solo confirma
          // visualmente la elección cuando corresponde.
          planilla.sin_planilla ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <i className="fas fa-ban mt-0.5" aria-hidden />
              <span>
                <span className="block font-medium">Esta empresa no tiene planilla en este período</span>
                <span className="block text-xs mt-0.5 opacity-80">
                  No es necesario registrar N° de trabajadores, importes ni seguimiento.
                </span>
              </span>
            </div>
          ) : null
        ) : (
          <label
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${
              planilla.sin_planilla
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-slate-200 bg-slate-50 text-slate-700'
            } ${canUpdate ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
          >
            <input
              type="checkbox"
              disabled={!canUpdate}
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

        {!planilla.sin_planilla ? (
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
                    disabled={!canUpdate || assistantLocked}
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
                    disabled={!canUpdate || assistantLocked}
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
                      disabled={!canUpdate || assistantLocked}
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
                    disabled={!canUpdate || assistantLocked}
                    value={planilla.fecha_entrega}
                    onChange={(e) => patchPlanilla({ fecha_entrega: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Hora de entrega</label>
                  <input
                    type="time"
                    disabled={!canUpdate || assistantLocked}
                    value={planilla.hora_entrega}
                    onChange={(e) => patchPlanilla({ hora_entrega: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha de declaración PDT</label>
                  <input
                    type="date"
                    disabled={!canUpdate || seguimientoReadOnlyForAssistant}
                    value={planilla.fecha_declaracion_pdt}
                    onChange={(e) => patchPlanilla({ fecha_declaracion_pdt: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">NPS</label>
                  <select
                    required={!seguimientoReadOnlyForAssistant}
                    disabled={!canUpdate || seguimientoReadOnlyForAssistant}
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
                    disabled={!canUpdate || seguimientoReadOnlyForAssistant}
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
                    disabled={!canUpdate || seguimientoReadOnlyForAssistant}
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
                    disabled={!canUpdate || seguimientoReadOnlyForAssistant}
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
            disabled={!canUpdate || assistantLocked}
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
              disabled={planillaSaving || assistantLocked}
              onClick={() => void handleSavePlanilla()}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {planillaSaving ? 'Guardando…' : 'Guardar planilla'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Pdt601DetailPage;
