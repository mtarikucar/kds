import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Power,
  TestTube,
  Store,
  ChevronDown,
  ChevronUp,
  Save,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import PlatformStatusBadge from './PlatformStatusBadge';
import PlatformCredentialsForm from './PlatformCredentialsForm';
import type { DeliveryPlatformConfig } from '../../types';
import {
  useUpdatePlatformConfig,
  useCreatePlatformConfig,
  useTestPlatformConnection,
  useToggleRestaurant,
} from '../../features/delivery-platforms/deliveryPlatformsApi';

// Required credential fields per platform
const REQUIRED_CREDENTIALS: Record<string, string[]> = {
  GETIR: ['appSecretKey', 'restaurantSecretKey'],
  YEMEKSEPETI: ['clientId', 'clientSecret'],
  TRENDYOL: ['username', 'password'],
  MIGROS: ['apiKey'],
};

function checkHasCredentials(
  platform: string,
  credentials: Record<string, any>,
): boolean {
  const required = REQUIRED_CREDENTIALS[platform] || [];
  return required.every(
    (key) => credentials[key] && String(credentials[key]).trim() !== '',
  );
}

interface PlatformInfo {
  name: string;
  platform: string;
  color: string;
  bgColor: string;
  description: string;
}

const PLATFORM_INFO: Record<string, PlatformInfo> = {
  GETIR: {
    name: 'Getir Yemek',
    platform: 'GETIR',
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
    description: 'Polling-based integration (every 15s)',
  },
  YEMEKSEPETI: {
    name: 'Yemeksepeti',
    platform: 'YEMEKSEPETI',
    color: 'text-pink-700',
    bgColor: 'bg-pink-50',
    description: 'Webhook-based integration (real-time)',
  },
  TRENDYOL: {
    name: 'Trendyol Yemek',
    platform: 'TRENDYOL',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
    description: 'Webhook + polling integration',
  },
  MIGROS: {
    name: 'Migros Yemek',
    platform: 'MIGROS',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    description: 'Polling-based integration (every 20s)',
  },
};

interface PlatformCardProps {
  platform: string;
  config?: DeliveryPlatformConfig;
}

const PlatformCard = ({ platform, config }: PlatformCardProps) => {
  const { t } = useTranslation('settings');
  const info = PLATFORM_INFO[platform];
  const [expanded, setExpanded] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, any>>(
    (config?.credentials as Record<string, any>) || {},
  );
  const [remoteRestaurantId, setRemoteRestaurantId] = useState(
    config?.remoteRestaurantId || '',
  );
  const [autoAccept, setAutoAccept] = useState(config?.autoAccept ?? true);
  const [hasChanges, setHasChanges] = useState(false);

  const updateConfig = useUpdatePlatformConfig();
  const createConfig = useCreatePlatformConfig();
  const testConnection = useTestPlatformConnection();
  const toggleRestaurant = useToggleRestaurant();

  const hasCredentials = checkHasCredentials(platform, credentials);

  const handleToggleEnabled = async () => {
    if (!config) {
      if (!hasCredentials) {
        toast.error(t('onlineOrders.fillCredentials'));
        setExpanded(true);
        return;
      }
      await createConfig.mutateAsync({
        platform,
        credentials,
        remoteRestaurantId,
        autoAccept,
      });
    } else {
      if (!config.isEnabled && !hasCredentials) {
        toast.error(t('onlineOrders.fillCredentials'));
        setExpanded(true);
        return;
      }
      await updateConfig.mutateAsync({
        platform,
        isEnabled: !config.isEnabled,
      });
    }
  };

  const handleSave = async () => {
    if (!config) {
      await createConfig.mutateAsync({
        platform,
        credentials,
        remoteRestaurantId,
        autoAccept,
      });
    } else {
      await updateConfig.mutateAsync({
        platform,
        credentials,
        remoteRestaurantId,
        autoAccept,
      });
    }
    setHasChanges(false);
  };

  const handleCredentialsChange = (
    creds: Record<string, any>,
    remoteId: string,
  ) => {
    setCredentials(creds);
    setRemoteRestaurantId(remoteId);
    setHasChanges(true);
  };

  const handleTestConnection = () => {
    if (!hasCredentials) {
      toast.error(t('onlineOrders.fillCredentialsFirst'));
      return;
    }
    testConnection.mutate(platform);
  };

  const handleToggleRestaurant = () => {
    if (config) {
      toggleRestaurant.mutate({
        platform,
        open: !config.restaurantOpen,
      });
    }
  };

  const isSaving =
    updateConfig.isPending || createConfig.isPending;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${info.bgColor}`}
          >
            <span className={`text-sm font-bold ${info.color}`}>
              {info.name.charAt(0)}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {info.name}
              </h3>
              <PlatformStatusBadge
                isEnabled={config?.isEnabled || false}
                errorCount={config?.errorCount || 0}
                lastError={config?.lastError}
                hasCredentials={hasCredentials}
              />
            </div>
            <p className="text-xs text-slate-500">{info.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Enable/Disable Toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleEnabled();
            }}
            aria-label={config?.isEnabled ? `Disable ${info.name}` : `Enable ${info.name}`}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config?.isEnabled ? 'bg-primary-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                config?.isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>

          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-slate-200 p-4 space-y-4">
          {/* Credentials Form */}
          <PlatformCredentialsForm
            platform={platform}
            credentials={credentials}
            remoteRestaurantId={remoteRestaurantId}
            onChange={handleCredentialsChange}
          />

          {/* Auto-accept Toggle */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-slate-700">
                {t('onlineOrders.autoAccept')}
              </p>
              <p className="text-xs text-slate-500">
                {t('onlineOrders.autoAcceptDescription')}
              </p>
            </div>
            <button
              onClick={() => {
                setAutoAccept(!autoAccept);
                setHasChanges(true);
              }}
              aria-label={autoAccept ? `Disable auto-accept for ${info.name}` : `Enable auto-accept for ${info.name}`}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoAccept ? 'bg-primary-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoAccept ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Error Info */}
          {config?.lastError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-medium text-red-800">{t('onlineOrders.lastError')}</p>
              <p className="text-xs text-red-600 mt-1">{config.lastError}</p>
              {config.lastErrorAt && (
                <p className="text-xs text-red-400 mt-1">
                  {new Date(config.lastErrorAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
            {hasChanges && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {t('onlineOrders.save')}
              </button>
            )}

            <button
              onClick={handleTestConnection}
              disabled={testConnection.isPending || !config}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {testConnection.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <TestTube className="h-3.5 w-3.5" />
              )}
              {t('onlineOrders.testConnection')}
            </button>

            {config?.isEnabled && (
              <button
                onClick={handleToggleRestaurant}
                disabled={toggleRestaurant.isPending}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                  config.restaurantOpen
                    ? 'text-red-700 bg-red-50 hover:bg-red-100'
                    : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                }`}
              >
                {toggleRestaurant.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Store className="h-3.5 w-3.5" />
                )}
                {config.restaurantOpen ? t('onlineOrders.closeRestaurant') : t('onlineOrders.openRestaurant')}
              </button>
            )}
          </div>

          {/* Sync Info */}
          {config && (
            <div className="grid grid-cols-2 gap-3 text-xs text-slate-500 pt-2 border-t border-slate-100">
              <div>
                <span className="font-medium">{t('onlineOrders.lastPoll')}:</span>{' '}
                {config.lastOrderPollAt
                  ? new Date(config.lastOrderPollAt).toLocaleString()
                  : t('onlineOrders.never')}
              </div>
              <div>
                <span className="font-medium">{t('onlineOrders.lastMenuSync')}:</span>{' '}
                {config.lastMenuSyncAt
                  ? new Date(config.lastMenuSyncAt).toLocaleString()
                  : t('onlineOrders.never')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlatformCard;
