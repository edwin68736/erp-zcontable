import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import PageHeading from '../components/ui/PageHeading';
import { auth } from '../services/auth';
import { apiErrorMessage, securityService, type MySession } from '../services/security';
import { describeUserAgent } from './settings/securityUi';
import { timeAgo } from './tools/buzon/buzonUi';
import { checkPassword, passwordOk } from '../utils/passwordPolicy';
import DevicesCard from './security/DevicesCard';
import TotpCard from './security/TotpCard';
import Alert from '../components/ui/Alert';
import { notify } from '../utils/notify';

const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30';

function Rule({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={ok ? 'text-emerald-700' : 'text-slate-500'}>
      <i className={`fas ${ok ? 'fa-check' : 'fa-circle'} mr-1.5 text-[10px]`} aria-hidden />
      {children}
    </li>
  );
}

/**
 * Mi cuenta: datos del usuario y cambio de contraseña. Cada persona cambia su propia contraseña (hay que escribir la
 * actual). Los campos no piden al navegador que recuerde la contraseña.
 */
/** Mis sesiones: dónde está abierta mi cuenta ahora y botón para cerrar las demás. */
function SessionsCard() {
  const [rows, setRows] = useState<MySession[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await securityService.mySessions());
      setError('');
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudieron leer las sesiones.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeOthers = async () => {
    setBusy(true);
    try {
      const closed = await securityService.revokeOtherSessions();
      void notify.success('Sesiones cerradas', closed > 0 ? `Se cerró su cuenta en ${closed} equipo(s).` : undefined);
      await load();
    } catch (e) {
      notify.fromMessage('error', apiErrorMessage(e, 'No se pudieron cerrar las demás sesiones.'));
    } finally {
      setBusy(false);
    }
  };

  const closeOne = async (id: string) => {
    try {
      await securityService.revokeSession(id);
      void notify.success('Sesión cerrada');
      await load();
    } catch (e) {
      notify.fromMessage('error', apiErrorMessage(e, 'No se pudo cerrar la sesión.'));
    }
  };

  const others = rows.filter((r) => !r.current).length;
  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">Mis sesiones</h2>
        <Button variant="secondary" className="!py-1.5 text-xs" disabled={busy || others === 0} onClick={() => void closeOthers()}>
          <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-right-from-bracket'} mr-1.5`} aria-hidden />
          Cerrar las demás
        </Button>
      </div>
      <p className="text-xs text-slate-500">Equipos donde su cuenta está abierta ahora. Si no reconoce alguno, ciérrelo y cambie su contraseña.</p>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-800">
                {describeUserAgent(r.user_agent)}
                {r.current ? <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Este equipo</span> : null}
              </p>
              <p className="text-xs text-slate-500">
                IP {r.ip || '—'} · activa {timeAgo(r.last_active_at)}
              </p>
            </div>
            {!r.current ? (
              <button type="button" onClick={() => void closeOne(r.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                Cerrar
              </button>
            ) : null}
          </li>
        ))}
        {rows.length === 0 && !error ? <li className="py-3 text-center text-xs text-slate-400">Cargando…</li> : null}
      </ul>
    </div>
  );
}

const Profile = () => {
  const navigate = useNavigate();
  const forced = auth.mustChangePassword();
  const user = auth.getUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = checkPassword(next, user?.username);
  const mismatch = again !== '' && again !== next;
  const canSubmit = current !== '' && passwordOk(check) && next === again && next !== current && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await securityService.changePassword(current, next);
      void notify.success('Contraseña actualizada', forced ? undefined : 'Úsela la próxima vez que inicie sesión.');
      if (forced) {
        // Ya la cambió: se puede usar el sistema.
        auth.clearMustChangePassword();
        navigate('/', { replace: true });
        return;
      }
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      notify.fromMessage('error', apiErrorMessage(err, 'No se pudo cambiar la contraseña. Intente de nuevo.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pt-2">
      <div>
        <PageHeading hint="Sus datos de acceso y su contraseña.">Mi cuenta</PageHeading>
      </div>

      {forced ? (
        <Alert variant="warning" className="max-w-xl">
          <strong>Debe cambiar su contraseña para continuar.</strong> La que usa ahora la puso otra persona. Escriba la actual y elija una nueva que solo usted conozca.
        </Alert>
      ) : null}

      <div className="max-w-xl space-y-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase text-slate-400">Usuario</p>
        <p className="text-sm font-bold text-slate-800">{user?.name || '—'}</p>
        <p className="text-sm text-slate-600">
          {user?.username ? `@${user.username}` : ''}
          {user?.email ? ` · ${user.email}` : ''}
        </p>
      </div>

      <form onSubmit={submit} autoComplete="off" className="max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">Cambiar contraseña</h2>
        <p className="text-xs text-slate-500">
          Escríbala usted mismo cada vez: no la guarde en el navegador, sobre todo si el equipo lo usan otras personas.
        </p>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Contraseña actual</span>
          <input
            type="password"
            name="current-secret"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Contraseña nueva</span>
          <input
            type="password"
            name="new-secret"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={INPUT}
          />
        </label>
        <ul className="space-y-0.5 text-xs" aria-label="Requisitos de la contraseña">
          <Rule ok={check.length}>Al menos 6 caracteres (se recomienda 10 o más, y que no sea su DNI)</Rule>
          <Rule ok={check.noUsername}>No contiene su nombre de usuario</Rule>
          <Rule ok={next !== '' && check.notObvious}>No es una contraseña común ni una secuencia (1234567890, aaaaaaaaaa…)</Rule>
          <Rule ok={next !== '' && next !== current}>Distinta de la actual</Rule>
        </ul>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Repita la contraseña nueva</span>
          <input
            type="password"
            name="repeat-secret"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            className={INPUT}
          />
          {mismatch ? <span className="mt-1 block text-xs text-red-700">No coincide con la contraseña nueva.</span> : null}
        </label>

        {error ? <Alert variant="error">{error}</Alert> : null}

        <Button type="submit" disabled={!canSubmit}>
          <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-key'} mr-1.5`} aria-hidden />
          Cambiar contraseña
        </Button>
      </form>

      {!forced ? <TotpCard username={user?.username} /> : null}
      {!forced ? <DevicesCard /> : null}
      {!forced ? <SessionsCard /> : null}
    </div>
  );
};

export default Profile;
