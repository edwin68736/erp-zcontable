import { useState } from 'react';
import { apiErrorMessage, securityService, type PendingApproval } from '../../services/security';
import { timeAgo } from '../tools/buzon/buzonUi';
import { confirmDialog } from '../../utils/confirmDialog';

/** Equipos nuevos que esperan que un administrador los apruebe (la persona está mirando la pantalla de espera). */
export default function ApprovalsTab({ rows, onChanged }: { rows: PendingApproval[] | null; onChanged: () => void }) {
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const decide = async (r: PendingApproval, approve: boolean) => {
    if (approve && !(await confirmDialog({ message: `¿Aprobar el equipo «${r.device_label}» de ${r.name || r.username}?\n\nSolo apruebe si usted habló con la persona y sabe que es ella quien está entrando.`, confirmLabel: 'Aprobar' }))) return;
    setBusyId(r.id);
    setError('');
    try {
      await securityService.decideApproval(r.id, approve);
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo registrar su decisión.'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Alguien está entrando desde un equipo nuevo y pidió que usted lo apruebe. <strong>Confirme primero con la persona</strong> (llámela o hable con ella): quien robó una contraseña también podría pedir la aprobación. No puede aprobar su propio equipo.
      </p>
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800">
                {r.name || r.username} <span className="font-normal text-slate-500">@{r.username}</span>
              </p>
              <p className="text-xs text-slate-500">
                {r.device_label || 'Navegador'} · IP {r.ip || '—'} · pidió {timeAgo(r.requested_at)}
              </p>
            </div>
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => void decide(r, true)}
              className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Aprobar
            </button>
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => void decide(r, false)}
              className="rounded-full border border-red-300 px-4 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              Rechazar
            </button>
          </li>
        ))}
        {rows && rows.length === 0 ? <li className="px-4 py-10 text-center text-sm text-slate-500">No hay solicitudes pendientes.</li> : null}
        {!rows ? <li className="px-4 py-10 text-center text-sm text-slate-400">Cargando…</li> : null}
      </ul>
    </div>
  );
}
