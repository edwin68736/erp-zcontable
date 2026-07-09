import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { CalendarComplianceSummary, FinanceCalendarActivity } from '../../../services/financeCalendar';
import { priorityLabel } from '../../../utils/supervisorLabels';
import {
  ACTIVITY_COLORS,
  ACTIVITY_KINDS,
  activityChipStyle,
  activityColorHex,
  activitySpanDays,
  trafficStyles,
} from './calendarUtils';

type Props = {
  open: boolean;
  activity: FinanceCalendarActivity | null;
  canEdit: boolean;
  compliance: CalendarComplianceSummary | null;
  complianceLoading: boolean;
  onClose: () => void;
  onEdit: (activity: FinanceCalendarActivity) => void;
  onDelete: (activity: FinanceCalendarActivity) => void;
};

const kindLabel = (k: string) => ACTIVITY_KINDS.find((x) => x.value === k)?.label ?? k;

const statusLabel = (s: string) => {
  if (s === 'completada') return 'Completada';
  if (s === 'en_progreso') return 'En progreso';
  return 'Pendiente';
};

const trafficLabel = (tl: string) => {
  if (tl === 'rojo') return 'Vencida';
  if (tl === 'amarillo') return 'Próxima';
  if (tl === 'verde') return 'Al día';
  return 'Pendiente';
};

const ActivityInfoModal = ({
  open,
  activity,
  canEdit,
  compliance,
  complianceLoading,
  onClose,
  onEdit,
  onDelete,
}: Props) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !activity) return null;

  const { start, end } = activitySpanDays(activity);
  const tl = activity.traffic_light || 'azul';
  const st = trafficStyles(tl);
  const colorHex = activityColorHex(activity.text_color);
  const colorName = ACTIVITY_COLORS.find((c) => c.value === colorHex)?.label ?? 'Personalizado';

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar" />
      <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-primary-600 tracking-wide">Información de actividad</p>
            <h2 className="text-lg font-semibold text-slate-900 mt-0.5 break-words whitespace-normal">{activity.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0" aria-label="Cerrar">
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.badge}`}>{trafficLabel(tl)}</span>
            <span className="text-xs text-slate-500">{kindLabel(activity.activity_kind)}</span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Rango</dt>
            <dd className="text-slate-800 font-medium">Día {start} – {end}</dd>
            <dt className="text-slate-500">Límite</dt>
            <dd className="text-slate-800 font-medium">Día {activity.due_day}</dd>
            <dt className="text-slate-500">Prioridad</dt>
            <dd className="text-slate-800">{priorityLabel(activity.priority)}</dd>
            <dt className="text-slate-500">Estado</dt>
            <dd className="text-slate-800">{statusLabel(activity.status || 'pendiente')}</dd>
            <dt className="text-slate-500">Color del texto</dt>
            <dd className="flex items-center gap-2 text-slate-800">
              <span
                className="inline-block min-w-[4.5rem] rounded-md border px-2 py-0.5 text-xs font-medium"
                style={activityChipStyle(colorHex)}
              >
                Muestra
              </span>
              {colorName}
            </dd>
          </dl>

          {complianceLoading ? (
            <div className="rounded-xl border border-slate-200 p-4 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-2/3 mb-2" />
              <div className="h-3 bg-slate-100 rounded w-full mb-1" />
              <div className="h-3 bg-slate-100 rounded w-4/5" />
            </div>
          ) : null}

          {compliance ? (
            <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <h4 className="text-sm font-semibold text-slate-800">Cumplimiento — mis empresas</h4>
              <div className="flex flex-wrap gap-3 mt-3 text-xs">
                <span className="text-emerald-700 font-medium">{compliance.completed} completadas</span>
                <span className="text-amber-700 font-medium">{compliance.pending} pendientes</span>
                <span className="text-red-700 font-medium">{compliance.overdue} vencidas</span>
              </div>
              <ul className="mt-3 max-h-40 overflow-y-auto space-y-2">
                {compliance.companies.map((c) => {
                  const cst = trafficStyles(c.traffic_light);
                  return (
                    <li
                      key={c.company_id}
                      className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg border border-slate-100 px-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{c.company_name}</p>
                        {c.detail ? <p className="text-slate-500 truncate">{c.detail}</p> : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`w-2 h-2 rounded-full ${cst.dot}`} />
                        {c.control_id ? (
                          <Link to={`/supervisors/controls/${c.control_id}`} className="text-primary-700 font-medium">
                            Ver
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cerrar
          </button>
          {canEdit ? (
            <>
              <button
                type="button"
                onClick={() => onDelete(activity)}
                className="px-4 py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Eliminar
              </button>
              <button
                type="button"
                onClick={() => onEdit(activity)}
                className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
              >
                Editar
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ActivityInfoModal;
