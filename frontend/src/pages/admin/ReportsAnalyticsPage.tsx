import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileBarChart, Activity } from 'lucide-react';
import { cn } from '../../lib/utils';
import ReportsPage from './ReportsPage';
import AnalyticsPage from './AnalyticsPage';

/**
 * Analitik & Raporlar — the unified reporting section. Previously two separate
 * sidebar entries + pages (Raporlar, Analitik) behind the SAME advancedReports
 * gate and role set, showing overlapping revenue/customer data. Merged into
 * one page with two top-level groups:
 *   • Raporlar — sales, P&L/COGS, budget, consolidated, forecast, hourly,
 *     customers, inventory, staff, Z-reports (accountant + operator reports)
 *   • Analitik — dashboards: table utilization, customer behavior, AI insights
 * Each source page is embedded (its own header hidden) under the group switch.
 */
type Group = 'reports' | 'analytics';

const ReportsAnalyticsPage = () => {
  const { t } = useTranslation('common');
  const [group, setGroup] = useState<Group>('reports');

  const reportsLabel = t('navigation.reports', 'Raporlar');
  const analyticsLabel = t('navigation.analytics', 'Analitik');
  const groups = [
    { id: 'reports' as const, label: reportsLabel, icon: FileBarChart },
    { id: 'analytics' as const, label: analyticsLabel, icon: Activity },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-slate-900">
          {t('navigation.reportsAnalytics', 'Analitik & Raporlar')}
        </h1>
      </div>

      {/* Group switch */}
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {groups.map((g) => {
          const Icon = g.icon;
          return (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                group === g.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="h-4 w-4" />
              {g.label}
            </button>
          );
        })}
      </div>

      {group === 'reports' ? <ReportsPage embedded /> : <AnalyticsPage embedded />}
    </div>
  );
};

export default ReportsAnalyticsPage;
