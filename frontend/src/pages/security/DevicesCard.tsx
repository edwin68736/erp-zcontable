import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, securityService, type MyDevice } from '../../services/security';
import { timeAgo } from '../tools/buzon/buzonUi';
import { VIA_LABEL } from './deviceUi';
import { formatDate } from '../../utils/format';

/** Mis dispositivos: equipos de los que el sistema ya no pide verificación. Se pueden quitar uno por uno. */
export default function DevicesCard() {
  const [rows, setRows] = useState<MyDevice[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await securityService.myDevices());
      setError('');
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudieron leer los dispositivos.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (d: MyDevice) => {
    if (!window.confirm(`¿Quitar «${d.label || 'este equipo'}»? Se cerrará su sesión y volverá a pedir verificación.`)) return;
    try {
      await securityService.revokeMyDevice(d.id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo quitar el equipo.'));
    }
  };

  return (
    <div className="max-w-xl space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="devices-card">
      <h2 className="text-sm font-bold text-slate-800">Mis dispositivos de confianza</h2>
      <p className="text-xs text-slate-500">Equipos desde los que no se le pide verificación. Si no reconoce alguno, quítelo y cambie su contraseña.</p>
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      <ul className="divide-y divide-slate-100">
        {(rows ?? []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-800">
                {d.label || 'Navegador'}
                {d.current ? <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Este equipo</span> : null}
              </p>
              <p className="text-xs text-slate-500">
                IP {d.last_ip || '—'} · usado {timeAgo(d.last_seen_at)} · {VIA_LABEL[d.via] ?? d.via}
                {d.trusted_until ? ` · confianza hasta ${formatDate(d.trusted_until)}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => void remove(d)} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
              Quitar
            </button>
          </li>
        ))}
        {rows && rows.length === 0 ? <li className="py-3 text-center text-xs text-slate-400">Todavía no hay equipos registrados.</li> : null}
        {!rows && !error ? <li className="py-3 text-center text-xs text-slate-400">Cargando…</li> : null}
      </ul>
    </div>
  );
}
