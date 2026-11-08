import { useState, type FormEvent } from 'react';
import Button from '../components/ui/Button';
import PageHeading from '../components/ui/PageHeading';
import { auth } from '../services/auth';
import { apiErrorMessage, securityService } from '../services/security';
import { checkPassword, passwordOk } from '../utils/passwordPolicy';

const INPUT = 'w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30';

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
const Profile = () => {
  const user = auth.getUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const check = checkPassword(next, user?.username);
  const mismatch = again !== '' && again !== next;
  const canSubmit = current !== '' && passwordOk(check) && next === again && next !== current && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      await securityService.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo cambiar la contraseña. Intente de nuevo.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pt-2">
      <div>
        <PageHeading>Mi cuenta</PageHeading>
        <p className="mt-1 text-sm text-slate-500">Sus datos de acceso y su contraseña.</p>
      </div>

      <div className="max-w-xl space-y-1 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase text-slate-400">Usuario</p>
        <p className="text-sm font-bold text-slate-800">{user?.name || '—'}</p>
        <p className="text-sm text-slate-600">
          {user?.username ? `@${user.username}` : ''}
          {user?.email ? ` · ${user.email}` : ''}
        </p>
      </div>

      <form onSubmit={submit} autoComplete="off" className="max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
          <Rule ok={check.length}>Al menos 10 caracteres</Rule>
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

        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
        {done ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
            Contraseña actualizada. Úsela la próxima vez que inicie sesión.
          </p>
        ) : null}

        <Button type="submit" disabled={!canSubmit}>
          <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-key'} mr-1.5`} aria-hidden />
          Cambiar contraseña
        </Button>
      </form>
    </div>
  );
};

export default Profile;
