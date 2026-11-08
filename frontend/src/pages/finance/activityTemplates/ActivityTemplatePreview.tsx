import type { CSSProperties } from 'react';
import { activityChipStyle, activityTypeLabel } from '../calendar/calendarUtils';
import { priorityLabel } from '../../../utils/supervisorLabels';
import { priorityBadgeClass } from './priorityBadge';

type Props = {
  name: string;
  activityType: string;
  priority: string;
  textColor?: string;
  icon?: string;
  compact?: boolean;
};

/** Vista previa visual: chip con color, icono y badge de prioridad. */
export default function ActivityTemplatePreview({
  name,
  activityType,
  priority,
  textColor,
  icon,
  compact = false,
}: Props) {
  const chipStyle: CSSProperties = activityChipStyle(textColor);
  const iconClass = (icon ?? '').trim() || 'fas fa-clipboard-list';

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-bold max-w-[220px] truncate"
          style={chipStyle}
          title={name}
        >
          {icon ? <i className={`${iconClass} text-2xs opacity-80`} aria-hidden /> : null}
          {name}
        </span>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset ${priorityBadgeClass(priority)}`}
        >
          {priorityLabel(priority)}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Vista previa</p>
      <div className="flex flex-wrap items-start gap-3">
        <div
          className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold shadow-sm"
          style={chipStyle}
        >
          <i className={`${iconClass} text-base opacity-90`} aria-hidden />
          <span>{name.trim() || 'Nombre de la actividad'}</span>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${priorityBadgeClass(priority)}`}
        >
          {priorityLabel(priority)}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Tipo: <span className="text-slate-700 font-medium">{activityTypeLabel(activityType)}</span>
      </p>
    </div>
  );
}
