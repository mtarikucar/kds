import { useQuery } from '@tanstack/react-query';
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
import { LeadStatus, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '../../features/marketing/types';
import { useMarketingAuthStore } from '../../store/marketingAuthStore';

export default function MarketingDashboardPage() {
  const { user } = useMarketingAuthStore();
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
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Leads"
          value={stats?.totalLeads ?? 0}
          icon={<UserGroupIcon className="w-6 h-6" />}
          color="blue"
        />
        <StatsCard
          title="Won Deals"
          value={stats?.wonLeads ?? 0}
          icon={<StarIcon className="w-6 h-6" />}
          color="green"
        />
        <StatsCard
          title="Lost Deals"
          value={stats?.lostLeads ?? 0}
          icon={<XCircleIcon className="w-6 h-6" />}
          color="red"
        />
        <StatsCard
          title="Conversion Rate"
          value={`${stats?.conversionRate ?? 0}%`}
          icon={<ArrowTrendingUpIcon className="w-6 h-6" />}
          color="indigo"
        />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard
          title="New Leads"
          value={stats?.newLeads ?? 0}
          color="blue"
        />
        <StatsCard
          title="Active Offers"
          value={stats?.activeOffers ?? 0}
          icon={<DocumentTextIcon className="w-6 h-6" />}
          color="yellow"
        />
        <StatsCard
          title="Pending Tasks"
          value={stats?.pendingTasks ?? 0}
          icon={<ClipboardDocumentListIcon className="w-6 h-6" />}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Summary</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Tasks Today</span>
              <span className="font-medium">{today?.todayTasks ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Completed</span>
              <span className="font-medium text-green-600">{today?.completedTasks ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Activities</span>
              <span className="font-medium">{today?.todayActivities ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Overdue Tasks</span>
              <span className="font-medium text-red-600">{today?.overdueTasks ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Monthly Metrics */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Monthly Metrics ({monthly?.month})
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">New Leads</span>
              <span className="font-medium">{monthly?.newLeads ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Won Deals</span>
              <span className="font-medium text-green-600">{monthly?.wonLeads ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Total Activities</span>
              <span className="font-medium">{monthly?.activitiesCount ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Leads by Status */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Leads by Status</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {leadsByStatus?.map((item: { status: string; count: number }) => (
            <div
              key={item.status}
              className="text-center p-3 rounded-lg bg-gray-50"
            >
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mb-2 ${
                  LEAD_STATUS_COLORS[item.status as LeadStatus] || 'bg-gray-100 text-gray-800'
                }`}
              >
                {LEAD_STATUS_LABELS[item.status as LeadStatus] || item.status}
              </span>
              <p className="text-xl font-bold text-gray-900">{item.count}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Top Performers (Manager only) */}
      {isManager && topPerformers && topPerformers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Performers (This Month)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Total Leads</th>
                  <th className="pb-2 font-medium">Activities</th>
                  <th className="pb-2 font-medium">Won This Month</th>
                </tr>
              </thead>
              <tbody>
                {topPerformers.map((rep: any) => (
                  <tr key={rep.id} className="border-b last:border-0">
                    <td className="py-2 font-medium text-gray-900">{rep.name}</td>
                    <td className="py-2">{rep.totalLeads}</td>
                    <td className="py-2">{rep.totalActivities}</td>
                    <td className="py-2 font-medium text-green-600">{rep.wonThisMonth}</td>
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
