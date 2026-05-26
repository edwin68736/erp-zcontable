import type { FinanceCalendarActivity } from '../../../services/financeCalendar';
import { trafficStyles, type WeekSegment } from './calendarUtils';
import type { DragMode } from './useCalendarDrag';

const EVENT_ROW_H = 22;

type Props = {
  segment: WeekSegment;
  canInteract: boolean;
  isDragging: boolean;
  previewPatch?: { start_day: number; end_day: number } | null;
  onPointerDownMove: (e: React.PointerEvent, activity: FinanceCalendarActivity) => void;
  onPointerDownResize: (e: React.PointerEvent, activity: FinanceCalendarActivity, mode: DragMode) => void;
  onClick: (activity: FinanceCalendarActivity, e: React.MouseEvent) => void;
};

const ActivityEventBar = ({
  segment,
  canInteract,
  isDragging,
  previewPatch,
  onPointerDownMove,
  onPointerDownResize,
  onClick,
}: Props) => {
  const a = segment.activity;
  const tl = a.traffic_light || 'azul';
  const styles = trafficStyles(tl);

  const radius =
    segment.isStart && segment.isEnd
      ? 'rounded-md'
      : segment.isStart
        ? 'rounded-l-md'
        : segment.isEnd
          ? 'rounded-r-md'
          : 'rounded-none';

  const showLabel = segment.isStart || segment.colSpan <= 2;

  let previewLabel: string | null = null;
  if (isDragging && previewPatch && segment.isStart) {
    previewLabel = `Día ${previewPatch.start_day} – ${previewPatch.end_day}`;
  }

  return (
    <div
      role="presentation"
      title={a.name}
      onClick={(e) => onClick(a, e)}
      onPointerDown={(e) => canInteract && onPointerDownMove(e, a)}
      className={`group relative mx-0.5 text-[10px] sm:text-xs font-medium truncate border px-1.5 shadow-sm transition-all z-10 select-none touch-none ${styles.bar} ${radius} ${
        isDragging ? 'opacity-60 shadow-lg scale-[1.02] ring-2 ring-primary-300/50' : 'hover:shadow-md'
      } ${canInteract ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
      style={{
        gridColumn: `${segment.colStart + 1} / span ${segment.colSpan}`,
        gridRow: segment.lane + 1,
        alignSelf: 'start',
        height: EVENT_ROW_H - 2,
      }}
    >
      {canInteract && segment.isStart ? (
        <span
          role="presentation"
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDownResize(e, a, 'resize-start');
          }}
          className="absolute left-0 top-0 bottom-0 w-2.5 cursor-w-resize rounded-l-md hover:bg-primary-400/40 z-20"
          title="Ajustar inicio"
        />
      ) : null}
      {canInteract && segment.isEnd ? (
        <span
          role="presentation"
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDownResize(e, a, 'resize-end');
          }}
          className="absolute right-0 top-0 bottom-0 w-2.5 cursor-e-resize rounded-r-md hover:bg-primary-400/40 z-20"
          title="Ajustar fin"
        />
      ) : null}

      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-0.5 align-middle ${styles.dot}`} />
      {previewLabel ? (
        <span className="text-[9px] opacity-90">{previewLabel}</span>
      ) : showLabel ? (
        a.name
      ) : null}
    </div>
  );
};

export default ActivityEventBar;
