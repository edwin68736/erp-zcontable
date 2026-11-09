import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SLOW_MS, type LongTask } from '../utils/longTasks';

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Panel de una consulta larga a SUNAT en curso. Va dentro de la página, en el lugar donde luego aparece el resultado
 * (no es un modal: la persona puede seguir usando el sistema). Se pinta solo mientras `task.status === 'running'`.
 * El resultado o el error los muestra la propia pantalla en cuanto la tarea termina.
 */
const LongTaskPanel = ({ task, title = 'Consultando SUNAT', hint }: { task: LongTask | undefined; title?: string; hint?: string }) => {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const running = task?.status === 'running';
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, task?.id]);
  if (!task || !running) return null;

  const elapsed = now - task.startedAt;
  const slow = elapsed >= SLOW_MS;
  const background = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" role="status" aria-live="polite" aria-label={`${title}. ${task.companyName}`}>
      <div className="flex items-start gap-3">
        <i className="fas fa-spinner fa-spin mt-0.5 text-primary-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800">{title}</p>
          <p className="truncate text-xs text-slate-500">
            {task.companyName}
            {task.detail ? ` · ${task.detail}` : ''}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">Lleva {mmss(elapsed)}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="long-task-bar h-full w-1/3 rounded-full bg-primary-500" />
      </div>
      {slow ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          SUNAT está tardando más de lo normal. La consulta sigue en curso; no hace falta repetirla.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{hint ?? 'Puede seguir usando el sistema. Le avisaremos aquí y en la cabecera cuando termine.'}</span>
        <button type="button" onClick={background} className="font-semibold text-primary-700 underline hover:text-primary-800">
          Seguir en segundo plano
        </button>
      </div>
    </section>
  );
};

export default LongTaskPanel;
