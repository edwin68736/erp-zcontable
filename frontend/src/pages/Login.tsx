import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, isLoginChallenge, type LoginChallenge, type LoginResponse } from '../services/auth';
import { apiErrorMessage } from '../services/security';

const INPUT =
  'w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 outline-none transition shadow-inner';
const PRIMARY =
  'w-full py-3.5 px-4 bg-primary-700 hover:bg-primary-800 text-white font-semibold rounded-full transition shadow-lg shadow-primary-800/20 focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 text-sm disabled:opacity-70';

/** Cada cuántos segundos se pregunta si el administrador ya respondió. */
const POLL_MS = 3000;

type Waiting = 'idle' | 'waiting';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Equipo nuevo: falta verificar antes de entrar.
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [code, setCode] = useState('');
  const [approval, setApproval] = useState<Waiting>('idle');
  const navigate = useNavigate();
  // Si la sesión se cerró sola (inactividad, otro equipo, administrador), se explica aquí una vez.
  const [notice] = useState(() => {
    try {
      const n = window.sessionStorage.getItem('login_notice') ?? '';
      window.sessionStorage.removeItem('login_notice');
      return n;
    } catch {
      return '';
    }
  });

  const enter = useCallback(
    (res: LoginResponse) => {
      navigate(res.must_change_password ? '/profile' : '/');
    },
    [navigate],
  );

  const backToLogin = useCallback(() => {
    setChallenge(null);
    setApproval('idle');
    setCode('');
    setPassword('');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await auth.login(username.trim(), password, remember);
      if (isLoginChallenge(res)) {
        setChallenge(res);
        setCode('');
        setApproval('idle');
        return;
      }
      enter(res);
    } catch (err: unknown) {
      console.error(err);
      setError(apiErrorMessage(err, 'Error al iniciar sesión'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || !code.trim()) return;
    setLoading(true);
    setError('');
    try {
      enter(await auth.verifyCode(username.trim(), challenge.challenge_id, code.trim()));
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'No se pudo verificar el código'));
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!challenge) return;
    setLoading(true);
    setError('');
    try {
      await auth.requestApproval(challenge.challenge_id);
      setApproval('waiting');
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'No se pudo pedir la aprobación'));
    } finally {
      setLoading(false);
    }
  };

  // Mientras espera, pregunta cada pocos segundos si el administrador ya respondió.
  const challengeId = challenge?.challenge_id;
  useEffect(() => {
    if (!challengeId || approval !== 'waiting') return;
    let stopped = false;
    const tick = async () => {
      try {
        const status = await auth.challengeStatus(challengeId);
        if (stopped) return;
        if (status === 'aprobada') {
          stopped = true;
          enter(await auth.completeApproved(username.trim(), challengeId));
        } else if (status === 'rechazada') {
          stopped = true;
          backToLogin();
          setError('Un administrador rechazó este equipo. Si fue un error, vuelva a intentarlo o hable con él.');
        } else if (status !== 'pendiente') {
          stopped = true;
          backToLogin();
          setError('La solicitud venció. Inicie sesión de nuevo.');
        }
      } catch (err: unknown) {
        if (stopped) return;
        stopped = true;
        backToLogin();
        setError(apiErrorMessage(err, 'No se pudo terminar el inicio de sesión. Intente de nuevo.'));
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [approval, challengeId, username, enter, backToLogin]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans text-slate-800 bg-[url('/login.png')] bg-cover bg-center bg-no-repeat">
      <div className="w-full max-w-lg">
        <div className="shadow-sm p-1">
          <div className="bg-white rounded-[1.75rem] shadow-xl px-8 py-10 border border-slate-100">
            <div className="text-center mb-8">
              <img
                src="/logo_login.png"
                alt="ZContable"
                className="mx-auto mb-5 h-8 w-auto max-w-full object-contain"
              />
              <p className="text-slate-500 text-sm">{challenge ? 'Confirme que es usted' : 'Inicia sesión para continuar'}</p>
            </div>

            {notice && !error && !challenge && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900" role="status">
                {notice}
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm text-left" role="alert">
                {error}
              </div>
            )}

            {challenge ? (
              <div className="space-y-5 text-left" data-testid="verification-step">
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                  Está entrando desde un <strong>equipo nuevo</strong> ({challenge.device_label || 'navegador'}). Por seguridad, hay que confirmar que es usted.
                </div>

                {approval === 'waiting' ? (
                  <div className="space-y-3 text-center" role="status">
                    <i className="fas fa-spinner fa-spin text-2xl text-primary-600" aria-hidden />
                    <p className="text-sm text-slate-700">
                      Esperando que un administrador apruebe este equipo… Avísele que está esperando. Puede dejar esta ventana abierta.
                    </p>
                  </div>
                ) : (
                  <>
                    {challenge.methods.totp ? (
                      <form onSubmit={handleVerify} className="space-y-3" autoComplete="off">
                        <label htmlFor="code" className="block text-sm font-medium text-slate-700">
                          Código de su app de autenticación
                        </label>
                        <input
                          id="code"
                          name="verification-code"
                          inputMode="text"
                          autoFocus
                          autoComplete="one-time-code"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          className={`${INPUT} text-center font-mono text-lg tracking-widest`}
                          placeholder="123456"
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                        <p className="text-xs text-slate-500">Los 6 dígitos que muestra la app en su celular. Si lo perdió, escriba uno de sus códigos de recuperación.</p>
                        <button type="submit" disabled={loading || !code.trim()} className={PRIMARY}>
                          {loading ? 'Verificando...' : 'Verificar y entrar'}
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm text-slate-600">
                        Su cuenta todavía no tiene la verificación en dos pasos. Pida a un administrador que apruebe este equipo.
                      </p>
                    )}

                    {challenge.methods.approval ? (
                      <button
                        type="button"
                        onClick={() => void handleRequestApproval()}
                        disabled={loading}
                        className="w-full rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
                      >
                        <i className="fas fa-user-shield mr-2" aria-hidden />
                        Pedir aprobación a un administrador
                      </button>
                    ) : null}
                  </>
                )}

                <button type="button" onClick={backToLogin} className="w-full text-center text-sm text-slate-500 hover:text-slate-700">
                  Volver
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-1">
                    Usuario
                  </label>
                  <input
                    type="text"
                    id="username"
                    name="username"
                    required
                    autoComplete="username"
                    className={INPUT}
                    placeholder="Su nombre de usuario"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    required
                    // El navegador puede recordar el usuario, pero la contraseña la escribe la persona cada vez
                    // (el equipo lo usan varias personas con el mismo perfil de Chrome). "new-password" evita que se
                    // autorrellene una guardada; los data-* son para los gestores de contraseñas de terceros.
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    data-form-type="other"
                    className={INPUT}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    Confiar en este equipo. Desmárquelo si es una computadora compartida o prestada.
                  </span>
                </label>
                <button type="submit" disabled={loading} className={PRIMARY}>
                  {loading ? 'Iniciando sesión...' : 'Entrar al panel'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
