import { useCallback, useMemo, useState } from 'react';
import type { FinanceCalendarActivity, FinanceCalendarMark } from '../../../services/financeCalendar';
import ActivityEventBar from './ActivityEventBar';
import {
  WEEKDAYS,
  applyActivityDatePatch,
  buildMonthGrid,
  chunkWeeks,
  localDateKey,
  markStyles,
  marksByDayKey,
  activitiesForDay,
  weekSegments,
  trafficStyles,
  type ActivityDatePatch,
  type CalendarCell,
} from './calendarUtils';
import { useCalendarDrag, type DragPreview } from './useCalendarDrag';

const MAX_VISIBLE_MARKS = 2;
const MAX_VISIBLE_ACTIVITIES = 2;
const EVENT_ROW_H = 22;

type Props = {
  periodYm: string;
  lastDayOfMonth: number;
  marks: FinanceCalendarMark[];
  activities: FinanceCalendarActivity[];
  canInteract: boolean;
  selectedDay: number | null;
  isToday: (cell: CalendarCell) => boolean;
  onDayClick: (dayNum: number, date: Date) => void;
  onActivityClick: (activity: FinanceCalendarActivity, e: React.MouseEvent) => void;
  onOverflowClick: (dayNum: number) => void;
  onActivityDatesChange: (
    activityId: number,
    patch: ActivityDatePatch,
    origin: ActivityDatePatch,
  ) => void;
};

const CalendarGrid = ({
  periodYm,
  lastDayOfMonth,
  marks,
  activities,
  canInteract,
  selectedDay,
  isToday,
  onDayClick,
  onActivityClick,
  onOverflowClick,
  onActivityDatesChange,
}: Props) => {
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  const handleCommit = useCallback(
    (activityId: number, patch: ActivityDatePatch, origin: ActivityDatePatch) => {
      onActivityDatesChange(activityId, patch, origin);
    },
    [onActivityDatesChange],
  );

  const { startDrag, draggingId, wasDragged } = useCalendarDrag({
    enabled: canInteract,
    lastDayOfMonth,
    onPreview: setDragPreview,
    onCommit: handleCommit,
  });

  const displayActivities = useMemo(() => {
    if (!dragPreview) return activities;
    return activities.map((a) =>
      a.id === dragPreview.activityId ? applyActivityDatePatch(a, dragPreview.patch, periodYm) : a,
    );
  }, [activities, dragPreview, periodYm]);

  const highlightDays = useMemo(() => new Set(dragPreview?.highlightDays ?? []), [dragPreview]);

  const cells = useMemo(() => buildMonthGrid(periodYm), [periodYm]);
  const weeks = useMemo(() => chunkWeeks(cells), [cells]);
  const markMap = useMemo(() => marksByDayKey(marks), [marks]);

  const handleBarClick = (a: FinanceCalendarActivity, e: React.MouseEvent) => {
    if (wasDragged()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onActivityClick(a, e);
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${canInteract ? '' : 'calendar-readonly'}`}
    >
      <div className="grid grid-cols-7 bg-primary-600 border-b border-primary-700">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="text-center text-[10px] sm:text-xs font-semibold py-2 sm:py-2.5 text-white uppercase tracking-wide"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="divide-y divide-slate-100">
        {weeks.map((week, wi) => {
          const segments = weekSegments(week, displayActivities);
          const maxLane = segments.reduce((m, s) => Math.max(m, s.lane), -1);
          const eventRows = maxLane + 1;
          const eventPad = eventRows > 0 ? eventRows * EVENT_ROW_H + 6 : 0;

          return (
            <div key={wi} data-week-grid>
              {eventRows > 0 ? (
                <div
                  className="relative grid grid-cols-7 gap-px px-0.5 pt-1"
                  style={{
                    minHeight: eventPad,
                    gridTemplateRows: `repeat(${eventRows}, ${EVENT_ROW_H}px)`,
                  }}
                >
                  {week.map((cell, colIdx) => (
                    <div
                      key={`col-${colIdx}`}
                      data-week-col={colIdx}
                      data-cal-day={cell.inMonth ? cell.dayNum : undefined}
                      className="absolute top-0 bottom-0 pointer-events-none"
                      style={{ left: `${(colIdx / 7) * 100}%`, width: `${100 / 7}%` }}
                      aria-hidden
                    />
                  ))}
                  {segments.map((seg) => (
                    <ActivityEventBar
                      key={`${seg.activity.id}-${seg.colStart}-${wi}`}
                      segment={seg}
                      canInteract={canInteract}
                      isDragging={draggingId === seg.activity.id}
                      previewPatch={
                        dragPreview?.activityId === seg.activity.id ? dragPreview.patch : null
                      }
                      onPointerDownMove={(e, act) => startDrag(e, act, 'move')}
                      onPointerDownResize={(e, act, mode) => startDrag(e, act, mode)}
                      onClick={handleBarClick}
                    />
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-7">
                {week.map((cell) => {
                  const key = localDateKey(cell.date);
                  const dayMarks = cell.inMonth ? markMap.get(key) ?? [] : [];
                  const dayActs = cell.inMonth ? activitiesForDay(displayActivities, cell.dayNum) : [];
                  const selected = cell.inMonth && selectedDay === cell.dayNum;
                  const today = cell.inMonth && isToday(cell);
                  const dropHighlight = cell.inMonth && highlightDays.has(cell.dayNum);
                  const hiddenActs = Math.max(0, dayActs.length - MAX_VISIBLE_ACTIVITIES);

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!cell.inMonth}
                      data-cal-day={cell.inMonth ? cell.dayNum : undefined}
                      onClick={() => cell.inMonth && onDayClick(cell.dayNum, cell.date)}
                      className={`min-h-[88px] sm:min-h-[100px] border-r border-slate-100 p-1.5 text-left transition-colors duration-150 last:border-r-0 ${
                        cell.inMonth
                          ? `hover:bg-primary-50/40 ${selected ? 'bg-primary-50/80 ring-1 ring-inset ring-primary-200' : 'bg-white'} ${
                              dropHighlight ? 'bg-primary-100/70 ring-1 ring-inset ring-primary-300' : ''
                            } ${canInteract ? 'cursor-pointer' : 'cursor-default'}`
                          : 'bg-slate-50/60 cursor-default'
                      }`}
                    >
                      <span
                        className={`inline-flex text-xs sm:text-sm font-semibold w-7 h-7 items-center justify-center rounded-full mb-1 transition-colors ${
                          today ? 'bg-primary-600 text-white' : cell.inMonth ? 'text-slate-700' : 'text-slate-300'
                        } ${dropHighlight && !today ? 'bg-primary-200 text-primary-900' : ''}`}
                      >
                        {cell.dayNum}
                      </span>

                      {dayMarks.slice(0, MAX_VISIBLE_MARKS).map((m) => (
                        <div
                          key={m.id}
                          className={`text-[10px] rounded-md border px-1 py-0.5 mb-0.5 truncate ${markStyles(m.kind)}`}
                          title={m.label}
                        >
                          {m.kind === 'feriado' ? '🏛 ' : m.kind === 'festividad' ? '🎉 ' : '📌 '}
                          {m.label}
                        </div>
                      ))}

                      {dayActs.slice(0, MAX_VISIBLE_ACTIVITIES).map((a) => {
                        const st = trafficStyles(a.traffic_light || 'azul');
                        return (
                          <div
                            key={a.id}
                            className={`hidden sm:block text-[10px] rounded-md border px-1 py-0.5 mb-0.5 truncate ${st.bar}`}
                            title={a.name}
                          >
                            {a.name}
                          </div>
                        );
                      })}

                      {hiddenActs > 0 ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOverflowClick(cell.dayNum);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              onOverflowClick(cell.dayNum);
                            }
                          }}
                          className="text-[10px] text-primary-700 font-medium hover:underline"
                        >
                          +{hiddenActs} más
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CalendarGrid;
