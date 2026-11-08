import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, securityService, type MyDevice, type TotpStatus } from '../../services/security';
import { usersService } from '../../services/users';
import type { User } from '../../types/dashboard';
import { timeAgo } from '../tools/buzon/buzonUi';
import { VIA_LABEL } from './deviceUi';

const INPUT = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';

/** Equipos de confianza y verificación en dos pasos de cada usuario: quitar un equipo o dejar a la persona «de cero». */
export default function UserDevicesTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState(0);
  const [devices, setDevices] = useState<MyDevice[] | null>(null);
  const [totp, setTotp] = useState<TotpStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    usersService
      .list()
      .then(setUsers)
      .catch((e) => setError(apiErrorMessage(e, 'No se pudo leer la lista de usuarios.')));
  }, []);

  const load = useCallback(async (id: number) => {
    if (!id) {
      setDevices(null);
      setTotp(null);
      return;
    }
    setError('');
    try {
      const r = await securityService.userDevices(id);
      setDevices(r.devices);
      setTotp(r.totp);
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudieron leer los equipos del usuario.'));
    }
  }, []);

  useEffect(() => {
    void load(userId);
  }, [userId, load]);

  const selected = users.find((u) => u.id === userId);

  const revoke = async (d: MyDevice) => {
    if (!window.confirm(`¿Quitar «${d.label}»? Se cerrará la sesión abierta desde ese equipo.`)) return;
    try {
      await securityService.revokeDevice(d.id);
      await load(userId);
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo quitar el equipo.'));
    }
  };

  const reset = async () => {
    if (!selected) return;
    if (!window.confirm(`¿Dejar a ${selected.name || selected.username} sin verificación en dos pasos, sin equipos de confianza y sin sesiones abiertas?\n\nTendrá que volver a configurar su app y verificar cada equipo. Úselo si perdió el celular y los códigos de recuperación.`)) return;
    setBusy(true);
    try {
      await securityService.resetUser(selected.id);
      await load(userId);
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo reiniciar al usuario.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs text-slate-600">
        <span className="mb-0.5 block">Usuario</span>
        <select value={userId} onChange={(e) => setUserId(Number(e.target.value))} className={`${INPUT} w-72 max-w-full`}>
          <option value={0}>Elija un usuario…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.username} (@{u.username})
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}

      {selected && devices ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
              Verificación en dos pasos:{' '}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${totp?.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {totp?.enabled ? `Activada (${totp.recovery_codes_left} códigos de recuperación)` : 'No activada'}
              </span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void reset()}
              className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <i className="fas fa-rotate-left mr-1.5" aria-hidden />
              Reiniciar seguridad del usuario
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{d.label || 'Navegador'}</p>
                  <p className="text-xs text-slate-500">
                    IP {d.last_ip || '—'} · usado {timeAgo(d.last_seen_at)} · {VIA_LABEL[d.via] ?? d.via}
                    {d.trusted_until ? ` · confianza hasta ${new Date(d.trusted_until).toLocaleDateString('es-PE')}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => void revoke(d)} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                  Quitar
                </button>
              </li>
            ))}
            {devices.length === 0 ? <li className="py-3 text-center text-xs text-slate-400">Este usuario no tiene equipos registrados.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
