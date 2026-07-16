import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import ScheduleTab from '../../components/personnel/ScheduleTab';
import { usePersonnelSocket } from '../../features/personnel/usePersonnelSocket';

/**
 * Program (weekly schedule) — moved out of the Ekip/Personnel page into
 * Settings. Branch-scoped via the active-branch selector.
 */
const ScheduleSettingsPage = () => {
  const { t } = useTranslation('personnel');
  usePersonnelSocket();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center">
          <CalendarDays className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-heading font-bold text-slate-900">
            {t('tabs.schedule', 'Program')}
          </h1>
        </div>
      </div>
      <ScheduleTab />
    </div>
  );
};

export default ScheduleSettingsPage;
