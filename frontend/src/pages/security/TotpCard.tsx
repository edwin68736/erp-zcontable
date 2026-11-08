import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import Button from '../../components/ui/Button';
import { apiErrorMessage, securityService, type TotpStatus } from '../../services/security';
import { recoveryCodesText } from './deviceUi';
import Alert from '../../components/ui/Alert';

const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30';

/**
 * Verificación en dos pasos con una app de autenticación (Google Authenticator, Microsoft Authenticator, Authy…).
 * Se pide solo al entrar desde un equipo nuevo. Los códigos de recuperación se muestran una sola vez.
 */
export default function TotpCard({ username }: { username?: string }) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Activación en curso: secreto + QR, a la espera del primer código.
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  // Recién activada: se muestran una sola vez.
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await securityService.totpStatus());
      setError('');
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo leer el estado de la verificación.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const s = await securityService.totpSetup();
      const qr = await QRCode.toDataURL(s.uri, { margin: 1, width: 192 });
      setSetup({ secret: s.secret, qr });
      setCode('');
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo iniciar la activación.'));
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    try {
      setRecovery(await securityService.totpEnable(code.trim()));
      setSetup(null);
      setCode('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'El código no es correcto.'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      await securityService.totpDisable(password);
      setDisabling(false);
      setPassword('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo desactivar.'));
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    if (!recovery) return;
    try {
      await navigator.clipboard.writeText(recoveryCodesText(recovery, username));
      setCopied(true);
    } catch {
      setError('No se pudo copiar. Seleccione los códigos y cópielos a mano.');
    }
  };

  const downloadCodes = () => {
    if (!recovery) return;
    const url = URL.createObjectURL(new Blob([recoveryCodesText(recovery, username)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zcontable-codigos-de-recuperacion.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="totp-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">Verificación en dos pasos</h2>
        {status ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {status.enabled ? 'Activada' : 'No activada'}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-slate-500">
        Con una app en su celular (Google Authenticator, Microsoft Authenticator o Authy), cuando entre desde un equipo nuevo le pediremos un código de 6 dígitos. Así nadie entra con solo su contraseña.
      </p>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {recovery ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4" role="status">
          <p className="text-sm font-semibold text-amber-900">Guarde estos códigos de recuperación</p>
          <p className="text-xs text-amber-900">
            Si pierde el celular, cada uno sirve <strong>una sola vez</strong> para entrar. No se vuelven a mostrar: cópielos o descárguelos ahora y guárdelos lejos de esta computadora.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm text-slate-800">
            {recovery.map((c) => (
              <li key={c} className="rounded bg-white px-2 py-1 text-center">{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => void copyCodes()}>
              <i className={`fas ${copied ? 'fa-check' : 'fa-copy'} mr-1.5`} aria-hidden />
              {copied ? 'Copiados' : 'Copiar'}
            </Button>
            <Button variant="secondary" className="!py-1.5 text-xs" onClick={downloadCodes}>
              <i className="fas fa-download mr-1.5" aria-hidden />
              Descargar
            </Button>
            <Button className="!py-1.5 text-xs" onClick={() => { setRecovery(null); setCopied(false); }}>
              Ya los guardé
            </Button>
          </div>
        </div>
      ) : null}

      {!status ? (
        !error ? <p className="py-2 text-center text-xs text-slate-400">Cargando…</p> : null
      ) : setup ? (
        <form onSubmit={enable} className="space-y-3" autoComplete="off">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600">
            <li>Abra la app de autenticación en su celular y agregue una cuenta nueva.</li>
            <li>Escanee este código QR (o escriba la clave a mano).</li>
            <li>Escriba abajo el código de 6 dígitos que le muestra la app.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-4">
            <img src={setup.qr} alt="Código QR para la app de autenticación" width={192} height={192} className="rounded-lg border border-slate-200" />
            <div className="min-w-0 text-xs text-slate-600">
              <p className="mb-1">¿No puede escanear? Escriba esta clave:</p>
              <p className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-800" data-testid="totp-secret">{setup.secret}</p>
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Código de 6 dígitos</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${INPUT} max-w-[12rem] text-center font-mono tracking-widest`}
              placeholder="123456"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !code.trim()}>
              <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-shield-halved'} mr-1.5`} aria-hidden />
              Activar
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setSetup(null); setError(''); }}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : status.enabled ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Códigos de recuperación disponibles: <strong>{status.recovery_codes_left}</strong>
            {status.recovery_codes_left <= 2 ? ' — quedan pocos: desactive y vuelva a activar para recibir códigos nuevos.' : '.'}
          </p>
          {disabling ? (
            <form onSubmit={disable} className="space-y-2" autoComplete="off">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Escriba su contraseña para desactivarla</span>
                <input
                  type="password"
                  name="disable-secret"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={INPUT}
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" disabled={busy || !password}>Desactivar</Button>
                <Button variant="secondary" disabled={busy} onClick={() => { setDisabling(false); setPassword(''); setError(''); }}>Cancelar</Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => setDisabling(true)}>
              Desactivar
            </Button>
          )}
        </div>
      ) : (
        <Button onClick={() => void start()} disabled={busy}>
          <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-mobile-screen'} mr-1.5`} aria-hidden />
          Activar con una app
        </Button>
      )}
    </div>
  );
}
