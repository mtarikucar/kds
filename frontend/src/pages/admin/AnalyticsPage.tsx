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
  AnalyticsFloorPlan,
} from '../../features/analytics';
import { InsightSeverity, InsightStatus } from '../../features/analytics/types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
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
} from 'lucide-react';

interface DateRangeForm {
  startDate: string;
  endDate: string;
}

type TabType = 'overview' | 'tables' | 'traffic' | 'behavior' | 'insights';

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

  const onSubmit = (data: DateRangeForm) => {
    setDateRange(data);
  };

  const handleGenerateMockData = async () => {
    try {
      const result = await generateMockData.mutateAsync(7);
      toast.success(`Generated mock data: ${result.occupancyRecords} occupancy records, ${result.insights} insights`);
    } catch {
      toast.error('Failed to generate mock data');
    }
  };

  const handleClearMockData = async () => {
    try {
      await clearMockData.mutateAsync();
      toast.success('Cleared all analytics data');
    } catch {
      toast.error('Failed to clear analytics data');
    }
  };

  const handleInsightAction = async (insightId: string, status: InsightStatus) => {
    try {
      await updateInsightStatus.mutateAsync({ id: insightId, status });
      toast.success('Insight status updated');
    } catch {
      toast.error('Failed to update insight status');
    }
  };

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: BarChart3 },
    { id: 'tables' as TabType, label: 'Table Analytics', icon: Table2 },
    { id: 'traffic' as TabType, label: 'Traffic Flow', icon: Map },
    { id: 'behavior' as TabType, label: 'Customer Behavior', icon: Users },
    { id: 'insights' as TabType, label: 'AI Insights', icon: Lightbulb },
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
    trend,
  }: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    trend?: { value: number; isPositive: boolean };
  }) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm text-slate-500 mb-1">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
            {trend && (
              <p className={`text-xs mt-1 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}% vs last period
              </p>
            )}
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
          <h1 className="text-2xl font-heading font-bold text-slate-900">Restaurant Analytics</h1>
          <p className="text-slate-500 mt-1">AI-powered insights and space utilization analysis</p>
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
              {generateMockData.isPending ? 'Generating...' : 'Generate Mock Data'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearMockData}
              disabled={clearMockData.isPending}
              className="text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Data
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 md:mb-6 border-b border-slate-200/60 overflow-x-auto">
        <nav className="flex space-x-4 min-w-max" aria-label="Analytics tabs">
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
      {activeTab !== 'insights' && (
        <Card className="mb-4 md:mb-6">
          <CardContent className="pt-4 md:pt-6">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
              <div className="flex-1">
                <Input
                  label="From"
                  type="date"
                  {...register('startDate')}
                />
              </div>
              <div className="flex-1">
                <Input
                  label="To"
                  type="date"
                  {...register('endDate')}
                />
              </div>
              <Button type="submit" className="w-full sm:w-auto">Apply</Button>
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
                  title="Average Table Utilization"
                  value={`${tableUtilization?.summary?.avgUtilization?.toFixed(1) || 0}%`}
                  subtitle={`${tableUtilization?.summary?.totalTables || 0} tables`}
                  icon={Table2}
                  color="bg-blue-500"
                />
                <StatCard
                  title="Total Revenue (Period)"
                  value={formatCurrency(tableUtilization?.summary?.totalRevenue || 0)}
                  subtitle={`${tableUtilization?.summary?.totalSessions || 0} table turns`}
                  icon={TrendingUp}
                  color="bg-green-500"
                />
                <StatCard
                  title="Congestion Score"
                  value={`${congestion?.overallScore || 100}/100`}
                  subtitle={`${congestion?.congestionPoints?.length || 0} hotspots`}
                  icon={Activity}
                  color={congestion?.overallScore && congestion.overallScore < 70 ? 'bg-yellow-500' : 'bg-green-500'}
                />
                <StatCard
                  title="Active Insights"
                  value={insightSummary?.byStatus?.NEW || 0}
                  subtitle={`${insightSummary?.total || 0} total insights`}
                  icon={Lightbulb}
                  color="bg-purple-500"
                />
              </div>

              {/* Actionable Insights */}
              <Card className="mb-4 md:mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-yellow-500" />
                    Actionable Insights
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
                                  Potential Impact: {insight.potentialImpact}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.IMPLEMENTED)}
                                className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                                title="Mark as implemented"
                              >
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              </button>
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.DISMISSED)}
                                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                title="Dismiss"
                              >
                                <XCircle className="h-4 w-4 text-red-600" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-center py-8">
                      No actionable insights at this time. Generate mock data to see sample insights.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Underutilized Tables */}
              {tableUtilization?.summary?.underutilizedTables && tableUtilization.summary.underutilizedTables.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      Underutilized Tables
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4">Table</th>
                            <th className="text-right py-3 px-4">Utilization</th>
                            <th className="text-right py-3 px-4">Revenue</th>
                            <th className="text-right py-3 px-4">Sessions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableUtilization.summary.underutilizedTables.map((table) => (
                            <tr key={table.tableId} className="border-b">
                              <td className="py-3 px-4 font-medium">Table {table.tableNumber}</td>
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
                  title="Total Tables"
                  value={tableUtilization?.summary?.totalTables || 0}
                  icon={Table2}
                  color="bg-blue-500"
                />
                <StatCard
                  title="Average Utilization"
                  value={`${tableUtilization?.summary?.avgUtilization?.toFixed(1) || 0}%`}
                  icon={BarChart3}
                  color="bg-green-500"
                />
                <StatCard
                  title="Peak Hour"
                  value={`${tableUtilization?.summary?.peakHour || 0}:00`}
                  subtitle={`${tableUtilization?.summary?.peakOccupancy?.toFixed(0) || 0}% occupancy`}
                  icon={Clock}
                  color="bg-purple-500"
                />
                <StatCard
                  title="Total Sessions"
                  value={tableUtilization?.summary?.totalSessions || 0}
                  icon={Users}
                  color="bg-orange-500"
                />
              </div>

              {/* All Tables */}
              <Card>
                <CardHeader>
                  <CardTitle>Table Utilization Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-4">Table</th>
                          <th className="text-left py-3 px-4">Section</th>
                          <th className="text-center py-3 px-4">Capacity</th>
                          <th className="text-right py-3 px-4">Utilization</th>
                          <th className="text-right py-3 px-4">Revenue</th>
                          <th className="text-right py-3 px-4">Sessions</th>
                          <th className="text-right py-3 px-4">Avg Order</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableUtilization?.tables?.map((table) => (
                          <tr key={table.tableId} className="border-b hover:bg-slate-50">
                            <td className="py-3 px-4 font-medium">Table {table.tableNumber}</td>
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
                  title="Congestion Score"
                  value={`${congestion?.overallScore || 100}/100`}
                  subtitle="Higher is better"
                  icon={Activity}
                  color={congestion?.overallScore && congestion.overallScore < 70 ? 'bg-yellow-500' : 'bg-green-500'}
                />
                <StatCard
                  title="Congestion Hotspots"
                  value={congestion?.congestionPoints?.length || 0}
                  subtitle="Areas with high traffic"
                  icon={Map}
                  color="bg-red-500"
                />
                <StatCard
                  title="Recommendations"
                  value={congestion?.recommendations?.length || 0}
                  subtitle="Suggestions to improve flow"
                  icon={Lightbulb}
                  color="bg-blue-500"
                />
              </div>

              {/* Recommendations */}
              {congestion?.recommendations && congestion.recommendations.length > 0 && (
                <Card className="mb-4 md:mb-6">
                  <CardHeader>
                    <CardTitle>Traffic Flow Recommendations</CardTitle>
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
              {congestion?.congestionPoints && congestion.congestionPoints.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Congestion Hotspots</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4">Location</th>
                            <th className="text-right py-3 px-4">Severity</th>
                            <th className="text-right py-3 px-4">Avg Wait Time</th>
                            <th className="text-right py-3 px-4">Peak Hour</th>
                          </tr>
                        </thead>
                        <tbody>
                          {congestion.congestionPoints.map((point, index) => (
                            <tr key={index} className="border-b">
                              <td className="py-3 px-4">
                                Grid ({point.x}, {point.z})
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

              {/* 3D Heatmap Visualization */}
              <Card className="mt-4 md:mt-6">
                <CardHeader>
                  <CardTitle>3D Heatmap Visualization</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <AnalyticsFloorPlan
                    startDate={dateRange.startDate}
                    endDate={dateRange.endDate}
                    className="p-4"
                  />
                </CardContent>
              </Card>
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
              {/* Behavior Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
                <StatCard
                  title="Avg Dining Time"
                  value={`${customerBehavior.avgDiningTime.toFixed(0)} min`}
                  icon={Clock}
                  color="bg-blue-500"
                />
                <StatCard
                  title="Avg Idle Time"
                  value={`${customerBehavior.avgIdleTime.toFixed(0)} min`}
                  subtitle="Time after dining"
                  icon={Clock}
                  color="bg-yellow-500"
                />
                <StatCard
                  title="Avg Party Size"
                  value={customerBehavior.avgPartySize.toFixed(1)}
                  icon={Users}
                  color="bg-green-500"
                />
                <StatCard
                  title="Avg Order Value"
                  value={formatCurrency(customerBehavior.avgOrderValue)}
                  icon={TrendingUp}
                  color="bg-purple-500"
                />
              </div>

              {/* Customer Journey Insights */}
              <Card className="mb-4 md:mb-6">
                <CardHeader>
                  <CardTitle>Customer Journey Insights</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <h4 className="font-semibold mb-3">Peak Hours</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-600">Peak Arrival</span>
                          <span className="font-medium">{customerBehavior.peakArrivalHour}:00</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Peak Departure</span>
                          <span className="font-medium">{customerBehavior.peakDepartureHour}:00</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl">
                      <h4 className="font-semibold mb-3">Time Breakdown</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-600">Dining</span>
                          <span className="font-medium">{customerBehavior.avgDiningTime.toFixed(0)} min</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Idle (post-dining)</span>
                          <span className="font-medium">{customerBehavior.avgIdleTime.toFixed(0)} min</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Idle/Dining Ratio</span>
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
                          <h4 className="font-semibold text-yellow-800">High Idle Time Detected</h4>
                          <p className="text-sm text-yellow-700 mt-1">
                            Customers are spending {customerBehavior.avgIdleTime.toFixed(0)} minutes at tables after dining.
                            Consider presenting the bill proactively or offering takeaway desserts to improve table turnover.
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
              <CardContent className="py-12">
                <p className="text-center text-slate-500">
                  No customer behavior data available. Generate mock data to see analytics.
                </p>
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
                  title="Total Insights"
                  value={insightSummary?.total || 0}
                  icon={Lightbulb}
                  color="bg-blue-500"
                />
                <StatCard
                  title="New"
                  value={insightSummary?.byStatus?.NEW || 0}
                  icon={AlertTriangle}
                  color="bg-yellow-500"
                />
                <StatCard
                  title="In Progress"
                  value={insightSummary?.byStatus?.IN_PROGRESS || 0}
                  icon={Activity}
                  color="bg-purple-500"
                />
                <StatCard
                  title="Implemented"
                  value={insightSummary?.byStatus?.IMPLEMENTED || 0}
                  icon={CheckCircle}
                  color="bg-green-500"
                />
              </div>

              {/* All Actionable Insights */}
              <Card>
                <CardHeader>
                  <CardTitle>All Insights</CardTitle>
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
                                  Impact: {insight.potentialImpact}
                                </p>
                              )}
                              <div className="flex items-center gap-4 mt-3 text-xs opacity-60">
                                <span>Confidence: {(insight.confidenceScore * 100).toFixed(0)}%</span>
                                <span>Created: {format(new Date(insight.createdAt), 'MMM d, yyyy')}</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.IMPLEMENTED)}
                                className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                                title="Mark as implemented"
                              >
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              </button>
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.IN_PROGRESS)}
                                className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                                title="Mark as in progress"
                              >
                                <Activity className="h-4 w-4 text-blue-600" />
                              </button>
                              <button
                                onClick={() => handleInsightAction(insight.id, InsightStatus.DISMISSED)}
                                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                title="Dismiss"
                              >
                                <XCircle className="h-4 w-4 text-red-600" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-center py-8">
                      No insights available. Generate mock data to see AI-powered insights.
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default AnalyticsPage;
