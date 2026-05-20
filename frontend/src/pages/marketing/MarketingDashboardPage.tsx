import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  UserGroupIcon,
  StarIcon,
  XCircleIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';
import marketingApi from '../../features/marketing/api/marketingApi';
import { StatsCard } from '../../features/marketing/components';
import { LeadStatus } from '../../features/marketing/types';
import { LEAD_STATUS_BADGE } from '../../features/marketing/constants';
import { useMarketingAuthStore } from '../../store/marketingAuthStore';

export default function MarketingDashboardPage() {
  const { user } = useMarketingAuthStore();
  const { t } = useTranslation('marketing');
  const isManager = user?.role === 'SALES_MANAGER';

  const { data: stats } = useQuery({
    queryKey: ['marketing', 'dashboard', 'stats'],
    queryFn: () => marketingApi.get('/dashboard/stats').then((r) => r.data),
  });

  const { data: leadsByStatus } = useQuery({
    queryKey: ['marketing', 'dashboard', 'leads-by-status'],
    queryFn: () => marketingApi.get('/dashboard/leads-by-status').then((r) => r.data),
  });

  const { data: today } = useQuery({
    queryKey: ['marketing', 'dashboard', 'today'],
    queryFn: () => marketingApi.get('/dashboard/today').then((r) => r.data),
  });

  const { data: monthly } = useQuery({
    queryKey: ['marketing', 'dashboard', 'monthly'],
    queryFn: () => marketingApi.get('/dashboard/monthly').then((r) => r.data),
  });

  const { data: topPerformers } = useQuery({
    queryKey: ['marketing', 'dashboard', 'top-performers'],
    queryFn: () => marketingApi.get('/dashboard/top-performers').then((r) => r.data),
    enabled: isManager,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('dashboard.title')}</h1>
        <p className="text-sm text-slate-500">{t('dashboard.subtitle')}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title={t('dashboard.totalLeads')}
          value={stats?.totalLeads ?? 0}
          icon={<UserGroupIcon className="w-6 h-6" />}
          color="blue"
        />
        <StatsCard
          title={t('leadStatus.WON')}
          value={stats?.wonLeads ?? 0}
          icon={<StarIcon className="w-6 h-6" />}
          color="green"
        />
        <StatsCard
          title={t('leadStatus.LOST')}
          value={stats?.lostLeads ?? 0}
          icon={<XCircleIcon className="w-6 h-6" />}
          color="red"
        />
        <StatsCard
          title={t('dashboard.conversionRate')}
          value={`${stats?.conversionRate ?? 0}%`}
          icon={<ArrowTrendingUpIcon className="w-6 h-6" />}
          color="indigo"
        />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard title={t('leadStatus.NEW')} value={stats?.newLeads ?? 0} color="blue" />
        <StatsCard
          title={t('dashboard.openOffers')}
          value={stats?.activeOffers ?? 0}
          icon={<DocumentTextIcon className="w-6 h-6" />}
          color="yellow"
        />
        <StatsCard
          title={t('dashboard.pendingTasks')}
          value={stats?.pendingTasks ?? 0}
          icon={<ClipboardDocumentListIcon className="w-6 h-6" />}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">{t('dashboard.today')}</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('tasks.tabs.today')}</span>
              <span className="font-medium">{today?.todayTasks ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('taskStatus.COMPLETED')}</span>
              <span className="font-medium text-emerald-600">{today?.completedTasks ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('leadDetail.tabs.activities')}</span>
              <span className="font-medium">{today?.todayActivities ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('tasks.tabs.overdue')}</span>
              <span className="font-medium text-red-600">{today?.overdueTasks ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Monthly Metrics */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {t('dashboard.thisMonth')} ({monthly?.month})
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('leadStatus.NEW')}</span>
              <span className="font-medium">{monthly?.newLeads ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('leadStatus.WON')}</span>
              <span className="font-medium text-emerald-600">{monthly?.wonLeads ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('leadDetail.tabs.activities')}</span>
              <span className="font-medium">{monthly?.activitiesCount ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Leads by Status */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">{t('dashboard.byStatus')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {leadsByStatus?.map((item: { status: string; count: number }) => (
            <div key={item.status} className="text-center p-3 rounded-lg bg-slate-50">
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mb-2 ${
                  LEAD_STATUS_BADGE[item.status as LeadStatus] || 'bg-slate-100 text-slate-800'
                }`}
              >
                {t(`leadStatus.${item.status}`, { defaultValue: item.status })}
              </span>
              <p className="text-xl font-bold text-slate-900">{item.count}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Top Performers (Manager only) */}
      {isManager && topPerformers && topPerformers.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">{t('dashboard.topPerformers')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="pb-2 font-medium">{t('users.table.name')}</th>
                  <th className="pb-2 font-medium">{t('dashboard.totalLeads')}</th>
                  <th className="pb-2 font-medium">{t('leadDetail.tabs.activities')}</th>
                  <th className="pb-2 font-medium">{t('leadStatus.WON')}</th>
                </tr>
              </thead>
              <tbody>
                {topPerformers.map((rep: { id: string; name: string; totalLeads: number; totalActivities: number; wonThisMonth: number }) => (
                  <tr key={rep.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 font-medium text-slate-900">{rep.name}</td>
                    <td className="py-2">{rep.totalLeads}</td>
                    <td className="py-2">{rep.totalActivities}</td>
                    <td className="py-2 font-medium text-emerald-600">{rep.wonThisMonth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
