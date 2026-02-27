import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Calendar, CalendarDays, BarChart3, UserCog } from 'lucide-react';
import AttendanceTab from '../../components/personnel/AttendanceTab';
import ShiftTemplatesTab from '../../components/personnel/ShiftTemplatesTab';
import ScheduleTab from '../../components/personnel/ScheduleTab';
import PerformanceTab from '../../components/personnel/PerformanceTab';
import { usePersonnelSocket } from '../../features/personnel/usePersonnelSocket';

type TabType = 'attendance' | 'shiftTemplates' | 'schedule' | 'performance';

const PersonnelManagementPage = () => {
  const { t } = useTranslation('personnel');
  const [activeTab, setActiveTab] = useState<TabType>('attendance');

  // Real-time updates
  usePersonnelSocket();

  const tabs = [
    { id: 'attendance' as const, label: t('tabs.attendance'), icon: Clock },
    { id: 'shiftTemplates' as const, label: t('tabs.shiftTemplates'), icon: Calendar },
    { id: 'schedule' as const, label: t('tabs.schedule'), icon: CalendarDays },
    { id: 'performance' as const, label: t('tabs.performance'), icon: BarChart3 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-100 rounded-lg">
          <UserCog className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500">{t('description')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'attendance' && <AttendanceTab />}
      {activeTab === 'shiftTemplates' && <ShiftTemplatesTab />}
      {activeTab === 'schedule' && <ScheduleTab />}
      {activeTab === 'performance' && <PerformanceTab />}
    </div>
  );
};

export default PersonnelManagementPage;
