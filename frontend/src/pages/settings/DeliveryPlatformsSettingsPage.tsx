import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, ScrollText, AlertTriangle } from 'lucide-react';
import { useDeliveryPlatformConfigs } from '../../features/delivery-platforms/deliveryPlatformsApi';
import { SettingsSection, SettingsDivider } from '../../components/settings/SettingsSection';
import PlatformCard from '../../components/delivery-platforms/PlatformCard';
import PlatformLogViewer from '../../components/delivery-platforms/PlatformLogViewer';
import type { DeliveryPlatformConfig } from '../../types';

const ALL_PLATFORMS = ['GETIR', 'YEMEKSEPETI', 'TRENDYOL', 'MIGROS'];

const DeliveryPlatformsSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: configs, isLoading, isError } = useDeliveryPlatformConfigs();

  const configMap = useMemo(() => {
    const map = new Map<string, DeliveryPlatformConfig>();
    if (configs) {
      for (const config of configs) {
        map.set(config.platform, config);
      }
    }
    return map;
  }, [configs]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-48" />
          <div className="h-4 bg-slate-100 rounded w-96" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-slate-100 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{t('onlineOrders.loadError')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <SettingsSection
        title={t('onlineOrders.title', 'Online Order Platforms')}
        description={t(
          'onlineOrders.description',
          'Connect your restaurant to delivery platforms to receive orders directly in your kitchen display system.',
        )}
        icon={<Truck className="h-5 w-5" />}
      >
        <div className="space-y-3">
          {ALL_PLATFORMS.map((platform) => (
            <PlatformCard
              key={platform}
              platform={platform}
              config={configMap.get(platform)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsDivider />

      <SettingsSection
        title={t('onlineOrders.activityLog', 'Activity Log')}
        description={t(
          'onlineOrders.activityLogDescription',
          'View recent order sync activity and troubleshoot integration issues.',
        )}
        icon={<ScrollText className="h-5 w-5" />}
      >
        <PlatformLogViewer />
      </SettingsSection>
    </div>
  );
};

export default DeliveryPlatformsSettingsPage;
