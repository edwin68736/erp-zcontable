import { currentPeriodYM } from '../../utils/supervisorLabels';

type ActivityPeriodFilterProps = {
  value: string;
  onChange: (periodYm: string) => void;
};

const ActivityPeriodFilter = ({ value, onChange }: ActivityPeriodFilterProps) => (
  <div className="min-w-[10rem]">
    <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="activity-period-ym">
      Período
    </label>
    <input
      id="activity-period-ym"
      type="month"
      value={value}
      onChange={(e) => onChange(e.target.value || currentPeriodYM())}
      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
    />
  </div>
);

export default ActivityPeriodFilter;
