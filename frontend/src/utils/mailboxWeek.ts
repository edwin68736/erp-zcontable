/** Utilidades de semana para capturas de buzón SUNAT/SUNAFIL. */

export type WeekOption = {
  week_start: string;
  label: string;
};

export function mondayOfWeekContaining(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const wd = d.getDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  d.setDate(d.getDate() + diff);
  return d;
}

export function formatWeekStart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function currentWeekStart(): string {
  return formatWeekStart(mondayOfWeekContaining(new Date()));
}

/** Semanas cuyo lunes cae en el mes del period_ym (YYYY-MM). */
export function weeksInPeriodYM(periodYm: string): WeekOption[] {
  const parts = periodYm.split('-');
  if (parts.length !== 2) return [{ week_start: currentWeekStart(), label: periodYm }];
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    return [{ week_start: currentWeekStart(), label: periodYm }];
  }
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const seen = new Set<string>();
  const out: WeekOption[] = [];
  let cur = mondayOfWeekContaining(first);

  while (cur <= new Date(last.getFullYear(), last.getMonth(), last.getDate() + 7)) {
    const end = new Date(cur);
    end.setDate(end.getDate() + 6);
    if (end >= first) {
      const ws = formatWeekStart(cur);
      if (!seen.has(ws)) {
        seen.add(ws);
        const label = `${String(cur.getDate()).padStart(2, '0')}/${String(cur.getMonth() + 1).padStart(2, '0')} – ${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}/${end.getFullYear()}`;
        out.push({ week_start: ws, label });
      }
    }
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
    if (cur.getFullYear() > y || (cur.getFullYear() === y && cur.getMonth() > m + 1)) break;
  }

  if (out.length === 0) {
    out.push({ week_start: formatWeekStart(mondayOfWeekContaining(first)), label: first.toLocaleDateString('es-PE') });
  }
  return out;
}

export function defaultWeekStartForPeriod(periodYm: string): string {
  const weeks = weeksInPeriodYM(periodYm);
  const now = currentWeekStart();
  const match = weeks.find((w) => w.week_start === now);
  if (match) return match.week_start;
  return weeks[0]?.week_start ?? now;
}
