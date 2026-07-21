import React from 'react';
import { Card, CardContent } from './Card';
import Skeleton from './Skeleton';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  trend?: { value: number; isPositive: boolean };
  trendLabel?: string;
  isLoading?: boolean;
}

// Shared KPI stat card (promoted from ReportsPage's page-local version so the
// dashboard and reports render identical stat tiles).
const StatCard = ({ title, value, icon: Icon, color, trend, trendLabel, isLoading }: StatCardProps) => (
  <Card>
    <CardContent className="pt-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-slate-500 mb-1 truncate">{title}</p>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          )}
          {!isLoading && trend && (
            <p className={`text-xs mt-1 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {trend.isPositive ? '↑' : '↓'} %{trend.value}
              {trendLabel ? ` ${trendLabel}` : ''}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-full shrink-0 ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </CardContent>
  </Card>
);

export { StatCard };
export default StatCard;
