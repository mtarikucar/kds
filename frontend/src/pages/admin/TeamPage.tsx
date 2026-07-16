import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UsersRound, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { usePersonnelSocket } from '../../features/personnel/usePersonnelSocket';
import UserManagementPage from './UserManagementPage';
import AttendanceTab from '../../components/personnel/AttendanceTab';

/**
 * Ekip (Team) — the merged Users + Personnel section. "Kullanıcılar" holds the
 * account table (with performance now folded in as a per-user badge/detail +
 * aggregate strip); "Puantaj" is the attendance/clock-in surface. Shift
 * templates + schedule moved to Settings; performance merged into the users
 * table — so those personnel tabs are gone from here.
 */
type Tab = 'users' | 'attendance';

const TeamPage = () => {
  const { t } = useTranslation(['common', 'personnel']);
  const { hasFeature } = useSubscription();
  const hasPersonnel = hasFeature('personnelManagement');
  const [tab, setTab] = useState<Tab>('users');

  // Realtime invalidation (attendance clock-ins) — was owned by the old
  // PersonnelManagementPage shell.
  usePersonnelSocket();

  const tabs = [
    { id: 'users' as const, label: t('navigation.users'), icon: UsersRound },
    ...(hasPersonnel
      ? [
          {
            id: 'attendance' as const,
            label: t('personnel:tabs.attendance', 'Puantaj'),
            icon: Clock,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Ekip header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
          <UsersRound className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-slate-900">
            {t('navigation.team', 'Ekip')}
          </h1>
          <p className="text-slate-500 mt-0.5">{t('admin.manageStaff')}</p>
        </div>
      </div>

      {/* Tabs */}
      {tabs.length > 1 && (
        <div className="border-b border-slate-200 overflow-x-auto">
          <nav className="flex gap-4 min-w-max">
            {tabs.map((tb) => {
              const Icon = tb.icon;
              return (
                <button
                  key={tb.id}
                  onClick={() => setTab(tb.id)}
                  className={cn(
                    'flex items-center gap-2 px-1 py-3 border-b-2 text-sm font-medium transition-colors',
                    tab === tb.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tb.label}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {tab === 'users' ? <UserManagementPage embedded /> : <AttendanceTab />}
    </div>
  );
};

export default TeamPage;
