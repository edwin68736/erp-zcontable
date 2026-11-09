import { useEffect, useRef, useState } from 'react';
import { clearFinished, countByStatus, dismissTask, viewTask, type LongTask } from '../utils/longTasks';
import { useLongTasks } from '../utils/useLongTasks';

const elapsedText = (t: LongTask, now: number): string => {
  const s = Math.max(0, Math.floor(((t.finishedAt ?? now) - t.startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Indicador de la cabecera para las consultas largas a SUNAT: «N en curso» / «N lista(s)» / «N con error», con una
 * lista desplegable para volver a cada una. No aparece si no hay ninguna.
 */
const TaskIndicator = () => {
  const tasks = useLongTasks();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const { running, done, error } = countByStatus(tasks);

  useEffect(() => {
    if (!open && running === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, running]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (tasks.length === 0) setOpen(false);
  }, [tasks.length]);

  if (tasks.length === 0) return null;

  const label =
    running > 0
      ? `${running} ${running === 1 ? 'consulta en curso' : 'consultas en curso'}`
      : error > 0
        ? `${error} con error`
        : done > 0
          ? `${done} ${done === 1 ? 'lista' : 'listas'}`
          : 'Consultas';
  const tone =
    error > 0 && running === 0
      ? 'border-red-200 bg-red-50 text-red-700'
      : done > 0 && running === 0
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : running > 0
          ? 'border-primary-200 bg-primary-50 text-primary-700'
          : 'border-slate-200 bg-white text-slate-600';
  const icon = running > 0 ? 'fa-spinner fa-spin' : error > 0 ? 'fa-circle-exclamation' : done > 0 ? 'fa-circle-check' : 'fa-clock-rotate-left';
  const hasFinished = tasks.some((t) => t.status !== 'running');

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${tone}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Consultas a SUNAT: ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`fas ${icon}`} aria-hidden />
        <span className="max-w-[10rem] truncate">{label}</span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 pb-1 pt-1">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Consultas a SUNAT</p>
            {hasFinished ? (
              <button type="button" onClick={clearFinished} className="text-xs font-semibold text-primary-700 underline">
                Limpiar terminadas
              </button>
            ) : null}
          </div>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                <i
                  className={`fas mt-0.5 text-sm ${t.status === 'running' ? 'fa-spinner fa-spin text-primary-600' : t.status === 'error' ? 'fa-circle-exclamation text-red-600' : 'fa-circle-check text-emerald-600'}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {t.toolLabel} · {t.companyName}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {t.status === 'running' ? `En curso · lleva ${elapsedText(t, now)}` : t.status === 'error' ? t.errorMessage : `Lista · tardó ${elapsedText(t, now)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="font-semibold text-primary-700 underline"
                    onClick={() => {
                      setOpen(false);
                      viewTask(t.id);
                    }}
                  >
                    Ver
                  </button>
                  {t.status !== 'running' ? (
                    <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="Quitar de la lista" onClick={() => dismissTask(t.id)}>
                      <i className="fas fa-xmark" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default TaskIndicator;
