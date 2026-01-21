import { Clock, RefreshCw, Users, AlertTriangle, Wifi, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Order } from '../../types';
import { calculateAverageWaitTime, countUrgentOrders, formatWaitTime } from '../../lib/utils';
import Button from '../ui/Button';
import { useState, useEffect } from 'react';

interface KitchenStatsHeaderProps {
  orders: Order[];
  isConnected: boolean;
  onRefresh: () => void;
  isLoading: boolean;
}

const KitchenStatsHeader = ({
  orders,
  isConnected,
  onRefresh,
  isLoading,
}: KitchenStatsHeaderProps) => {
  const { t } = useTranslation('kitchen');
  const [avgWaitTime, setAvgWaitTime] = useState('0s');
  const [urgentCount, setUrgentCount] = useState(0);

  // Update stats every second for real-time display
  useEffect(() => {
    const updateStats = () => {
      const avg = calculateAverageWaitTime(orders);
      setAvgWaitTime(formatWaitTime(avg));
      setUrgentCount(countUrgentOrders(orders));
    };

    updateStats();
    const interval = setInterval(updateStats, 1000);

    return () => clearInterval(interval);
  }, [orders]);

  const stats = [
    {
      icon: Users,
      value: orders.length,
      label: t('kitchen.stats.activeOrders'),
      color: 'text-slate-600',
      bgColor: 'bg-slate-50',
      iconColor: 'text-slate-500',
    },
    {
      icon: Clock,
      value: avgWaitTime,
      label: t('kitchen.stats.avgWaitTime'),
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-500',
    },
    {
      icon: AlertTriangle,
      value: urgentCount,
      label: t('kitchen.stats.urgentOrders'),
      color: urgentCount > 0 ? 'text-red-600' : 'text-slate-600',
      bgColor: urgentCount > 0 ? 'bg-red-50' : 'bg-slate-50',
      iconColor: urgentCount > 0 ? 'text-red-500' : 'text-slate-500',
      highlight: urgentCount > 0,
    },
  ];

  return (
    <div className="mb-4 md:mb-6 flex-shrink-0">
      {/* Title Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-slate-900">
            {t('kitchen.title')}
          </h1>
          <p className="text-sm md:text-base text-slate-600">
            {t('kitchen.realtimeTracking')}
          </p>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {/* WebSocket Status */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              isConnected
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {isConnected ? (
              <Wifi className="h-4 w-4" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {isConnected ? t('kitchen.connected') : t('kitchen.disconnected')}
            </span>
          </div>

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            isLoading={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden md:inline">{t('common:buttons.refresh')}</span>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        {stats.map((stat, index) => (
          <div
            key={index}
            className={`relative rounded-xl p-3 md:p-4 transition-all ${stat.bgColor} ${
              stat.highlight ? 'ring-2 ring-red-200 animate-pulse' : ''
            }`}
          >
            <div className="flex items-center gap-2 md:gap-3">
              <div className={`p-2 rounded-lg bg-white/80 ${stat.iconColor}`}>
                <stat.icon className="h-4 w-4 md:h-5 md:w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-lg md:text-2xl font-bold ${stat.color} truncate`}>
                  {stat.value}
                </p>
                <p className="text-xs md:text-sm text-slate-500 truncate">
                  {stat.label}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default KitchenStatsHeader;
