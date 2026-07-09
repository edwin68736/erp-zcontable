import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceCalendarActivity } from '../../../services/financeCalendar';
import {
  activitySpanDays,
  computeDragDates,
  daysInRange,
  patchFromActivity,
  type ActivityDatePatch,
} from './calendarUtils';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export type DragPreview = {
  activityId: number;
  patch: ActivityDatePatch;
  highlightDays: number[];
};

type DragSession = {
  activityId: number;
  mode: DragMode;
  origin: ActivityDatePatch;
  anchorDay: number;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type Options = {
  enabled: boolean;
  lastDayOfMonth: number;
  onPreview: (preview: DragPreview | null) => void;
  onCommit: (activityId: number, patch: ActivityDatePatch, origin: ActivityDatePatch) => void;
};

export function resolveCalendarDay(clientX: number, clientY: number): number | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue;

    const direct = el.closest('[data-cal-day]');
    if (direct) {
      const d = Number(direct.getAttribute('data-cal-day'));
      if (Number.isFinite(d) && d > 0) return d;
    }

    const weekGrid = el.closest('[data-week-grid]');
    if (weekGrid instanceof HTMLElement) {
      const rect = weekGrid.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && rect.width > 0) {
        const col = Math.min(6, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * 7)));
        const marker = weekGrid.querySelector(`[data-week-col="${col}"]`);
        const d = Number(marker?.getAttribute('data-cal-day'));
        if (Number.isFinite(d) && d > 0) return d;
      }
    }
  }
  return null;
}

export function useCalendarDrag({ enabled, lastDayOfMonth, onPreview, onCommit }: Options) {
  const sessionRef = useRef<DragSession | null>(null);
  const justDraggedRef = useRef(false);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const endDrag = useCallback(
    (commit: boolean, clientX?: number, clientY?: number) => {
      const s = sessionRef.current;
      if (!s) return;

      sessionRef.current = null;
      setDraggingId(null);
      onPreview(null);
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');

      if (!commit || clientX == null || clientY == null) return;

      const hoverDay = resolveCalendarDay(clientX, clientY);
      if (hoverDay == null) return;

      const patch = computeDragDates(s.mode, s.origin, hoverDay, s.anchorDay, lastDayOfMonth);
      const unchanged =
        patch.start_day === s.origin.start_day &&
        patch.end_day === s.origin.end_day &&
        patch.due_day === s.origin.due_day;

      if (s.moved) {
        justDraggedRef.current = true;
        window.setTimeout(() => {
          justDraggedRef.current = false;
        }, 150);
      }

      if (!unchanged && s.moved) {
        onCommit(s.activityId, patch, s.origin);
      }
    },
    [lastDayOfMonth, onCommit, onPreview],
  );

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;

      if (Math.abs(e.clientX - s.startX) + Math.abs(e.clientY - s.startY) > 4) {
        s.moved = true;
      }

      const hoverDay = resolveCalendarDay(e.clientX, e.clientY);
      if (hoverDay == null) return;

      const patch = computeDragDates(s.mode, s.origin, hoverDay, s.anchorDay, lastDayOfMonth);
      onPreview({
        activityId: s.activityId,
        patch,
        highlightDays: daysInRange(patch.start_day, patch.end_day),
      });
    };

    const onUp = (e: PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      endDrag(true, e.clientX, e.clientY);
    };

    const onCancel = (e: PointerEvent) => {
      const s = sessionRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      endDrag(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [enabled, endDrag, lastDayOfMonth, onPreview]);

  const startDrag = useCallback(
    (e: React.PointerEvent, activity: FinanceCalendarActivity, mode: DragMode) => {
      if (!enabled || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const { start, end } = activitySpanDays(activity);
      const origin = patchFromActivity(activity);
      const anchorDay = mode === 'resize-end' ? end : start;

      sessionRef.current = {
        activityId: activity.id,
        mode,
        origin,
        anchorDay,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      setDraggingId(activity.id);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = mode === 'move' ? 'grabbing' : 'col-resize';

      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      onPreview({
        activityId: activity.id,
        patch: origin,
        highlightDays: daysInRange(start, end),
      });
    },
    [enabled, onPreview],
  );

  const wasDragged = useCallback(() => justDraggedRef.current, []);

  return { startDrag, draggingId, wasDragged };
}
