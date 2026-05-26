import { formatPeriodLabel } from './calendarUtils';

type Metrics = {
  total: number;
  completed: number;
  upcoming: number;
  overdue: number;
  pendingCompanies: number | null;
  loading?: boolean;
};

type Props = {
  periodYm: string;
  metrics: Metrics;
};

const MetricCard = ({
  icon,
  label,
  value,
  sub,
  accent,
  loading,
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
  loading?: boolean;
}) => (
  <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${loading ? 'animate-pulse' : ''}`}>
    <div className="flex items-start gap-3">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${accent}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold text-slate-900 mt-0.5">{loading ? '—' : value}</p>
        {sub ? <p className="text-xs text-slate-500 mt-0.5">{sub}</p> : null}
      </div>
    </div>
  </div>
);

const CalendarMetrics = ({ periodYm, metrics }: Props) => (
  <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
    <MetricCard
      icon="📅"
      label="Mes actual"
      value={metrics.total}
      sub={`${formatPeriodLabel(periodYm)} · programadas`}
      accent="bg-primary-50 text-primary-700"
      loading={metrics.loading}
    />
    <MetricCard
      icon="🟢"
      label="Al día / cumplidas"
      value={metrics.completed}
      sub="actividades"
      accent="bg-emerald-50 text-emerald-700"
      loading={metrics.loading}
    />
    <MetricCard
      icon="🟡"
      label="Próximas a vencer"
      value={metrics.upcoming}
      sub="≤ 3 días al límite"
      accent="bg-amber-50 text-amber-700"
      loading={metrics.loading}
    />
    <MetricCard
      icon="🔴"
      label="Vencidas"
      value={metrics.overdue}
      sub="actividades"
      accent="bg-red-50 text-red-700"
      loading={metrics.loading}
    />
    <MetricCard
      icon="👥"
      label="Empresas pendientes"
      value={metrics.pendingCompanies ?? '—'}
      sub="en su alcance"
      accent="bg-sky-50 text-sky-700"
      loading={metrics.loading}
    />
  </section>
);

export default CalendarMetrics;
