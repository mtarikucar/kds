import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { format, subDays } from 'date-fns';
import {
  useTableUtilization,
  useActionableInsights,
  useInsightSummary,
  useCustomerBehavior,
  useCongestionAnalysis,
  useGenerateMockData,
  useClearMockData,
  useUpdateInsightStatus,
  useGenerateInsights,
  CameraManagement,
} from '../../features/analytics';
import { InsightSeverity, InsightStatus } from '../../features/analytics/types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { toast } from 'sonner';
import {
  Map,
  TrendingUp,
  Users,
  Table2,
  Lightbulb,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  Activity,
  Database,
  Trash2,
  Video,
  RefreshCw,
} from 'lucide-react';

interface DateRangeForm {
  startDate: string;
  endDate: string;
}

type TabType = 'overview' | 'tables' | 'traffic' | 'behavior' | 'insights' | 'cameras';

const AnalyticsPage = () => {
  const { t } = useTranslation(['analytics', 'common']);
  const formatCurrency = useFormatCurrency();
  const today = format(new Date(), 'yyyy-MM-dd');
  const lastWeek = format(subDays(new Date(), 7), 'yyyy-MM-dd');

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [dateRange, setDateRange] = useState({
    startDate: lastWeek,
    endDate: today,
  });

  const { register, handleSubmit } = useForm<DateRangeForm>({
    defaultValues: {
      startDate: lastWeek,
      endDate: today,
    },
  });

  // API hooks
  const { data: tableUtilization, isLoading: tablesLoading } = useTableUtilization(dateRange);
  const { data: actionableInsights, isLoading: insightsLoading } = useActionableInsights();
  const { data: insightSummary } = useInsightSummary();
  const { data: customerBehavior, isLoading: behaviorLoading } = useCustomerBehavior(dateRange);
  const { data: congestion, isLoading: congestionLoading } = useCongestionAnalysis(dateRange);

  // Mutations
  const generateMockData = useGenerateMockData();
  const clearMockData = useClearMockData();
  const updateInsightStatus = useUpdateInsightStatus();
  const generateInsights = useGenerateInsights();

  const onSubmit = (data: DateRangeForm) => {
    setDateRange(data);
  };

  // CV/occupancy telemetry is camera-hardware-gated. Without on-site cameras,
  // congestion + behavior metrics fall back to zero/default (e.g. party size
  // 2.5, idle 0 min, congestion 100/100), which read as real measurements.
  // Treat "no congestion points" as the honest signal that no occupancy
  // telemetry exists for the period and surface a "requires cameras"
  // disclosure on those cards instead of the misleading defaults.
  const hasCameraData = (congestion?.congestionPoints?.length ?? 0) > 0;

  const handleGenerateMockData = async () => {
    try {
      const result = await generateMockData.mutateAsync(7);
      toast.success(
        t('analytics:devTools.generated', {
          records: result.occupancyRecords,
          insights: result.insights,
        }),
      );
    } catch {
      toast.error(t('analytics:devTools.generateFailed'));
    }
  };

  const handleClearMockData = async () => {
    try {
      await clearMockData.mutateAsync();
      toast.success(t('analytics:devTools.cleared'));
    } catch {
      toast.error(t('analytics:devTools.clearFailed'));
    }
  };

  const handleInsightAction = async (insightId: string, status: InsightStatus) => {
    try {
      await updateInsightStatus.mutateAsync({ id: insightId, status });
      toast.success(t('analytics:insightCard.statusUpdated'));
    } catch {
      toast.error(t('analytics:insightCard.statusUpdateFailed'));
    }
  };

  const handleGenerateInsights = async () => {
    try {
      const result = await generateInsights.mutateAsync();
      toast.success(t('analytics:insightsTab.generatedCount', { value: result.generated }));
    } catch {
      toast.error(t('analytics:insightsTab.generateFailed'));
    }
  };

  const tabs = [
    { id: 'overview' as TabType, label: t('analytics:tabs.overview'), icon: BarChart3 },
    { id: 'tables' as TabType, label: t('analytics:tabs.tables'), icon: Table2 },
    { id: 'traffic' as TabType, label: t('analytics:tabs.traffic'), icon: Map },
    { id: 'behavior' as TabType, label: t('analytics:tabs.behavior'), icon: Users },
    { id: 'insights' as TabType, label: t('analytics:tabs.insights'), icon: Lightbulb },
    { id: 'cameras' as TabType, label: t('analytics:tabs.cameras'), icon: Video },
  ];

  const getSeverityColor = (severity: InsightSeverity) => {
    switch (severity) {
      case InsightSeverity.CRITICAL:
        return 'bg-red-100 text-red-800 border-red-200';
      case InsightSeverity.WARNING:
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  const getSeverityIcon = (severity: InsightSeverity) => {
    switch (severity) {
      case InsightSeverity.CRITICAL:
        return <XCircle className="h-5 w-5 text-red-600" />;
      case InsightSeverity.WARNING:
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      default:
        return <Lightbulb className="h-5 w-5 text-blue-600" />;
    }
  };

  const StatCard = ({
    title,
    value,
    subtitle,
    icon: Icon,
    color,
  }: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm text-slate-500 mb-1">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
          </div>
          <div className={`p-3 rounded-full ${color}`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-heading font-bold text-slate-900">
            {t('analytics:page.title')}
          </h1>
          <p className="text-slate-500 mt-1">{t('analytics:page.subtitle')}</p>
        </div>
        {/* Dev tools - only show in development */}
        {import.meta.env.DEV && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateMockData}
              disabled={generateMockData.isPending}
            >
              <Database className="h-4 w-4 mr-2" />
              {generateMockData.isPending
                ? t('analytics:devTools.generating')
                : t('analytics:devTools.generate')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearMockData}
              disabled={clearMockData.isPending}
              className="text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('analytics:devTools.clear')}
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 md:mb-6 border-b border-slate-200/60 overflow-x-auto">
        <nav className="flex space-x-4 min-w-max" aria-label={t('analytics:page.tabsAriaLabel')}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Date Range Filter */}
      {activeTab !== 'insights' && activeTab !== 'cameras' && (
        <Card className="mb-4 md:mb-6">
          <CardContent className="pt-4 md:pt-6">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
              <div className="flex-1">
                <Input
                  label={t('analytics:dateFilter.from')}
                  type="date"
                  {...register('startDate')}
                />
              </div>
              <div className="flex-1">
                <Input
                  label={t('analytics:dateFilter.to')}
                  type="date"
                  {...register('endDate')}
                />
              </div>
              <Button type="submit" className="w-full sm:w-auto">
                {t('analytics:dateFilter.apply')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          {tablesLoading || insightsLoading ? (
            <Spinner />
          ) : (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
                <StatCard
                  title={t('analytics:stats.avgTableUtilization')}
                  value={`${tableUtilization?.summary?.avgUtilization?.toFixed(1) || 0}%`}
                  subtitle={t('analytics:stats.tablesCount', {
                    value: tableUtilization?.summary?.totalTables || 0,
                  })}
                  icon={Table2}
                  color="bg-blue-500"
                />
                <StatCard
                  title={t('analytics:stats.totalRevenuePeriod')}
                  value={formatCurrency(tableUtilization?.summary?.totalRevenue || 0)}
                  subtitle={t('analytics:stats.tableTurns', {
                    value: tableUtilization?.summary?.totalSessions || 0,
                  })}
                  icon={TrendingUp}
                  color="bg-green-500"
                />
                <StatCard
                  title={t('analytics:stats.congestionScore')}
                  value={hasCameraData ? `${congestion?.overallScore ?? 0}/100` : t('analytics:cvDisclosure.noData')}
                  subtitle={
                    hasCameraData
                      ? t('analytics:stats.hotspotsCount', {
                          value: congestion?.congestionPoints?.length || 0,
                        })
                      : t('analytics:cvDisclosure.requiresCameras')
                  }
                  icon={Activity}
                  color={!hasCameraData ? 'bg-slate-400' : congestion?.overallScore && congestion.overallScore < 70 ? 'bg-yellow-500' : 'bg-green-500'}
                />
                <StatCard
                  title={t('analytics:stats.activeInsights')}
                  value={insightSummary?.byStatus?.NEW || 0}
                  subtitle={t('analytics:stats.totalInsightsCount', {
                    value: insightSummary?.total || 0,
                  })}
                  icon={Lightbulb}
                  color="bg-purple-500"
                />
              </div>

              {/* Actionable Insights */}
              <Card className="mb-4 md:mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-yellow-500" />
                    {t('analytics:overview.actionableInsights')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {actionableInsights && actionableInsights.length > 0 ? (
                    <div className="space-y-3">
                      {actionableInsights.slice(0, 5).map((insight) => (
                        <div
                          key={insight.id}
                          className={`p-4 rounded-xl border ${getSeverityColor(insight.severity)}`}
                        >
                          <div className="flex items-start gap-3">
                            {getSeverityIcon(insight.severity)}
                            <div className="flex-1">
                              <h4 className="font-semibold">{insight.title}</h4>
                              <p className="text-sm mt-1 opacity-80">{insight.description}</p>
                              <p className="text-sm mt-2 font-medium">
                                💡 {insight.recommendation}
                              </p>
                              {insight.potentialImpact && (
                                <p className="text-xs mt-2 text-green-700">
                                  {t('analytics:insightCard.potentialImpact', {
                                    impact: insight.potentialImpact,
                                  })}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.IMPLEMENTED)}
                                className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                                title={t('analytics:insightCard.markImplemented')}
                              >
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              </button>
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.DISMISSED)}
                                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                title={t('analytics:insightCard.dismiss')}
                              >
                                <XCircle className="h-4 w-4 text-red-600" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={Lightbulb}
                      title={t('analytics:overview.noInsightsTitle')}
                      description={t('analytics:overview.noInsightsDescription')}
                    />
                  )}
                </CardContent>
              </Card>

              {/* Underutilized Tables */}
              {tableUtilization?.summary?.underutilizedTables && tableUtilization.summary.underutilizedTables.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      {t('analytics:overview.underutilizedTables')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4">{t('analytics:columns.table')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.utilization')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.revenue')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.sessions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableUtilization.summary.underutilizedTables.map((table) => (
                            <tr key={table.tableId} className="border-b">
                              <td className="py-3 px-4 font-medium">
                                {t('analytics:tableLabel', { number: table.tableNumber })}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <span className="text-red-600 font-semibold">
                                  {table.utilizationScore.toFixed(1)}%
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">{formatCurrency(table.revenue)}</td>
                              <td className="py-3 px-4 text-right">{table.sessions}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* Tables Tab */}
      {activeTab === 'tables' && (
        <>
          {tablesLoading ? (
            <Spinner />
          ) : (
            <>
              {/* Table Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
                <StatCard
                  title={t('analytics:stats.totalTables')}
                  value={tableUtilization?.summary?.totalTables || 0}
                  icon={Table2}
                  color="bg-blue-500"
                />
                <StatCard
                  title={t('analytics:stats.avgUtilization')}
                  value={`${tableUtilization?.summary?.avgUtilization?.toFixed(1) || 0}%`}
                  icon={BarChart3}
                  color="bg-green-500"
                />
                <StatCard
                  title={t('analytics:stats.peakHour')}
                  value={`${tableUtilization?.summary?.peakHour || 0}:00`}
                  subtitle={t('analytics:stats.peakOccupancy', {
                    percent: tableUtilization?.summary?.peakOccupancy?.toFixed(0) || 0,
                  })}
                  icon={Clock}
                  color="bg-purple-500"
                />
                <StatCard
                  title={t('analytics:stats.totalSessions')}
                  value={tableUtilization?.summary?.totalSessions || 0}
                  icon={Users}
                  color="bg-orange-500"
                />
              </div>

              {/* All Tables */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('analytics:tableDetails.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {tableUtilization?.tables && tableUtilization.tables.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4">{t('analytics:columns.table')}</th>
                            <th className="text-left py-3 px-4">{t('analytics:columns.section')}</th>
                            <th className="text-center py-3 px-4">{t('analytics:columns.capacity')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.utilization')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.revenue')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.sessions')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.avgOrder')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableUtilization.tables.map((table) => (
                            <tr key={table.tableId} className="border-b hover:bg-slate-50">
                              <td className="py-3 px-4 font-medium">
                                {t('analytics:tableLabel', { number: table.tableNumber })}
                              </td>
                              <td className="py-3 px-4 text-slate-500">{table.section || '-'}</td>
                              <td className="py-3 px-4 text-center">{table.capacity}</td>
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-16 bg-slate-200 rounded-full h-2">
                                    <div
                                      className={`h-2 rounded-full ${
                                        table.utilizationScore >= 70
                                          ? 'bg-green-500'
                                          : table.utilizationScore >= 50
                                            ? 'bg-yellow-500'
                                            : 'bg-red-500'
                                      }`}
                                      style={{ width: `${Math.min(table.utilizationScore, 100)}%` }}
                                    />
                                  </div>
                                  <span className="font-semibold w-12 text-right">
                                    {table.utilizationScore.toFixed(0)}%
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-right font-medium text-green-600">
                                {formatCurrency(table.revenue)}
                              </td>
                              <td className="py-3 px-4 text-right">{table.sessions}</td>
                              <td className="py-3 px-4 text-right">
                                {table.avgOrderValue ? formatCurrency(table.avgOrderValue) : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState
                      icon={Table2}
                      title={t('analytics:tableDetails.emptyTitle')}
                      description={t('analytics:tableDetails.emptyDescription')}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {/* Traffic Tab */}
      {activeTab === 'traffic' && (
        <>
          {congestionLoading ? (
            <Spinner />
          ) : (
            <>
              {/* Congestion Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
                <StatCard
                  title={t('analytics:stats.congestionScore')}
                  value={hasCameraData ? `${congestion?.overallScore ?? 0}/100` : t('analytics:cvDisclosure.noData')}
                  subtitle={hasCameraData ? t('analytics:stats.higherIsBetter') : t('analytics:cvDisclosure.requiresCameras')}
                  icon={Activity}
                  color={!hasCameraData ? 'bg-slate-400' : congestion?.overallScore && congestion.overallScore < 70 ? 'bg-yellow-500' : 'bg-green-500'}
                />
                <StatCard
                  title={t('analytics:stats.congestionHotspots')}
                  value={congestion?.congestionPoints?.length || 0}
                  subtitle={t('analytics:stats.highTrafficAreas')}
                  icon={Map}
                  color="bg-red-500"
                />
                <StatCard
                  title={t('analytics:stats.recommendations')}
                  value={congestion?.recommendations?.length || 0}
                  subtitle={t('analytics:stats.flowSuggestions')}
                  icon={Lightbulb}
                  color="bg-blue-500"
                />
              </div>

              {/* No camera telemetry: explain honestly what this tab needs
                  and point to the software-only analytics that work today. */}
              {!hasCameraData && (
                <Card className="mb-4 md:mb-6">
                  <CardContent>
                    <EmptyState
                      icon={Video}
                      title={t('analytics:traffic.emptyTitle')}
                      description={t('analytics:traffic.emptyDescription')}
                      actionLabel={t('analytics:traffic.goToCameras')}
                      onAction={() => setActiveTab('cameras')}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Recommendations */}
              {congestion?.recommendations && congestion.recommendations.length > 0 && (
                <Card className="mb-4 md:mb-6">
                  <CardHeader>
                    <CardTitle>{t('analytics:traffic.recommendationsTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {congestion.recommendations.map((rec, index) => (
                        <li key={index} className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                          <Lightbulb className="h-5 w-5 text-blue-600 mt-0.5" />
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Congestion Points */}
              {hasCameraData && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('analytics:traffic.hotspotsTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4">{t('analytics:columns.location')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.severity')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.avgWaitTime')}</th>
                            <th className="text-right py-3 px-4">{t('analytics:columns.peakHour')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {congestion?.congestionPoints?.map((point, index) => (
                            <tr key={index} className="border-b">
                              <td className="py-3 px-4">
                                {t('analytics:traffic.gridCell', { x: point.x, z: point.z })}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <span
                                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    point.severity >= 0.8
                                      ? 'bg-red-100 text-red-800'
                                      : point.severity >= 0.6
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {(point.severity * 100).toFixed(0)}%
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                {point.avgWaitTime.toFixed(0)}s
                              </td>
                              <td className="py-3 px-4 text-right">{point.peakHour}:00</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 3D Heatmap visualisation removed with voxel-world */}
            </>
          )}
        </>
      )}

      {/* Behavior Tab */}
      {activeTab === 'behavior' && (
        <>
          {behaviorLoading ? (
            <Spinner />
          ) : customerBehavior ? (
            <>
              {/* CV/occupancy telemetry disclosure — idle time and party size
                  are camera-derived and read as 0/2.5 defaults without
                  on-site cameras. Surface that honestly. */}
              {!hasCameraData && (
                <div className="mb-4 md:mb-6 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-slate-500 mt-0.5" />
                    <p className="text-sm text-slate-600">
                      {t('analytics:cvDisclosure.noOccupancyTelemetry')}
                    </p>
                  </div>
                </div>
              )}

              {/* Behavior Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
                <StatCard
                  title={t('analytics:stats.avgDiningTime')}
                  value={t('analytics:stats.minutesValue', {
                    minutes: customerBehavior.avgDiningTime.toFixed(0),
                  })}
                  icon={Clock}
                  color="bg-blue-500"
                />
                <StatCard
                  title={t('analytics:stats.avgIdleTime')}
                  value={
                    hasCameraData
                      ? t('analytics:stats.minutesValue', {
                          minutes: customerBehavior.avgIdleTime.toFixed(0),
                        })
                      : t('analytics:cvDisclosure.noData')
                  }
                  subtitle={hasCameraData ? t('analytics:stats.timeAfterDining') : t('analytics:cvDisclosure.requiresCameras')}
                  icon={Clock}
                  color={hasCameraData ? 'bg-yellow-500' : 'bg-slate-400'}
                />
                <StatCard
                  title={t('analytics:stats.avgPartySize')}
                  value={hasCameraData ? customerBehavior.avgPartySize.toFixed(1) : t('analytics:cvDisclosure.noData')}
                  subtitle={hasCameraData ? undefined : t('analytics:cvDisclosure.requiresCameras')}
                  icon={Users}
                  color={hasCameraData ? 'bg-green-500' : 'bg-slate-400'}
                />
                <StatCard
                  title={t('analytics:stats.avgOrderValue')}
                  value={formatCurrency(customerBehavior.avgOrderValue)}
                  icon={TrendingUp}
                  color="bg-purple-500"
                />
              </div>

              {/* Customer Journey Insights */}
              <Card className="mb-4 md:mb-6">
                <CardHeader>
                  <CardTitle>{t('analytics:behavior.journeyTitle')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <h4 className="font-semibold mb-3">{t('analytics:behavior.peakHours')}</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-600">{t('analytics:behavior.peakArrival')}</span>
                          <span className="font-medium">{customerBehavior.peakArrivalHour}:00</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">{t('analytics:behavior.peakDeparture')}</span>
                          <span className="font-medium">{customerBehavior.peakDepartureHour}:00</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl">
                      <h4 className="font-semibold mb-3">{t('analytics:behavior.timeBreakdown')}</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-600">{t('analytics:behavior.dining')}</span>
                          <span className="font-medium">
                            {t('analytics:stats.minutesValue', {
                              minutes: customerBehavior.avgDiningTime.toFixed(0),
                            })}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">{t('analytics:behavior.idlePostDining')}</span>
                          <span className="font-medium">
                            {t('analytics:stats.minutesValue', {
                              minutes: customerBehavior.avgIdleTime.toFixed(0),
                            })}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">{t('analytics:behavior.idleDiningRatio')}</span>
                          <span className={`font-medium ${customerBehavior.idleToDiningRatio > 0.5 ? 'text-yellow-600' : 'text-green-600'}`}>
                            {(customerBehavior.idleToDiningRatio * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {customerBehavior.idleToDiningRatio > 0.5 && (
                    <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-yellow-800">
                            {t('analytics:behavior.highIdleTitle')}
                          </h4>
                          <p className="text-sm text-yellow-700 mt-1">
                            {t('analytics:behavior.highIdleDescription', {
                              minutes: customerBehavior.avgIdleTime.toFixed(0),
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  icon={Users}
                  title={t('analytics:behavior.emptyTitle')}
                  description={t('analytics:behavior.emptyDescription')}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Insights Tab */}
      {activeTab === 'insights' && (
        <>
          {insightsLoading ? (
            <Spinner />
          ) : (
            <>
              {/* Insight Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
                <StatCard
                  title={t('analytics:stats.totalInsights')}
                  value={insightSummary?.total || 0}
                  icon={Lightbulb}
                  color="bg-blue-500"
                />
                <StatCard
                  title={t('analytics:stats.new')}
                  value={insightSummary?.byStatus?.NEW || 0}
                  icon={AlertTriangle}
                  color="bg-yellow-500"
                />
                <StatCard
                  title={t('analytics:stats.inProgress')}
                  value={insightSummary?.byStatus?.IN_PROGRESS || 0}
                  icon={Activity}
                  color="bg-purple-500"
                />
                <StatCard
                  title={t('analytics:stats.implemented')}
                  value={insightSummary?.byStatus?.IMPLEMENTED || 0}
                  icon={CheckCircle}
                  color="bg-green-500"
                />
              </div>

              {/* All Actionable Insights */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>{t('analytics:insightsTab.allTitle')}</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateInsights}
                      disabled={generateInsights.isPending}
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${generateInsights.isPending ? 'animate-spin' : ''}`}
                      />
                      {generateInsights.isPending
                        ? t('analytics:insightsTab.refreshing')
                        : t('analytics:insightsTab.refresh')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {actionableInsights && actionableInsights.length > 0 ? (
                    <div className="space-y-4">
                      {actionableInsights.map((insight) => (
                        <div
                          key={insight.id}
                          className={`p-4 rounded-xl border ${getSeverityColor(insight.severity)}`}
                        >
                          <div className="flex items-start gap-3">
                            {getSeverityIcon(insight.severity)}
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold">{insight.title}</h4>
                                <span className="text-xs px-2 py-0.5 bg-white/50 rounded-full">
                                  {insight.category}
                                </span>
                              </div>
                              <p className="text-sm opacity-80">{insight.description}</p>
                              <p className="text-sm mt-2 font-medium">
                                💡 {insight.recommendation}
                              </p>
                              {insight.potentialImpact && (
                                <p className="text-xs mt-2 opacity-70">
                                  {t('analytics:insightCard.impact', {
                                    impact: insight.potentialImpact,
                                  })}
                                </p>
                              )}
                              <div className="flex items-center gap-4 mt-3 text-xs opacity-60">
                                <span>
                                  {t('analytics:insightCard.confidence', {
                                    percent: (insight.confidenceScore * 100).toFixed(0),
                                  })}
                                </span>
                                <span>
                                  {t('analytics:insightCard.created', {
                                    date: format(new Date(insight.createdAt), 'MMM d, yyyy'),
                                  })}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.IMPLEMENTED)}
                                className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                                title={t('analytics:insightCard.markImplemented')}
                              >
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              </button>
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.IN_PROGRESS)}
                                className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                title={t('analytics:insightCard.markInProgress')}
                              >
                                <Activity className="h-4 w-4 text-blue-600" />
                              </button>
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.DISMISSED)}
                                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                title={t('analytics:insightCard.dismiss')}
                              >
                                <XCircle className="h-4 w-4 text-red-600" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={Lightbulb}
                      title={t('analytics:insightsTab.emptyTitle')}
                      description={t('analytics:insightsTab.emptyDescription')}
                      actionLabel={t('analytics:insightsTab.generateNow')}
                      onAction={handleGenerateInsights}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {/* Cameras Tab */}
      {activeTab === 'cameras' && <CameraManagement />}
    </div>
  );
};

export default AnalyticsPage;
