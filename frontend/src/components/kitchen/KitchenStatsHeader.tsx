import { Clock, RefreshCw, Users, AlertTriangle, Wifi, WifiOff, Maximize, Minimize } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Order } from '../../types';
import { calculateAverageWaitTime, countUrgentOrders, formatWaitTime, cn } from '../../lib/utils';
import Button from '../ui/Button';
import { useState, useEffect } from 'react';
import { kioskHeadingText } from './kioskTheme';

interface KitchenStatsHeaderProps {
  orders: Order[];
  isConnected: boolean;
  onRefresh: () => void;
  isLoading: boolean;
  // Dark high-contrast theme for kiosk mode. Default false = today's look.
  kiosk?: boolean;
  // Kiosk-mode toggle. When provided, a Maximize/Minimize button is shown.
  onToggleKiosk?: () => void;
}

const KitchenStatsHeader = ({
  orders,
  isConnected,
  onRefresh,
  isLoading,
  kiosk = false,
  onToggleKiosk,
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
      {/* Escalated disconnect bar — a full-width amber alert that the polling
          fallback is keeping the board fresh while the live socket is down.
          Far harder to miss than the small status pill. */}
      {!isConnected && (
        <div
          role="alert"
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 mb-3 rounded-lg text-sm font-medium border',
            kiosk
              ? 'bg-amber-500/20 border-amber-500 text-amber-200'
              : 'bg-amber-100 border-amber-300 text-amber-900'
          )}
        >
          <WifiOff className="h-4 w-4 flex-shrink-0" />
          <span>
            {t(
              'kitchen.socketDownBanner',
              'Canlı bağlantı kesildi — pano her ~10 sn yenileniyor'
            )}
          </span>
        </div>
      )}

      {/* Title Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className={kioskHeadingText(kiosk)}>
            {t('kitchen.title')}
          </h1>
          <p className={cn('text-sm md:text-base', kiosk ? 'text-neutral-400' : 'text-slate-600')}>
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

          {/* Kiosk-mode Toggle */}
          {onToggleKiosk && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleKiosk}
              className="gap-1.5"
              aria-label={
                kiosk
                  ? t('kitchen.exitKiosk', 'Kiosk modundan çık')
                  : t('kitchen.enterKiosk', 'Kiosk modu')
              }
              title={
                kiosk
                  ? t('kitchen.exitKiosk', 'Kiosk modundan çık')
                  : t('kitchen.enterKiosk', 'Kiosk modu')
              }
            >
              {kiosk ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              <span className="hidden md:inline">
                {kiosk
                  ? t('kitchen.exitKiosk', 'Kiosk modundan çık')
                  : t('kitchen.enterKiosk', 'Kiosk modu')}
              </span>
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        {stats.map((stat, index) => (
          <div
            key={index}
            className={cn(
              'relative rounded-xl p-3 md:p-4 transition-all',
              kiosk ? 'bg-neutral-900 border border-neutral-800' : stat.bgColor,
              stat.highlight && (kiosk ? 'ring-2 ring-red-500 animate-pulse' : 'ring-2 ring-red-200 animate-pulse')
            )}
          >
            <div className="flex items-center gap-2 md:gap-3">
              <div className={cn('p-2 rounded-lg', kiosk ? 'bg-neutral-800' : 'bg-white/80', stat.iconColor)}>
                <stat.icon className="h-4 w-4 md:h-5 md:w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn('text-lg md:text-2xl font-bold truncate', kiosk ? 'text-white' : stat.color)}>
                  {stat.value}
                </p>
                <p className={cn('text-xs md:text-sm truncate', kiosk ? 'text-neutral-400' : 'text-slate-500')}>
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
