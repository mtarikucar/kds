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

// Inline meta chips (active / avg wait / urgent). The 1s ticker lives HERE so
// the per-second wait/urgency recomputation re-renders only this tiny row,
// never the whole header (or the order columns below it).
const KitchenMetaChips = ({ orders, kiosk }: { orders: Order[]; kiosk: boolean }) => {
  const { t } = useTranslation('kitchen');
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const avgWait = formatWaitTime(calculateAverageWaitTime(orders));
  const urgentCount = countUrgentOrders(orders);

  const baseChip = cn(
    'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs md:text-sm font-medium',
    kiosk ? 'bg-neutral-800 text-neutral-200' : 'bg-slate-100 text-slate-600'
  );

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={baseChip} title={t('kitchen.stats.activeOrders')}>
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">{t('kitchen.stats.activeOrders')}: </span>
        <span className="tabular-nums font-bold">{orders.length}</span>
      </span>
      {orders.length > 0 && (
        <span className={baseChip} title={t('kitchen.stats.avgWaitTime')}>
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t('kitchen.stats.avgWaitTime')}: </span>
          <span className="tabular-nums font-bold">{avgWait}</span>
        </span>
      )}
      {urgentCount > 0 && (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs md:text-sm font-medium animate-pulse',
            kiosk ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700'
          )}
          title={t('kitchen.stats.urgentOrders')}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t('kitchen.stats.urgentOrders')}: </span>
          <span className="tabular-nums font-bold">{urgentCount}</span>
        </span>
      )}
    </div>
  );
};

const KitchenStatsHeader = ({
  orders,
  isConnected,
  onRefresh,
  isLoading,
  kiosk = false,
  onToggleKiosk,
}: KitchenStatsHeaderProps) => {
  const { t } = useTranslation('kitchen');

  return (
    <div className="mb-3 md:mb-4 flex-shrink-0">
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

      {/* Single compact row: title + live meta chips left, controls right */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <h1 className={kioskHeadingText(kiosk)}>
            {t('kitchen.title')}
          </h1>
          <KitchenMetaChips orders={orders} kiosk={kiosk} />
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
    </div>
  );
};

export default KitchenStatsHeader;
