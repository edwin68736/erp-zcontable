import type { FinanceCalendarActivity } from '../../../services/financeCalendar';
import ActivityModalWithTemplate, { type ActivityTemplateFormData } from './ActivityModalWithTemplate';
import type { ActivityDaysInput } from './activityTemplateSelectorUtils';

export type { ActivityTemplateFormData };

type Props = {
  open: boolean;
  title: string;
  mode?: 'create' | 'edit';
  initialDays: ActivityDaysInput;
  editActivity?: FinanceCalendarActivity;
  lastDayOfMonth: number;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (data: ActivityTemplateFormData) => void | Promise<void>;
};

const ActivityModal = ({
  open,
  title,
  lastDayOfMonth,
  saving,
  onClose,
  onSubmit,
  mode = 'create',
  initialDays,
  editActivity,
}: Props) => (
  <ActivityModalWithTemplate
    open={open}
    title={title}
    mode={editActivity ? 'edit' : mode}
    initialDays={initialDays}
    editActivity={editActivity}
    lastDayOfMonth={lastDayOfMonth}
    saving={saving}
    onClose={onClose}
    onSubmit={onSubmit}
  />
);

export default ActivityModal;
