import { useTranslation } from 'react-i18next';
import ReportSettings from '../../components/settings/ReportSettings';

const ReportsSettingsPage = () => {
  const { t } = useTranslation('settings');

  return (
    <div className="h-full p-4 md:p-6 overflow-auto">
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-slate-900">
          {t('reportSettings.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('reportSettings.description')}
        </p>
      </div>

      <div className="max-w-3xl">
        <ReportSettings />
      </div>
    </div>
  );
};

export default ReportsSettingsPage;
