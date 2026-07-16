import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import ShiftTemplatesTab from '../../components/personnel/ShiftTemplatesTab';
import { usePersonnelSocket } from '../../features/personnel/usePersonnelSocket';

/**
 * Vardiya Şablonları — moved out of the Ekip/Personnel page into Settings.
 * Branch-scoped via the active-branch selector (the personnel hooks inject
 * the active branch automatically).
 */
const ShiftTemplatesSettingsPage = () => {
  const { t } = useTranslation('personnel');
  usePersonnelSocket();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center">
          <Clock className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-heading font-bold text-slate-900">
            {t('tabs.shiftTemplates', 'Vardiya Şablonları')}
          </h1>
        </div>
      </div>
      <ShiftTemplatesTab />
    </div>
  );
};

export default ShiftTemplatesSettingsPage;
