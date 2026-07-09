import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { resolveBackendUrl } from '../../api/client';
import SearchableSelect from '../../components/SearchableSelect';
import {
  supervisorsService,
  type SupervisorAttachment,
  type SupervisorChangeLog,
  type SupervisorDeclaration,
  type SupervisorMonthlyControl,
  type SupervisorNPS,
  type SupervisorObservation,
  type SupervisorTaxLiquidation,
} from '../../services/supervisors';
import { auth } from '../../services/auth';
import { usersService } from '../../services/users';
import { P } from '../../rbac/codes';
import type { User } from '../../types/dashboard';
import {
  activitiesBasePath,
  resolveActivityWorkspace,
} from '../../navigation/activityRoutes';
import {
  controlStatusLabel,
  declarationStatusLabel,
  declarationTypeLabel,
  liquidationValidationLabel,
  npsStatusLabel,
  priorityLabel,
  riskLevelLabel,
} from '../../utils/supervisorLabels';

function supervisorUserLabel(u?: { full_name?: string; username?: string }): string {
  return u?.full_name || u?.username || '—';
}

const SupervisorControlDetail = () => {
  const { id } = useParams();
  const location = useLocation();
  const workspace = resolveActivityWorkspace(location.pathname);
  const activitiesHub = activitiesBasePath(workspace);
  const controlId = Number(id);
  const canView = useMemo(() => auth.hasPermission(P.supervisorsControlsView), []);
  const canUpdateControl = useMemo(() => auth.hasPermission(P.supervisorsControlsUpdate), []);
  const canDeclUpdate = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsUpdate), []);
  const canDeclApprove = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsApprove), []);
  const canDeclObserve = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsObserve), []);
  const canLiqView = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsView), []);
  const canLiqUpdate = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsUpdate), []);
  const canLiqApprove = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsApprove), []);
  const canNpsView = useMemo(() => auth.hasPermission(P.supervisorsNPSView), []);
  const canNpsCreate = useMemo(() => auth.hasPermission(P.supervisorsNPSCreate), []);
  const canNpsUpdate = useMemo(() => auth.hasPermission(P.supervisorsNPSUpdate), []);
  const canNpsGenerate = useMemo(() => auth.hasPermission(P.supervisorsNPSGenerate), []);
  const canNpsDelete = useMemo(() => auth.hasPermission(P.supervisorsNPSDelete), []);
  const canNpsPay = useMemo(() => auth.hasPermission(P.supervisorsNPSRegisterPayment), []);
  const canObsView = useMemo(() => auth.hasPermission(P.supervisorsObservationsView), []);
  const canObsCreate = useMemo(() => auth.hasPermission(P.supervisorsObservationsCreate), []);
  const canHistory = useMemo(() => auth.hasPermission(P.supervisorsHistoryView), []);
  const canAttach = useMemo(() => auth.hasPermission(P.supervisorsAttachmentsUpload), []);
  const canPickUsers = useMemo(() => auth.hasPermission(P.usersView), []);
  /** Asistente: ejecuta sin aprobar. Supervisor: revisa/aprueba. */
  const isOperatorOnly = useMemo(
    () =>
      canDeclUpdate &&
      !canDeclApprove &&
      !canDeclObserve &&
      !canLiqApprove,
    [canDeclUpdate, canDeclApprove, canDeclObserve, canLiqApprove],
  );
  const isReviewer = useMemo(
    () => canDeclApprove || canDeclObserve || canLiqApprove,
    [canDeclApprove, canDeclObserve, canLiqApprove],
  );

  const [control, setControl] = useState<SupervisorMonthlyControl | null>(null);
  const [declarations, setDeclarations] = useState<SupervisorDeclaration[]>([]);
  const [liquidation, setLiquidation] = useState<SupervisorTaxLiquidation | null>(null);
  const [npsList, setNpsList] = useState<SupervisorNPS[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [observations, setObservations] = useState<SupervisorObservation[]>([]);
  const [history, setHistory] = useState<SupervisorChangeLog[]>([]);
  const [attachments, setAttachments] = useState<SupervisorAttachment[]>([]);
  const [declAttachments, setDeclAttachments] = useState<Record<number, SupervisorAttachment[]>>({});
  const [newObservation, setNewObservation] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'decl' | 'liq' | 'nps' | 'audit'>('decl');
  const [msg, setMsg] = useState('');
  const [liqForm, setLiqForm] = useState({
    igv: 0,
    renta_mensual: 0,
    otros_tributos: 0,
    notes: '',
    responsible_user_id: '',
    approver_user_id: '',
    validation_status: 'pendiente',
  });
  const [newNps, setNewNps] = useState({ tributo: 'IGV', importe: 0, payment_due_date: '' });
  const [editingNpsId, setEditingNpsId] = useState<number | null>(null);
  const [npsEdit, setNpsEdit] = useState({
    tributo: '',
    importe: 0,
    codigo_nps: '',
    payment_due_date: '',
    payment_status: 'pendiente_generar',
    notes: '',
  });

  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        value: String(u.id),
        label: u.name || u.username || `#${u.id}`,
        searchText: [u.username, u.email].filter(Boolean).join(' '),
      })),
    [users],
  );

  const load = useCallback(async () => {
    if (!controlId) return;
    try {
      const [ctrl, decls] = await Promise.all([
        supervisorsService.getControl(controlId),
        supervisorsService.listDeclarations(controlId),
      ]);
      setControl(ctrl);
      setDeclarations(decls);
      if (canAttach || canObsView) {
        try {
          const allAtt = await supervisorsService.listAttachments(controlId);
          const byDecl: Record<number, SupervisorAttachment[]> = {};
          for (const a of allAtt) {
            if (a.declaration_id) {
              const did = a.declaration_id;
              if (!byDecl[did]) byDecl[did] = [];
              byDecl[did].push(a);
            }
          }
          setDeclAttachments(byDecl);
        } catch {
          setDeclAttachments({});
        }
      }
      if (canLiqView) {
        try {
          const liq = await supervisorsService.getLiquidation(controlId);
          setLiquidation(liq);
          setLiqForm({
            igv: liq.igv,
            renta_mensual: liq.renta_mensual,
            otros_tributos: liq.otros_tributos,
            notes: liq.notes || '',
            responsible_user_id: liq.responsible_user_id ? String(liq.responsible_user_id) : '',
            approver_user_id: liq.approver_user_id ? String(liq.approver_user_id) : '',
            validation_status: liq.validation_status || 'pendiente',
          });
        } catch {
          setLiquidation(null);
        }
      }
      if (canNpsView) {
        setNpsList(await supervisorsService.listNPS(controlId));
      }
      setMsg('');
    } catch {
      setMsg('No se pudo cargar el control');
    }
  }, [controlId, canLiqView, canNpsView, canAttach, canObsView]);

  useEffect(() => {
    if (canView && controlId) void load();
  }, [canView, controlId, load]);

  useEffect(() => {
    if ((!canUpdateControl && !canLiqUpdate && !canDeclUpdate) || !canPickUsers) return;
    void usersService.list().then(setUsers).catch(() => setUsers([]));
  }, [canUpdateControl, canLiqUpdate, canDeclUpdate, canPickUsers]);

  const loadAudit = useCallback(async () => {
    if (!controlId) return;
    const tasks: Promise<void>[] = [];
    if (canObsView) {
      tasks.push(
        supervisorsService.listObservations(controlId).then(setObservations).catch(() => setObservations([])),
      );
    }
    if (canHistory) {
      tasks.push(
        supervisorsService
          .listHistory('monthly_control', controlId)
          .then(setHistory)
          .catch(() => setHistory([])),
      );
    }
    if (canObsView || canAttach) {
      tasks.push(
        supervisorsService.listAttachments(controlId).then(setAttachments).catch(() => setAttachments([])),
      );
    }
    await Promise.all(tasks);
  }, [controlId, canObsView, canHistory, canAttach]);

  useEffect(() => {
    if (tab === 'audit' && controlId) void loadAudit();
  }, [tab, controlId, loadAudit]);

  const saveControlField = async (patch: Record<string, unknown>) => {
    if (!control) return;
    try {
      const updated = await supervisorsService.updateControl(control.id, patch);
      setControl(updated);
      setMsg('');
    } catch {
      setMsg('Error al actualizar el control');
    }
  };

  const addObservation = async () => {
    if (!controlId || !newObservation.trim()) return;
    try {
      await supervisorsService.createObservation({ monthly_control_id: controlId, body: newObservation.trim() });
      setNewObservation('');
      await loadAudit();
    } catch {
      setMsg('No se pudo registrar la observación');
    }
  };

  const uploadFile = async (file: File, declarationId = 0) => {
    if (!controlId) return;
    try {
      await supervisorsService.uploadAttachment(controlId, declarationId, file);
      if (declarationId > 0) {
        await load();
      } else {
        await loadAudit();
      }
    } catch {
      setMsg('Error al subir el archivo');
    }
  };

  const patchDeclaration = async (id: number, body: Parameters<typeof supervisorsService.updateDeclaration>[1]) => {
    try {
      await supervisorsService.updateDeclaration(id, body);
      await load();
    } catch {
      setMsg('No se pudo actualizar la declaración');
    }
  };

  const saveLiquidation = async () => {
    if (!controlId) return;
    try {
      await supervisorsService.updateLiquidation(controlId, {
        igv: liqForm.igv,
        renta_mensual: liqForm.renta_mensual,
        otros_tributos: liqForm.otros_tributos,
        notes: liqForm.notes,
        validation_status: liqForm.validation_status,
        responsible_user_id: liqForm.responsible_user_id ? Number(liqForm.responsible_user_id) : 0,
        approver_user_id: liqForm.approver_user_id ? Number(liqForm.approver_user_id) : 0,
      });
      await load();
      setMsg('Liquidación guardada.');
    } catch {
      setMsg('Error al guardar liquidación');
    }
  };

  const addNps = async () => {
    if (!controlId) return;
    try {
      await supervisorsService.createNPS({
        monthly_control_id: controlId,
        tributo: newNps.tributo,
        importe: newNps.importe,
        payment_due_date: newNps.payment_due_date || undefined,
      });
      setNewNps({ tributo: 'IGV', importe: 0, payment_due_date: '' });
      setNpsList(await supervisorsService.listNPS(controlId));
    } catch {
      setMsg('Error al crear NPS');
    }
  };

  const startEditNps = (n: SupervisorNPS) => {
    setEditingNpsId(n.id);
    setNpsEdit({
      tributo: n.tributo,
      importe: n.importe,
      codigo_nps: n.codigo_nps ?? '',
      payment_due_date: n.payment_due_date?.slice(0, 10) ?? '',
      payment_status: n.payment_status,
      notes: n.notes ?? '',
    });
  };

  const saveNpsEdit = async () => {
    if (!editingNpsId || !controlId) return;
    try {
      await supervisorsService.updateNPS(editingNpsId, {
        tributo: npsEdit.tributo,
        importe: npsEdit.importe,
        codigo_nps: npsEdit.codigo_nps,
        payment_status: npsEdit.payment_status,
        payment_due_date: npsEdit.payment_due_date || null,
        notes: npsEdit.notes,
      });
      setEditingNpsId(null);
      setNpsList(await supervisorsService.listNPS(controlId));
      setMsg('NPS actualizado.');
    } catch {
      setMsg('Error al actualizar NPS');
    }
  };

  if (!canView || !controlId) {
    return <p className="p-6 text-center text-slate-600">Sin permiso o ID inválido.</p>;
  }

  if (!control) {
    return <p className="p-6 text-center text-slate-500">{msg || 'Cargando…'}</p>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Link to={activitiesHub} className="text-sm text-primary-700">
          ← Volver al hub de actividades
        </Link>
        {isReviewer && !isOperatorOnly ? (
          <p className="text-xs text-slate-500 mt-1">Modo revisión: apruebe u observe el trabajo del asistente.</p>
        ) : isOperatorOnly ? (
          <p className="text-xs text-slate-500 mt-1">Modo operación: registre avance y documentos; el supervisor revisará.</p>
        ) : null}
        <h2 className="text-xl font-semibold text-slate-800 mt-2">
          {control.company?.business_name ?? `Empresa #${control.company_id}`}
        </h2>
        <p className="text-sm text-slate-500">
          Período {control.period_ym} · {controlStatusLabel(control.general_status)} · Riesgo{' '}
          {riskLevelLabel(control.risk_level)}
        </p>
      </div>

      {msg ? <p className="text-sm text-red-600">{msg}</p> : null}

      {canUpdateControl ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void supervisorsService.registerInfoReceived(control.id).then((c) => {
                setControl(c);
                setMsg('Información registrada como recibida.');
              });
            }}
            className="px-4 py-2 rounded-full border border-primary-200 text-primary-800 text-sm font-medium hover:bg-primary-50"
          >
            Registrar recepción de información
          </button>
          {control.info_received_at ? (
            <span className="text-xs text-slate-500 self-center">
              Recibida: {new Date(control.info_received_at).toLocaleString()}
            </span>
          ) : null}
        </div>
      ) : null}

      {canUpdateControl ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm space-y-4">
          <p className="font-medium text-slate-700">Datos del control</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              Régimen tributario
              <input
                value={control.tax_regime ?? ''}
                onChange={(e) => setControl((c) => (c ? { ...c, tax_regime: e.target.value } : c))}
                onBlur={() => void saveControlField({ tax_regime: control.tax_regime ?? '' })}
                className="mt-1 block w-full border border-slate-200 rounded-lg px-3 py-1.5"
              />
            </label>
            <label className="block">
              Vencimiento
              <input
                type="date"
                value={control.due_date?.slice(0, 10) ?? ''}
                onChange={(e) => void saveControlField({ due_date: e.target.value || null })}
                className="mt-1 block w-full border border-slate-200 rounded-lg px-3 py-1.5"
              />
            </label>
            <label className="block">
              Nivel de riesgo
              <select
                value={control.risk_level}
                onChange={(e) => void saveControlField({ risk_level: e.target.value })}
                className="mt-1 block w-full border border-slate-200 rounded-lg px-3 py-1.5"
              >
                <option value="bajo">Bajo</option>
                <option value="medio">Medio</option>
                <option value="alto">Alto</option>
                <option value="critico">Crítico</option>
              </select>
            </label>
            <label className="block">
              Estado general
              <select
                value={control.general_status}
                onChange={(e) => void saveControlField({ general_status: e.target.value })}
                className="mt-1 block w-full border border-slate-200 rounded-lg px-3 py-1.5"
              >
                <option value="pendiente">Pendiente</option>
                <option value="al_dia">Al día</option>
                <option value="observado">Observado</option>
                <option value="vencido">Vencido</option>
                <option value="cerrado">Cerrado</option>
              </select>
            </label>
            <label className="block">
              Responsable
              {canPickUsers ? (
                <div className="mt-1">
                  <SearchableSelect
                    value={control.responsible_user_id ? String(control.responsible_user_id) : ''}
                    onChange={(v) => void saveControlField({ responsible_user_id: v ? Number(v) : null })}
                    options={[{ value: '', label: 'Sin asignar' }, ...userOptions]}
                    placeholder="Seleccionar responsable"
                  />
                </div>
              ) : (
                <p className="mt-1 text-slate-600">
                  {control.responsible?.full_name || control.responsible?.username || 'Sin asignar'}
                </p>
              )}
            </label>
            <label className="block">
              Supervisor
              {canPickUsers ? (
                <div className="mt-1">
                  <SearchableSelect
                    value={control.supervisor_user_id ? String(control.supervisor_user_id) : ''}
                    onChange={(v) => void saveControlField({ supervisor_user_id: v ? Number(v) : null })}
                    options={[{ value: '', label: 'Sin asignar' }, ...userOptions]}
                    placeholder="Seleccionar supervisor"
                  />
                </div>
              ) : (
                <p className="mt-1 text-slate-600">
                  {control.supervisor?.full_name || control.supervisor?.username || 'Sin asignar'}
                </p>
              )}
            </label>
          </div>
          <label className="block">
            Observaciones internas
            <textarea
              value={control.observations ?? ''}
              onChange={(e) => setControl((c) => (c ? { ...c, observations: e.target.value } : c))}
              onBlur={() => void saveControlField({ observations: control.observations ?? '' })}
              rows={2}
              className="mt-1 block w-full border border-slate-200 rounded-lg px-3 py-1.5"
            />
          </label>
        </div>
      ) : null}

      <div className="flex gap-2 border-b border-slate-200">
        {(['decl', 'liq', 'nps', 'audit'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500'
            }`}
          >
            {t === 'decl'
              ? 'Declaraciones'
              : t === 'liq'
                ? 'Liquidación'
                : t === 'nps'
                  ? 'NPS'
                  : 'Historial'}
          </button>
        ))}
      </div>

      {tab === 'decl' ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Avance %</th>
                <th className="text-left px-4 py-3">Prioridad</th>
                <th className="text-left px-4 py-3">Vence</th>
                <th className="text-left px-4 py-3">Responsable</th>
                <th className="text-left px-4 py-3">Aprobador</th>
                <th className="text-left px-4 py-3">Adjuntos</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {declarations.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3">{declarationTypeLabel(d.declaration_type)}</td>
                  <td className="px-4 py-3">
                    {canDeclUpdate ? (
                      <select
                        value={d.status}
                        onChange={(e) => void patchDeclaration(d.id, { status: e.target.value })}
                        className="border border-slate-200 rounded px-2 py-1 text-xs"
                      >
                        <option value="pendiente">Pendiente</option>
                        <option value="en_elaboracion">En elaboración</option>
                        <option value="en_revision">En revisión</option>
                        <option value="observado">Observado</option>
                        <option value="aprobado">Aprobado</option>
                        <option value="presentado">Presentado</option>
                        <option value="cerrado">Cerrado</option>
                      </select>
                    ) : (
                      declarationStatusLabel(d.status)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canDeclUpdate ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={d.progress_pct ?? 0}
                        onBlur={(e) =>
                          void patchDeclaration(d.id, { progress_pct: Number(e.target.value) })
                        }
                        className="w-16 border border-slate-200 rounded px-2 py-1 text-xs text-right"
                      />
                    ) : (
                      `${d.progress_pct ?? 0}%`
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canDeclUpdate ? (
                      <select
                        value={d.priority || 'media'}
                        onChange={(e) => void patchDeclaration(d.id, { priority: e.target.value })}
                        className="border border-slate-200 rounded px-2 py-1 text-xs"
                      >
                        <option value="baja">Baja</option>
                        <option value="media">Media</option>
                        <option value="alta">Alta</option>
                        <option value="critica">Crítica</option>
                      </select>
                    ) : (
                      priorityLabel(d.priority || 'media')
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canDeclUpdate ? (
                      <input
                        type="date"
                        value={d.due_date ? d.due_date.slice(0, 10) : ''}
                        onChange={(e) =>
                          void patchDeclaration(d.id, { due_date: e.target.value || null })
                        }
                        className="border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    ) : (
                      <span className="text-xs text-slate-600">
                        {d.due_date ? new Date(d.due_date).toLocaleDateString() : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 min-w-[140px]">
                    {canDeclUpdate && canPickUsers ? (
                      <SearchableSelect
                        value={d.responsible_user_id ? String(d.responsible_user_id) : ''}
                        onChange={(v) =>
                          void patchDeclaration(d.id, {
                            responsible_user_id: v ? Number(v) : null,
                          })
                        }
                        options={[{ value: '', label: 'Sin asignar' }, ...userOptions]}
                        placeholder="Responsable"
                      />
                    ) : (
                      supervisorUserLabel(d.responsible)
                    )}
                  </td>
                  <td className="px-4 py-3 min-w-[140px]">
                    {canDeclUpdate && canPickUsers ? (
                      <SearchableSelect
                        value={d.approver_user_id ? String(d.approver_user_id) : ''}
                        onChange={(v) =>
                          void patchDeclaration(d.id, {
                            approver_user_id: v ? Number(v) : null,
                          })
                        }
                        options={[{ value: '', label: 'Sin asignar' }, ...userOptions]}
                        placeholder="Aprobador"
                      />
                    ) : (
                      supervisorUserLabel(d.approver)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ul className="space-y-1 text-xs">
                      {(declAttachments[d.id] ?? []).map((a) => (
                        <li key={a.id}>
                          <a
                            href={resolveBackendUrl(a.file_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary-700 hover:underline"
                          >
                            {a.file_name}
                          </a>
                        </li>
                      ))}
                    </ul>
                    {canAttach ? (
                      <label className="inline-block mt-1 text-xs text-primary-700 cursor-pointer">
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadFile(f, d.id);
                            e.target.value = '';
                          }}
                        />
                        Subir
                      </label>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {canDeclApprove && !isOperatorOnly ? (
                      <button
                        type="button"
                        className="text-emerald-700 text-xs font-medium"
                        onClick={() => void supervisorsService.approveDeclaration(d.id).then(() => load())}
                      >
                        Aprobar
                      </button>
                    ) : null}
                    {canDeclObserve && !isOperatorOnly ? (
                      <button
                        type="button"
                        className="text-amber-700 text-xs font-medium"
                        onClick={() => {
                          const notes = window.prompt('Observación:') ?? '';
                          if (notes.trim()) {
                            void supervisorsService.observeDeclaration(d.id, notes.trim()).then(() => load());
                          }
                        }}
                      >
                        Observar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'liq' && canLiqView ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          {liquidation ? (
            <>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <label>
                  IGV
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canLiqUpdate}
                    value={liqForm.igv}
                    onChange={(e) => setLiqForm((f) => ({ ...f, igv: Number(e.target.value) }))}
                    className="block w-full border border-slate-200 rounded-lg px-2 py-1 mt-1"
                  />
                </label>
                <label>
                  Renta mensual
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canLiqUpdate}
                    value={liqForm.renta_mensual}
                    onChange={(e) => setLiqForm((f) => ({ ...f, renta_mensual: Number(e.target.value) }))}
                    className="block w-full border border-slate-200 rounded-lg px-2 py-1 mt-1"
                  />
                </label>
                <label>
                  Otros tributos
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canLiqUpdate}
                    value={liqForm.otros_tributos}
                    onChange={(e) => setLiqForm((f) => ({ ...f, otros_tributos: Number(e.target.value) }))}
                    className="block w-full border border-slate-200 rounded-lg px-2 py-1 mt-1"
                  />
                </label>
              </div>
              <p className="text-sm font-semibold text-slate-800">
                Total a pagar: S/ {liquidation.total_pagar.toFixed(2)}
                <span className="text-xs font-normal text-slate-500 ml-2">(calculado automáticamente)</span>
              </p>
              {liquidation.calculated_at ? (
                <p className="text-xs text-slate-500">
                  Último cálculo: {new Date(liquidation.calculated_at).toLocaleString()}
                </p>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <label>
                  Responsable liquidación
                  {canLiqUpdate && canPickUsers ? (
                    <div className="mt-1">
                      <SearchableSelect
                        value={liqForm.responsible_user_id}
                        onChange={(v) => setLiqForm((f) => ({ ...f, responsible_user_id: v }))}
                        options={[{ value: '', label: 'Sin asignar' }, ...userOptions]}
                        placeholder="Responsable"
                        disabled={!canLiqUpdate}
                      />
                    </div>
                  ) : (
                    <p className="mt-1 text-slate-600">
                      {liquidation.responsible?.full_name ||
                        liquidation.responsible?.username ||
                        'Sin asignar'}
                    </p>
                  )}
                </label>
                <label>
                  Supervisor aprobador
                  {canLiqUpdate && canPickUsers ? (
                    <div className="mt-1">
                      <SearchableSelect
                        value={liqForm.approver_user_id}
                        onChange={(v) => setLiqForm((f) => ({ ...f, approver_user_id: v }))}
                        options={[{ value: '', label: 'Sin asignar' }, ...userOptions]}
                        placeholder="Aprobador"
                        disabled={!canLiqUpdate}
                      />
                    </div>
                  ) : (
                    <p className="mt-1 text-slate-600">
                      {liquidation.approver?.full_name || liquidation.approver?.username || 'Sin asignar'}
                    </p>
                  )}
                </label>
                <label>
                  Estado de validación
                  {canLiqUpdate ? (
                    <select
                      value={liqForm.validation_status}
                      onChange={(e) => setLiqForm((f) => ({ ...f, validation_status: e.target.value }))}
                      className="block w-full mt-1 border border-slate-200 rounded-lg px-2 py-1"
                    >
                      <option value="pendiente">Pendiente</option>
                      <option value="aprobada">Aprobada</option>
                      <option value="observada">Observada</option>
                    </select>
                  ) : (
                    <p className="mt-1 text-slate-600">{liquidationValidationLabel(liquidation.validation_status)}</p>
                  )}
                </label>
                <label className="md:col-span-2">
                  Notas
                  <textarea
                    value={liqForm.notes}
                    disabled={!canLiqUpdate}
                    onChange={(e) => setLiqForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="block w-full mt-1 border border-slate-200 rounded-lg px-2 py-1"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {canLiqUpdate ? (
                  <button
                    type="button"
                    onClick={() => void saveLiquidation()}
                    className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm"
                  >
                    Guardar liquidación
                  </button>
                ) : null}
                {canLiqApprove && !isOperatorOnly ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void supervisorsService.approveLiquidation(controlId).then(() => load());
                      }}
                      className="px-4 py-2 rounded-full border border-emerald-600 text-emerald-700 text-sm"
                    >
                      Aprobar liquidación
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const notes = window.prompt('Observación de liquidación:') ?? '';
                        if (notes.trim()) {
                          void supervisorsService.observeLiquidation(controlId, notes.trim()).then(() => load());
                        }
                      }}
                      className="px-4 py-2 rounded-full border border-amber-600 text-amber-700 text-sm"
                    >
                      Observar liquidación
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Sin liquidación (se crea al generar el control del período).</p>
          )}
        </div>
      ) : null}

      {tab === 'nps' && canNpsView ? (
        <div className="space-y-4">
          {canNpsCreate ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap gap-3 items-end">
              <label className="text-sm">
                Tributo
                <input
                  value={newNps.tributo}
                  onChange={(e) => setNewNps((n) => ({ ...n, tributo: e.target.value }))}
                  className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm">
                Importe
                <input
                  type="number"
                  step="0.01"
                  value={newNps.importe}
                  onChange={(e) => setNewNps((n) => ({ ...n, importe: Number(e.target.value) }))}
                  className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm">
                Vencimiento pago
                <input
                  type="date"
                  value={newNps.payment_due_date}
                  onChange={(e) => setNewNps((n) => ({ ...n, payment_due_date: e.target.value }))}
                  className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => void addNps()}
                className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm"
              >
                Agregar NPS
              </button>
            </div>
          ) : null}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3">Tributo</th>
                  <th className="text-left px-4 py-3">Importe</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-left px-4 py-3">Código</th>
                  <th className="text-left px-4 py-3">Vence</th>
                  <th className="text-right px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {npsList.map((n) => (
                  <Fragment key={n.id}>
                    <tr>
                      <td className="px-4 py-3">{n.tributo}</td>
                      <td className="px-4 py-3">S/ {n.importe.toFixed(2)}</td>
                      <td className="px-4 py-3">{npsStatusLabel(n.payment_status)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{n.codigo_nps || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {n.payment_due_date ? n.payment_due_date.slice(0, 10) : '—'}
                        {n.generated_at ? (
                          <span className="block text-slate-400">
                            Gen: {new Date(n.generated_at).toLocaleDateString()}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        {canNpsUpdate ? (
                          <button
                            type="button"
                            className="text-slate-600 text-xs font-medium"
                            onClick={() => startEditNps(n)}
                          >
                            Editar
                          </button>
                        ) : null}
                        {canNpsGenerate && n.payment_status === 'pendiente_generar' ? (
                          <button
                            type="button"
                            className="text-primary-700 text-xs font-medium"
                            onClick={() => {
                              void supervisorsService.generateNPS(n.id).then(() => load());
                            }}
                          >
                            Generar
                          </button>
                        ) : null}
                        {canNpsPay &&
                        ['pendiente_pago', 'vencido', 'generado', 'enviado_cliente'].includes(n.payment_status) ? (
                          <button
                            type="button"
                            className="text-emerald-700 text-xs font-medium"
                            onClick={() => {
                              void supervisorsService.registerNPSPayment(n.id).then(() => load());
                            }}
                          >
                            Marcar pagado
                          </button>
                        ) : null}
                        {canNpsDelete ? (
                          <button
                            type="button"
                            className="text-red-600 text-xs font-medium"
                            onClick={() => {
                              void supervisorsService.deleteNPS(n.id).then(() => load());
                            }}
                          >
                            Eliminar
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {editingNpsId === n.id && canNpsUpdate ? (
                      <tr key={`${n.id}-edit`}>
                        <td colSpan={6} className="px-4 py-3 bg-slate-50">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                            <label>
                              Tributo
                              <input
                                value={npsEdit.tributo}
                                onChange={(e) => setNpsEdit((f) => ({ ...f, tributo: e.target.value }))}
                                className="block w-full mt-1 border border-slate-200 rounded-lg px-2 py-1"
                              />
                            </label>
                            <label>
                              Importe
                              <input
                                type="number"
                                step="0.01"
                                value={npsEdit.importe}
                                onChange={(e) => setNpsEdit((f) => ({ ...f, importe: Number(e.target.value) }))}
                                className="block w-full mt-1 border border-slate-200 rounded-lg px-2 py-1"
                              />
                            </label>
                            <label>
                              Código NPS
                              <input
                                value={npsEdit.codigo_nps}
                                onChange={(e) => setNpsEdit((f) => ({ ...f, codigo_nps: e.target.value }))}
                                className="block w-full mt-1 border border-slate-200 rounded-lg px-2 py-1 font-mono text-xs"
                              />
                            </label>
                            <label>
                              Vencimiento pago
                              <input
                                type="date"
                                value={npsEdit.payment_due_date}
                                onChange={(e) => setNpsEdit((f) => ({ ...f, payment_due_date: e.target.value }))}
                                className="block w-full mt-1 border border-slate-200 rounded-lg px-2 py-1"
                              />
                            </label>
                            <label>
                              Estado
                              <select
                                value={npsEdit.payment_status}
                                onChange={(e) => setNpsEdit((f) => ({ ...f, payment_status: e.target.value }))}
                                className="block w-full mt-1 border border-slate-200 rounded-lg px-2 py-1"
                              >
                                <option value="pendiente_generar">Pendiente generar</option>
                                <option value="generado">Generado</option>
                                <option value="enviado_cliente">Enviado al cliente</option>
                                <option value="pendiente_pago">Pendiente de pago</option>
                                <option value="pagado">Pagado</option>
                                <option value="vencido">Vencido</option>
                              </select>
                            </label>
                            <label className="md:col-span-3">
                              Notas
                              <input
                                value={npsEdit.notes}
                                onChange={(e) => setNpsEdit((f) => ({ ...f, notes: e.target.value }))}
                                className="block w-full mt-1 border border-slate-200 rounded-lg px-2 py-1"
                              />
                            </label>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              type="button"
                              onClick={() => void saveNpsEdit()}
                              className="px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingNpsId(null)}
                              className="text-xs text-slate-600"
                            >
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="space-y-6">
          {canObsView ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Observaciones</h3>
              <ul className="space-y-2 text-sm">
                {observations.length === 0 ? (
                  <li className="text-slate-500">Sin observaciones registradas.</li>
                ) : (
                  observations.map((o) => (
                    <li key={o.id} className="border-b border-slate-100 pb-2">
                      <p>{o.body}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {o.user?.name || o.user?.username || 'Usuario'} ·{' '}
                        {new Date(o.created_at).toLocaleString()}
                      </p>
                    </li>
                  ))
                )}
              </ul>
              {canObsCreate ? (
                <div className="flex gap-2">
                  <input
                    value={newObservation}
                    onChange={(e) => setNewObservation(e.target.value)}
                    placeholder="Nueva observación…"
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void addObservation()}
                    className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm"
                  >
                    Agregar
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {canHistory ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Historial de cambios</h3>
              <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
                {history.length === 0 ? (
                  <li className="text-slate-500">Sin cambios registrados.</li>
                ) : (
                  history.map((h) => (
                    <li key={h.id} className="text-slate-700">
                      <span className="font-medium">{h.field_name}</span>: {h.old_value || '—'} → {h.new_value || '—'}
                      <span className="block text-xs text-slate-400">
                        {h.user?.name || h.user?.username || `#${h.user_id}`} ·{' '}
                        {new Date(h.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </section>
          ) : null}

          {(canObsView || canAttach) && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Adjuntos</h3>
              <ul className="space-y-1 text-sm">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <a
                      href={resolveBackendUrl(a.file_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-700 hover:underline"
                    >
                      {a.file_name}
                    </a>
                    <span className="text-xs text-slate-400 ml-2">
                      {new Date(a.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
              {canAttach ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFile(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 rounded-full border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Subir archivo
                  </button>
                </>
              ) : null}
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default SupervisorControlDetail;

