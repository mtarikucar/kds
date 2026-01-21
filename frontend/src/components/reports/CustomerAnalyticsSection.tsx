import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Spinner from '../ui/Spinner';
import { useCustomerAnalytics } from '../../api/enhancedReportsApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { Users, UserPlus, UserCheck, Award, Star, Wallet } from 'lucide-react';

interface CustomerAnalyticsSectionProps {
  startDate?: string;
  endDate?: string;
}

const CustomerAnalyticsSection = ({ startDate, endDate }: CustomerAnalyticsSectionProps) => {
  const { t } = useTranslation('reports');
  const formatCurrency = useFormatCurrency();
  const { data, isLoading, error } = useCustomerAnalytics({ startDate, endDate });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-slate-500">{t('reports.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  const tierColors: Record<string, string> = {
    BRONZE: 'bg-amber-600',
    SILVER: 'bg-slate-400',
    GOLD: 'bg-yellow-500',
    PLATINUM: 'bg-purple-500',
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">{t('customerAnalytics.totalCustomers')}</p>
                <p className="text-2xl font-bold">{data.totalCustomers}</p>
              </div>
              <div className="p-3 rounded-full bg-blue-500">
                <Users className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">{t('customerAnalytics.newCustomers')}</p>
                <p className="text-2xl font-bold">{data.newCustomers}</p>
              </div>
              <div className="p-3 rounded-full bg-green-500">
                <UserPlus className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">{t('customerAnalytics.returningCustomers')}</p>
                <p className="text-2xl font-bold">{data.returningCustomers}</p>
              </div>
              <div className="p-3 rounded-full bg-purple-500">
                <UserCheck className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">{t('customerAnalytics.averageLifetimeValue')}</p>
                <p className="text-2xl font-bold">{formatCurrency(data.averageLifetimeValue)}</p>
              </div>
              <div className="p-3 rounded-full bg-amber-500">
                <Wallet className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">{t('customerAnalytics.totalLoyaltyPoints')}</p>
                <p className="text-2xl font-bold">{data.totalLoyaltyPoints.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-full bg-yellow-500">
                <Star className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tier Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            {t('customerAnalytics.tierDistribution')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            {data.tierDistribution.map((tier) => (
              <div
                key={tier.tier}
                className="flex-1 min-w-[120px] p-4 rounded-lg bg-slate-50"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${tierColors[tier.tier] || 'bg-slate-400'}`} />
                  <span className="font-medium capitalize">{tier.tier.toLowerCase()}</span>
                </div>
                <p className="text-2xl font-bold">{tier.count}</p>
                <p className="text-sm text-slate-500">
                  {data.totalCustomers > 0
                    ? ((tier.count / data.totalCustomers) * 100).toFixed(1)
                    : 0}%
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top Customers */}
      <Card>
        <CardHeader>
          <CardTitle>{t('customerAnalytics.topCustomers')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.topCustomers.length === 0 ? (
            <p className="text-center text-slate-500 py-4">{t('reports.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4">#</th>
                    <th className="text-left py-3 px-4">Name</th>
                    <th className="text-left py-3 px-4">Tier</th>
                    <th className="text-right py-3 px-4">Orders</th>
                    <th className="text-right py-3 px-4">Total Spent</th>
                    <th className="text-right py-3 px-4">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topCustomers.map((customer, index) => (
                    <tr key={customer.id} className="border-b hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <span className="font-bold text-blue-600">#{index + 1}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium">{customer.name}</p>
                          {customer.email && (
                            <p className="text-sm text-slate-500">{customer.email}</p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-white ${
                            tierColors[customer.loyaltyTier] || 'bg-slate-400'
                          }`}
                        >
                          {customer.loyaltyTier}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">{customer.totalOrders}</td>
                      <td className="py-3 px-4 text-right font-semibold text-green-600">
                        {formatCurrency(customer.totalSpent)}
                      </td>
                      <td className="py-3 px-4 text-right">{customer.loyaltyPoints.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CustomerAnalyticsSection;
