const PRIORITY_BADGE: Record<string, string> = {
  baja: 'bg-slate-100 text-slate-700 ring-slate-200',
  media: 'bg-blue-50 text-blue-800 ring-blue-200',
  alta: 'bg-amber-50 text-amber-900 ring-amber-200',
  critica: 'bg-red-50 text-red-800 ring-red-200',
};

export function priorityBadgeClass(priority: string): string {
  return PRIORITY_BADGE[priority] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
}
