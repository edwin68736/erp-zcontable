import { useEffect, useRef, useState, type FormEvent } from 'react';
import { registerReauthPrompt } from '../api/reauth';
import { apiErrorMessage, securityService } from '../services/security';

/**
 * Pide la contraseña de nuevo antes de acciones sensibles (usuarios, roles, seguridad). Se monta una vez en el Layout:
 * el cliente HTTP lo abre solo cuando el servidor responde «reauth_required» y repite la acción al confirmar.
 */
const ReauthDialog = () => {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      registerReauthPrompt(
        () =>
          new Promise<boolean>((resolve) => {
            resolver.current = resolve;
            setPassword('');
            setError('');
            setOpen(true);
          }),
      ),
    [],
  );

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const finish = (ok: boolean) => {
    setOpen(false);
    setPassword('');
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await securityService.reauth(password);
      finish(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo confirmar la contraseña.'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
      <form onSubmit={submit} autoComplete="off" className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 shadow-xl">
        <div className="text-center">
          <i className="fas fa-lock mb-2 text-3xl text-primary-600" aria-hidden />
          <h2 id="reauth-title" className="text-base font-bold text-slate-800">
            Confirme su contraseña
          </h2>
          <p className="mt-1 text-sm text-slate-600">Esta acción es sensible. Vuelva a escribir su contraseña para continuar.</p>
        </div>
        <input
          ref={input}
          type="password"
          name="reauth-secret"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Su contraseña"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
        />
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button type="button" onClick={() => finish(false)} className="flex-1 rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
          <button type="submit" disabled={busy || !password} className="flex-1 rounded-full bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-60">
            {busy ? 'Confirmando…' : 'Confirmar'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ReauthDialog;
