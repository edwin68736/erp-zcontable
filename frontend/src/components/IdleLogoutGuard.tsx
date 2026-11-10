import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../services/auth';
import client from '../api/client';
import { HEARTBEAT_MS, IDLE_LIMIT_MS, LOGIN_NOTICE_KEY, idleState, isUserActive, markActivity, msSinceActivity, secondsToIdleLogout, startActivityTracking } from '../utils/activity';

/**
 * Cierra la sesión tras 30 minutos sin que la persona toque nada, con un aviso 2 minutos antes («Seguir conectado»).
 * El servidor aplica el mismo límite por su cuenta; esto solo hace que la pantalla reaccione sin esperar a la
 * siguiente petición. Se monta una vez dentro del Layout (ya con sesión iniciada).
 */
const IdleLogoutGuard = () => {
  const navigate = useNavigate();
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    startActivityTracking();
    const tick = () => {
      const elapsed = msSinceActivity();
      const st = idleState(elapsed);
      if (st === 'expired') {
        try {
          window.sessionStorage.setItem(LOGIN_NOTICE_KEY, 'Su sesión se cerró por inactividad. Inicie sesión de nuevo.');
        } catch {
          /* sin almacenamiento: no se muestra el aviso */
        }
        void auth.logout().finally(() => navigate('/login', { replace: true }));
        return;
      }
      setSeconds(st === 'warning' ? secondsToIdleLogout(elapsed) : null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    // Mientras la persona usa el sistema se avisa al servidor cada pocos minutos: una pantalla que no hace peticiones
    // (formularios largos, tablas, lectura) no debe hacer que el servidor cierre la sesión por «inactividad».
    const beat = window.setInterval(() => {
      if (isUserActive()) void client.get('/me/sessions').catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => {
      window.clearInterval(id);
      window.clearInterval(beat);
    };
  }, [navigate]);

  if (seconds === null) return null;

  const stay = () => {
    markActivity();
    setSeconds(null);
    // Avisa al servidor de que la persona sigue ahí (la petición lleva X-Client-Active por haber actividad reciente).
    void client.get('/me/sessions').catch(() => undefined);
  };

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <i className="fas fa-hourglass-half mb-3 text-3xl text-amber-500" aria-hidden />
        <h2 id="idle-title" className="text-base font-bold text-slate-800">
          ¿Sigue ahí?
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Por seguridad, su sesión se cerrará por inactividad en{' '}
          <strong>
            {mm}:{ss}
          </strong>
          .
        </p>
        <button type="button" onClick={stay} className="mt-4 w-full rounded-lg bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-800">
          Seguir conectado
        </button>
        <p className="mt-2 text-2xs text-slate-400">Cierra a los {Math.round(IDLE_LIMIT_MS / 60000)} min sin uso.</p>
      </div>
    </div>
  );
};

export default IdleLogoutGuard;
