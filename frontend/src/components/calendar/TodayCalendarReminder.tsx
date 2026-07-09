import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { financeCalendarService, type FinanceCalendarActivity } from '../../services/financeCalendar';
import {
  activitiesForDay,
  activityTextDisplayColor,
  activityTypeLabel,
  currentPeriodYM,
  formatDayLabel,
  isDueDay,
  trafficStyles,
} from '../../pages/finance/calendar/calendarUtils';

type PanelState = 'expanded' | 'minimized';

function statusMeta(status: string): { label: string; className: string } {
  if (status === 'completada') {
    return { label: 'Completada', className: 'bg-emerald-100 text-emerald-800' };
  }
  if (status === 'en_progreso') {
    return { label: 'En progreso', className: 'bg-sky-100 text-sky-800' };
  }
  return { label: 'Pendiente', className: 'bg-slate-100 text-slate-600' };
}

type ActivityRowProps = {
  activity: FinanceCalendarActivity;
  dayNum: number;
};

function ActivityRow({ activity, dayNum }: ActivityRowProps) {
  const textColor = activityTextDisplayColor(activity.text_color);
  const tl = trafficStyles(activity.traffic_light ?? 'azul');
  const status = statusMeta(activity.status);
  const dueToday = isDueDay(activity, dayNum);

  return (
    <li className="group relative flex gap-3 rounded-xl border border-slate-100/80 bg-white/80 px-3 py-2.5 shadow-sm transition hover:border-slate-200 hover:shadow-md">
      <span
        className="mt-0.5 w-1 shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: textColor }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {activity.icon ? (
            <i className={`${activity.icon} mt-0.5 text-sm shrink-0`} style={{ color: textColor }} aria-hidden />
          ) : null}
          <p className="text-sm font-bold leading-snug line-clamp-2" style={{ color: textColor }}>
            {activity.name}
          </p>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {activityTypeLabel(activity.activity_kind)}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
            {status.label}
          </span>
          {dueToday ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              <i className="fas fa-flag-checkered text-[9px]" aria-hidden />
              Vence hoy
            </span>
          ) : null}
          {activity.traffic_light ? (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tl.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${tl.dot}`} aria-hidden />
              {activity.traffic_light === 'rojo'
                ? 'Vencida'
                : activity.traffic_light === 'amarillo'
                  ? 'Por vencer'
                  : activity.traffic_light === 'verde'
                    ? 'Al día'
                    : 'Programada'}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

type MinimizedChipProps = {
  count: number;
  onExpand: () => void;
};

function MinimizedChip({ count, onExpand }: MinimizedChipProps) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="pointer-events-auto group relative flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-gradient-to-br from-primary-600 to-primary-700 text-white shadow-[0_6px_18px_-4px_rgba(37,99,235,0.5)] transition hover:scale-105 hover:shadow-[0_8px_22px_-4px_rgba(37,99,235,0.55)] active:scale-95"
      aria-label={`Abrir agenda de hoy, ${count} actividad${count === 1 ? '' : 'es'}`}
      title={`Hoy: ${count} actividad${count === 1 ? '' : 'es'}`}
    >
      <i className="fas fa-calendar-day text-sm" aria-hidden />
      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-0.5 text-[9px] font-bold leading-none text-primary-700 shadow ring-1 ring-primary-100">
        {count}
      </span>
    </button>
  );
}

const TodayCalendarReminder = () => {
  const [panelState, setPanelState] = useState<PanelState>('expanded');
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<FinanceCalendarActivity[]>([]);
  const [permTick, setPermTick] = useState(0);
  const today = useMemo(() => new Date(), []);
  const dayNum = today.getDate();
  const canView = useMemo(() => auth.hasPermission(P.financeCalendarView), [permTick]);

  const handleMinimize = useCallback(() => {
    setPanelState('minimized');
  }, []);

  const handleExpand = useCallback(() => {
    setPanelState('expanded');
  }, []);

  useEffect(() => {
    const onPerm = () => setPermTick((n) => n + 1);
    window.addEventListener('miweb:permissions-updated', onPerm);
    return () => window.removeEventListener('miweb:permissions-updated', onPerm);
  }, []);

  useEffect(() => {
    if (!auth.getToken() || !canView) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const periodYm = currentPeriodYM();
        const detail = await financeCalendarService.get(periodYm);
        if (cancelled) return;
        const todayActs = activitiesForDay(detail.activities ?? [], dayNum);
        setActivities(todayActs);
      } catch {
        if (!cancelled) setActivities([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [canView, dayNum]);

  if (loading || activities.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[10040] flex max-w-[calc(100vw-2rem)] flex-col items-end sm:bottom-6 sm:right-6"
      role="region"
      aria-live="polite"
      aria-label="Recordatorio de actividades del calendario para hoy"
    >
      {panelState === 'minimized' ? (
        <MinimizedChip count={activities.length} onExpand={handleExpand} />
      ) : (
        <div className="pointer-events-auto w-[min(100vw-2rem,380px)] origin-bottom-right animate-[reminder-enter_0.45s_cubic-bezier(0.16,1,0.3,1)_forwards] overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/95 via-white/92 to-slate-50/95 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          <div className="relative overflow-hidden px-4 py-3.5 sm:px-5">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-500 via-violet-500 to-primary-400"
              aria-hidden
            />
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-500/30">
                <i className="fas fa-calendar-day text-sm" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-600">Tu agenda de hoy</p>
                <h2 className="text-base font-semibold leading-tight text-slate-900">{formatDayLabel(today)}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {activities.length === 1
                    ? '1 actividad programada'
                    : `${activities.length} actividades programadas`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleMinimize}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Minimizar recordatorio"
              >
                <i className="fas fa-minus text-xs" aria-hidden />
              </button>
            </div>
          </div>

          <ul className="max-h-[min(50vh,280px)] space-y-2 overflow-y-auto px-3 pb-3 custom-scrollbar sm:px-4">
            {activities.map((act) => (
              <ActivityRow key={act.id} activity={act} dayNum={dayNum} />
            ))}
          </ul>

          <div className="border-t border-slate-100/80 bg-slate-50/60 px-4 py-2.5 sm:px-5">
            <Link
              to="/finance/calendar"
              className="inline-flex items-center gap-2 text-xs font-semibold text-primary-700 transition hover:text-primary-800"
            >
              Ver calendario completo
              <i className="fas fa-arrow-right text-[10px]" aria-hidden />
            </Link>
          </div>
        </div>
      )}

      <style>{`
        @keyframes reminder-enter {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
};

export default TodayCalendarReminder;
