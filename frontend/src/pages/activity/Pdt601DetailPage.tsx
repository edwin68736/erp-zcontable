import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  computePdt601DueMeta,
  formatPdt601DueDetail,
  pdt601StatusBadgeClass,
  pdt601StatusLabel,
  PDT601_STATUSES,
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

const PDT601_APPROVED_STATUSES = new Set(['aprobado', 'presentado', 'cerrado']);

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
  rh: 0,
  fecha_entrega: '',
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
  rh: 0,
  fecha_entrega: '',
  fecha_declaracion_pdt: '',
  nps: '',
  ticket_afp: '',
  estado_envio_boletas: '',
  fecha_envio_nps_tickets_boletas: '',
};

/** Mapea la planilla que devuelve el backend al formulario editable. */
function planillaToInput(p: Pdt601Planilla | null | undefined): Pdt601PlanillaInput {
  if (!p) return { ...EMPTY_PLANILLA };
  return {
    sin_planilla: p.sin_planilla ?? false,
    trabajadores_onp: p.trabajadores_onp ?? 0,
    trabajadores_afp: p.trabajadores_afp ?? 0,
    essalud: p.essalud ?? 0,
    onp: p.onp ?? 0,
    afp: p.afp ?? 0,
    sis: p.sis ?? 0,
    rta_4ta: p.rta_4ta ?? 0,
    rta_5ta: p.rta_5ta ?? 0,
    rh: p.rh ?? 0,
    fecha_entrega: p.fecha_entrega ?? '',
    observaciones: p.observaciones ?? '',
    fecha_declaracion_pdt: p.fecha_declaracion_pdt ?? '',
    nps: p.nps ?? '',
    ticket_afp: p.ticket_afp ?? '',
    estado_envio_boletas: p.estado_envio_boletas ?? '',
    fecha_envio_nps_tickets_boletas: p.fecha_envio_nps_tickets_boletas ?? '',
  };
}

const ESTADO_BOLETAS_OPTIONS = ['', 'Pendiente', 'Enviado', 'No corresponde'];

const PLANILLA_INPUT =
  'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-500';

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
  const [statusSaving, setStatusSaving] = useState(false);
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [planilla, setPlanilla] = useState<Pdt601PlanillaInput>({ ...EMPTY_PLANILLA });
  const [planillaSaving, setPlanillaSaving] = useState(false);

  const declaration = detail?.declaration;
  const trabajadoresTotal = (planilla.trabajadores_onp || 0) + (planilla.trabajadores_afp || 0);
  const totalAportes =
    (planilla.essalud || 0) +
    (planilla.onp || 0) +
    (planilla.afp || 0) +
    (planilla.sis || 0) +
    (planilla.rta_4ta || 0) +
    (planilla.rta_5ta || 0) +
    (planilla.rh || 0);

  const patchPlanilla = (patch: Partial<Pdt601PlanillaInput>) => {
    setPlanilla((prev) => ({ ...prev, ...patch }));
  };
  const patchPlanillaNumber = (key: keyof Pdt601PlanillaInput, raw: string) => {
    const n = Number(raw);
    patchPlanilla({ [key]: Number.isFinite(n) ? n : 0 } as Partial<Pdt601PlanillaInput>);
  };
  const handleToggleSinPlanilla = (checked: boolean) => {
    patchPlanilla(checked ? { sin_planilla: true, ...SIN_PLANILLA_RESET } : { sin_planilla: false });
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

  const handleSavePlanilla = async () => {
    if (!canUpdate) return;
    try {
      setPlanillaSaving(true);
      setMsg('');
      const updated = await pdt601Service.savePlanilla(companyId, periodYm, planilla);
      setDetail((d) => (d ? { ...d, planilla: updated.planilla } : d));
      setPlanilla(planillaToInput(updated.planilla));
      setMsg('Planilla guardada.');
    } catch (err) {
      setMsg(extractApiErrorMessage(err, 'No se pudo guardar la planilla.'));
    } finally {
      setPlanillaSaving(false);
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
          Control Planillas PDT 601 — {detail.business_name}
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
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pdt601StatusBadgeClass(declaration.status)}`}
              >
                {pdt601StatusLabel(declaration.status)}
              </span>
            </dd>
            <dt className="text-slate-500">Vencimiento</dt>
            <dd className={dueResolved.isOverdue ? 'text-red-700 font-medium' : 'text-slate-800'}>
              {formatPdt601DueDetail(dueResolved.dueDate, dueResolved.isOverdue, dueResolved.daysRemaining)}
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
                {PDT601_STATUSES.map((s) => (
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
                    disabled={!canUpdate}
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
                    disabled={!canUpdate}
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
                  ['rh', 'RH'],
                ] as Array<[keyof Pdt601PlanillaInput, string]>).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs text-slate-500 mb-1">{label}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!canUpdate}
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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha de entrega</label>
                  <input
                    type="date"
                    disabled={!canUpdate}
                    value={planilla.fecha_entrega}
                    onChange={(e) => patchPlanilla({ fecha_entrega: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fecha de declaración PDT</label>
                  <input
                    type="date"
                    disabled={!canUpdate}
                    value={planilla.fecha_declaracion_pdt}
                    onChange={(e) => patchPlanilla({ fecha_declaracion_pdt: e.target.value })}
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">NPS</label>
                  <input
                    type="text"
                    disabled={!canUpdate}
                    value={planilla.nps}
                    onChange={(e) => patchPlanilla({ nps: e.target.value })}
                    placeholder="—"
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Ticket AFP</label>
                  <input
                    type="text"
                    disabled={!canUpdate}
                    value={planilla.ticket_afp}
                    onChange={(e) => patchPlanilla({ ticket_afp: e.target.value })}
                    placeholder="—"
                    className={PLANILLA_INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Estado de envío boletas de trabajadores</label>
                  <select
                    disabled={!canUpdate}
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
                    disabled={!canUpdate}
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
            disabled={!canUpdate}
            value={planilla.observaciones}
            onChange={(e) => patchPlanilla({ observaciones: e.target.value })}
            placeholder="Observaciones de la planilla…"
            className={PLANILLA_INPUT}
          />
        </div>

        {canUpdate ? (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={planillaSaving}
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
