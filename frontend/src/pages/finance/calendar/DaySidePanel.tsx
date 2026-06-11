import { Link } from 'react-router-dom';
import type { CalendarComplianceSummary, FinanceCalendarActivity } from '../../../services/financeCalendar';
import { priorityLabel } from '../../../utils/supervisorLabels';
import { ACTIVITY_KINDS, activityChipStyle, activitySpanDays, formatDayLabel, trafficStyles } from './calendarUtils';

type Props = {
  open: boolean;
  date: Date | null;
  dayNum: number | null;
  activities: FinanceCalendarActivity[];
  canManage: boolean;
  compliance: CalendarComplianceSummary | null;
  complianceLoading: boolean;
  selectedActivityId: number | null;
  onClose: () => void;
  onSelectActivity: (a: FinanceCalendarActivity) => void;
  onEditActivity: (a: FinanceCalendarActivity) => void;
  onDeleteActivity: (a: FinanceCalendarActivity) => void;
  onAddActivity: () => void;
};

const kindLabel = (k: string) => ACTIVITY_KINDS.find((x) => x.value === k)?.label ?? k;

const statusLabel = (s: string) => {
  if (s === 'completada') return 'Completada';
  if (s === 'en_progreso') return 'En progreso';
  return 'Pendiente';
};

const DaySidePanel = ({
  open,
  date,
  dayNum,
  activities,
  canManage,
  compliance,
  complianceLoading,
  selectedActivityId,
  onClose,
  onSelectActivity,
  onEditActivity,
  onDeleteActivity,
  onAddActivity,
}: Props) => {
  if (!open || !date || dayNum == null) return null;

  return (
    <>
      <button type="button" className="fixed inset-0 bg-slate-900/20 z-[9990] lg:hidden" onClick={onClose} aria-label="Cerrar panel" />
      <aside
        className={`fixed top-0 right-0 z-[9995] h-full w-full max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-primary-600 tracking-wide">Actividades del día</p>
            <h3 className="text-lg font-semibold text-slate-900 mt-0.5">{formatDayLabel(date)}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {activities.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <i className="fas fa-calendar-day text-3xl text-slate-300 mb-3" aria-hidden />
              <p className="text-sm">No hay actividades este día.</p>
              {canManage ? (
                <button type="button" onClick={onAddActivity} className="mt-4 text-sm text-primary-700 font-medium hover:underline">
                  + Crear actividad
                </button>
              ) : null}
            </div>
          ) : (
            activities.map((a) => {
              const { start, end } = activitySpanDays(a);
              const tl = a.traffic_light || 'azul';
              const st = trafficStyles(tl);
              const selected = selectedActivityId === a.id;
              return (
                <div
                  key={a.id}
                  className={`rounded-xl border p-3 transition-shadow cursor-pointer ${
                    selected ? 'border-primary-300 bg-primary-50/50 shadow-sm' : 'border-slate-200 bg-white hover:shadow-sm'
                  }`}
                  onClick={() => onSelectActivity(a)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectActivity(a)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className="font-bold break-words whitespace-normal inline-block rounded-md border px-2 py-0.5 text-xs"
                        style={activityChipStyle(a.text_color)}
                      >
                        {a.name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{kindLabel(a.activity_kind)}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${st.badge}`}>
                      {tl === 'rojo' ? 'Vencida' : tl === 'amarillo' ? 'Próxima' : tl === 'verde' ? 'Al día' : 'Pendiente'}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600">
                    <dt>Rango</dt>
                    <dd>Día {start} – {end}</dd>
                    <dt>Límite</dt>
                    <dd>Día {a.due_day}</dd>
                    <dt>Prioridad</dt>
                    <dd>{priorityLabel(a.priority)}</dd>
                    <dt>Estado</dt>
                    <dd>{statusLabel(a.status || 'pendiente')}</dd>
                  </dl>
                  {canManage ? (
                    <div className="flex gap-2 mt-3 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEditActivity(a); }}
                        className="text-xs text-primary-700 font-medium hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteActivity(a); }}
                        className="text-xs text-red-600 font-medium hover:underline"
                      >
                        Eliminar
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}

          {selectedActivityId && complianceLoading ? (
            <div className="rounded-xl border border-slate-200 p-4 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-2/3 mb-2" />
              <div className="h-3 bg-slate-100 rounded w-full mb-1" />
              <div className="h-3 bg-slate-100 rounded w-4/5" />
            </div>
          ) : null}

          {compliance && selectedActivityId ? (
            <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <h4 className="text-sm font-semibold text-slate-800">Cumplimiento — mis empresas</h4>
              <p className="text-xs text-slate-500 mt-0.5">{compliance.activity_name}</p>
              <div className="flex flex-wrap gap-3 mt-3 text-xs">
                <span className="text-emerald-700 font-medium">{compliance.completed} completadas</span>
                <span className="text-amber-700 font-medium">{compliance.pending} pendientes</span>
                <span className="text-red-700 font-medium">{compliance.overdue} vencidas</span>
              </div>
              <ul className="mt-3 max-h-48 overflow-y-auto space-y-2">
                {compliance.companies.map((c) => {
                  const cst = trafficStyles(c.traffic_light);
                  return (
                    <li key={c.company_id} className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg border border-slate-100 px-2 py-2">
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

        {canManage ? (
          <div className="px-5 py-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onAddActivity}
              className="w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              <i className="fas fa-plus mr-2 text-xs" aria-hidden />
              Nueva actividad
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
};

export default DaySidePanel;
