import type { ActivityTemplate } from '../../../services/activityTemplates';

export function formatTemplateOptionLabel(template: Pick<ActivityTemplate, 'code' | 'name'>): string {
  return `${template.code} - ${template.name}`;
}

/** Solo plantillas activas; búsqueda por código o nombre. */
export function filterActiveTemplates(templates: ActivityTemplate[], search: string): ActivityTemplate[] {
  const active = templates.filter((t) => t.active);
  const q = search.trim().toLowerCase();
  if (!q) return active;
  return active.filter(
    (t) => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
  );
}

export type ActivityDaysInput = {
  start_day: number;
  end_day: number;
  due_day: number;
};

export type ActivityDaysValidation =
  | { ok: true; days: ActivityDaysInput }
  | { ok: false; error: string };

export function validateActivityDays(
  startDay: number,
  endDay: number,
  dueDay: number,
  lastDayOfMonth: number,
): ActivityDaysValidation {
  if (!Number.isFinite(lastDayOfMonth) || lastDayOfMonth < 1) {
    return { ok: false, error: 'Mes inválido.' };
  }
  const clamp = (v: number) => Math.min(Math.max(Math.trunc(v), 1), lastDayOfMonth);
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || !Number.isFinite(dueDay)) {
    return { ok: false, error: 'Los días deben ser números válidos.' };
  }
  const start = clamp(startDay);
  const end = clamp(Math.max(start, endDay));
  const due = clamp(dueDay);
  if (start < 1 || end < 1 || due < 1) {
    return { ok: false, error: 'Los días deben estar entre 1 y el último día del mes.' };
  }
  return { ok: true, days: { start_day: start, end_day: end, due_day: due } };
}

export function canSubmitTemplateActivity(
  templateId: number | null | undefined,
  startDay: number,
  endDay: number,
  dueDay: number,
  lastDayOfMonth: number,
): templateId is number {
  if (templateId == null || templateId <= 0) return false;
  return validateActivityDays(startDay, endDay, dueDay, lastDayOfMonth).ok;
}
