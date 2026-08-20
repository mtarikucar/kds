import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TestTube,
  Store,
  ChevronDown,
  ChevronUp,
  Save,
  Loader2,
  FlaskConical,
  Send,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import PlatformStatusBadge from './PlatformStatusBadge';
import PlatformCredentialsForm from './PlatformCredentialsForm';
import Badge from '../ui/Badge';
import type { DeliveryPlatformConfig } from '../../types';
import { PLATFORM_AVAILABILITY } from '../../types';
import {
  useUpdatePlatformConfig,
  useCreatePlatformConfig,
  useTestPlatformConnection,
  useToggleRestaurant,
  useSendTestOrder,
  useSyncMenu,
} from '../../features/delivery-platforms/deliveryPlatformsApi';
import { useListBranches } from '../../features/branches/branchesApi';

type PlatformEnvironment = 'production' | 'sandbox';

// Required credential fields per platform
const REQUIRED_CREDENTIALS: Record<string, string[]> = {
  GETIR: ['appSecretKey', 'restaurantSecretKey'],
  YEMEKSEPETI: ['clientId', 'clientSecret'],
  TRENDYOL: ['username', 'password'],
  MIGROS: ['apiKey'],
};

// Which platforms have a REAL, distinct sandbox host. Mirrors the backend
// adapters: only Trendyol publishes a stage/sandbox gateway. Getir,
// Yemeksepeti and Migros have no documented test host, so their adapter's
// sandbox base URL defaults to PRODUCTION — selecting "sandbox" there would
// silently hit the live API (test-connection / sync-menu / toggle-restaurant /
// test-order all REFUSE on the backend via SANDBOX-FAIL-CLOSED). We must not
// present sandbox as functional for those: disable the toggle with a tooltip.
const PLATFORMS_WITH_REAL_SANDBOX = new Set<string>(['TRENDYOL']);

function platformHasRealSandbox(platform: string): boolean {
  return PLATFORMS_WITH_REAL_SANDBOX.has(platform);
}

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
}

// Descriptions resolve through i18n: `onlineOrders.platformDescriptions.<key>`
// (the brand names themselves stay untranslated).
const PLATFORM_INFO: Record<string, PlatformInfo> = {
  GETIR: {
    name: 'Getir Yemek',
    platform: 'GETIR',
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
  },
  YEMEKSEPETI: {
    name: 'Yemeksepeti',
    platform: 'YEMEKSEPETI',
    color: 'text-pink-700',
    bgColor: 'bg-pink-50',
  },
  TRENDYOL: {
    name: 'Trendyol Yemek',
    platform: 'TRENDYOL',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
  },
  MIGROS: {
    name: 'Migros Yemek',
    platform: 'MIGROS',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
  },
  // Semt has no adapter yet. It gets an entry here — and NOT in
  // REQUIRED_CREDENTIALS or PLATFORMS_WITH_REAL_SANDBOX — because the card
  // still renders and `info.bgColor` would otherwise throw.
  SEMT: {
    name: 'Semt',
    platform: 'SEMT',
    color: 'text-sky-700',
    bgColor: 'bg-sky-50',
  },
};

interface PlatformCardProps {
  platform: string;
  config?: DeliveryPlatformConfig;
}

const PlatformCard = ({ platform, config }: PlatformCardProps) => {
  const { t } = useTranslation('settings');
  const info = PLATFORM_INFO[platform];
  // A coming-soon platform is a shop-window entry, not a connectable one: the
  // backend answers 400 on POST /delivery-platforms/configs and 503 from the
  // adapter factory. The UI must not offer an action that can only fail.
  const comingSoon = PLATFORM_AVAILABILITY[platform] === 'coming_soon';
  const [expanded, setExpanded] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, any>>(
    (config?.credentials as Record<string, any>) || {},
  );
  const [remoteRestaurantId, setRemoteRestaurantId] = useState(
    config?.remoteRestaurantId || '',
  );
  const [autoAccept, setAutoAccept] = useState(config?.autoAccept ?? true);
  const [branchId, setBranchId] = useState<string | null>(
    config?.branchId ?? null,
  );
  const [environment, setEnvironment] = useState<PlatformEnvironment>(
    config?.environment ?? 'production',
  );
  const [hasChanges, setHasChanges] = useState(false);
  // The backend strips credentials on read, so we never have the live secrets
  // in local state for a saved config. Track whether the operator has actually
  // typed into a credential field this session; only THEN do we send a
  // credentials payload (otherwise we'd overwrite the stored secrets with the
  // empty local state). Branch/environment/other edits never set this.
  const [credentialsDirty, setCredentialsDirty] = useState(false);

  const updateConfig = useUpdatePlatformConfig();
  const createConfig = useCreatePlatformConfig();
  const testConnection = useTestPlatformConnection();
  const toggleRestaurant = useToggleRestaurant();
  const sendTestOrder = useSendTestOrder();
  const syncMenu = useSyncMenu();
  const { data: branches } = useListBranches();

  // Credentials are "configured" if the server says so (hasCredentials flag on
  // a saved config) OR the operator has just filled in a complete, valid set
  // locally (covers the not-yet-saved / re-rotating case). Never derive this
  // from local state alone — the server strips secrets, so local state is
  // empty for an already-configured platform after a reload.
  const hasCredentials =
    config?.hasCredentials === true ||
    checkHasCredentials(platform, credentials);
  const isSandbox = environment === 'sandbox';
  // This platform exposes a real, distinct sandbox endpoint. When false,
  // selecting "sandbox" would resolve to PRODUCTION on the backend (and the
  // backend now REFUSES the live actions), so we disable sandbox in the UI.
  const hasRealSandbox = platformHasRealSandbox(platform);

  const handleToggleEnabled = async () => {
    if (comingSoon) return;
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
        branchId,
        environment,
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
    if (comingSoon) return;
    if (!config) {
      await createConfig.mutateAsync({
        platform,
        credentials,
        remoteRestaurantId,
        autoAccept,
        branchId,
        environment,
      });
    } else {
      // Only send credentials when the operator actually edited a credential
      // field this session. The GET configs endpoint strips secrets, so our
      // local `credentials` is empty for an already-saved platform — sending
      // it would wipe the stored encrypted credentials on the backend.
      // Branch/environment/auto-accept changes save without re-entry.
      await updateConfig.mutateAsync({
        platform,
        ...(credentialsDirty ? { credentials } : {}),
        remoteRestaurantId,
        autoAccept,
        branchId,
        environment,
      });
    }
    setHasChanges(false);
    setCredentialsDirty(false);
  };

  const handleCredentialsChange = (
    creds: Record<string, any>,
    remoteId: string,
  ) => {
    // PlatformCredentialsForm bundles credential edits AND the (non-secret)
    // remote-restaurant-id edit through this one callback. Only flag the
    // credentials payload dirty when a credential field actually changed —
    // editing just the remote restaurant id must NOT force credential
    // re-entry (and must not wipe stored secrets on save).
    const credentialsChanged =
      JSON.stringify(creds) !== JSON.stringify(credentials);
    setCredentials(creds);
    setRemoteRestaurantId(remoteId);
    if (credentialsChanged) {
      setCredentialsDirty(true);
    }
    setHasChanges(true);
  };

  const handleTestConnection = async () => {
    if (comingSoon) return;
    if (!hasCredentials) {
      toast.error(t('onlineOrders.fillCredentialsFirst'));
      return;
    }
    // The probe validates the credentials STORED on the backend (GET strips
    // secrets and the test endpoint takes no body) — with unsaved edits it
    // would test the PREVIOUS values and report a misleading result. Save
    // first, then test (mirrors AccountingSettingsPage's flush-before-test).
    if (hasChanges || credentialsDirty) {
      try {
        await handleSave();
      } catch {
        // The save mutation already toasts its own failure; don't probe with
        // half-saved state.
        return;
      }
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

  const handleBranchChange = (value: string) => {
    setBranchId(value === '' ? null : value);
    setHasChanges(true);
  };

  const handleEnvironmentChange = (next: PlatformEnvironment) => {
    // Guard: never let the operator select sandbox on a platform that has no
    // real sandbox host — it would resolve to prod and every live/test action
    // is refused by the backend. The button is also disabled, this is
    // belt-and-braces.
    if (next === 'sandbox' && !hasRealSandbox) {
      toast.error(t('onlineOrders.environment.noSandbox'));
      return;
    }
    setEnvironment(next);
    setHasChanges(true);
  };

  const handleSendTestOrder = () => {
    if (!config) return;
    if (!isSandbox) {
      toast.error(t('onlineOrders.testOrderSandboxOnly'));
      return;
    }
    sendTestOrder.mutate(platform);
  };

  const handleSyncMenu = () => {
    if (!config) return;
    syncMenu.mutate(platform);
  };

  const isSaving =
    updateConfig.isPending || createConfig.isPending;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className={`flex items-center justify-between p-4 transition-colors ${
          comingSoon ? '' : 'cursor-pointer hover:bg-slate-50'
        }`}
        data-availability={comingSoon ? 'coming_soon' : 'available'}
        onClick={() => {
          if (comingSoon) return;
          setExpanded(!expanded);
        }}
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
              {comingSoon && (
                <Badge variant="default">
                  {t('onlineOrders.availability.comingSoon')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {t(`onlineOrders.platformDescriptions.${platform}`)}
            </p>
            {comingSoon && (
              <p className="text-xs text-sky-700">
                {t('onlineOrders.availability.comingSoonNote')}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Enable/Disable Toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleEnabled();
            }}
            disabled={comingSoon}
            aria-disabled={comingSoon}
            aria-label={
              config?.isEnabled
                ? t('onlineOrders.aria.disablePlatform', { name: info.name })
                : t('onlineOrders.aria.enablePlatform', { name: info.name })
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config?.isEnabled ? 'bg-primary-600' : 'bg-slate-300'
            } ${comingSoon ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                config?.isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>

          {!comingSoon &&
            (expanded ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            ))}
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
              aria-label={
                autoAccept
                  ? t('onlineOrders.aria.disableAutoAccept', { name: info.name })
                  : t('onlineOrders.aria.enableAutoAccept', { name: info.name })
              }
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

          {/* Branch selector — which branch receives this platform's orders */}
          <div className="py-2">
            <label
              htmlFor={`branch-${platform}`}
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              {t('onlineOrders.branch')}
            </label>
            <select
              id={`branch-${platform}`}
              value={branchId ?? ''}
              onChange={(e) => handleBranchChange(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">{t('onlineOrders.branchDefault')}</option>
              {(branches ?? [])
                .filter((b) => b.status === 'active')
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {t('onlineOrders.branchDescription')}
            </p>
          </div>

          {/* Environment (sandbox) toggle */}
          <div className="py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FlaskConical className="h-4 w-4 text-slate-400" />
                <p className="text-sm font-medium text-slate-700">
                  {t('onlineOrders.environment.label')}
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                {(['production', 'sandbox'] as const).map((env) => {
                  // Disable the sandbox option when the platform has no real
                  // sandbox endpoint — selecting it would hit prod and the
                  // backend refuses every live/test action.
                  const isSandboxOption = env === 'sandbox';
                  const disabled = isSandboxOption && !hasRealSandbox;
                  return (
                    <button
                      key={env}
                      type="button"
                      onClick={() => handleEnvironmentChange(env)}
                      aria-pressed={environment === env}
                      disabled={disabled}
                      title={
                        disabled
                          ? t('onlineOrders.environment.noSandbox')
                          : undefined
                      }
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        disabled
                          ? 'bg-slate-50 text-slate-300 cursor-not-allowed line-through'
                          : environment === env
                            ? env === 'sandbox'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-primary-100 text-primary-700'
                            : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {isSandboxOption
                        ? t('onlineOrders.environment.sandbox')
                        : t('onlineOrders.environment.production')}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* No real sandbox: explain why it's unavailable (don't present it
                as functional). */}
            {!hasRealSandbox && (
              <div className="mt-2 flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <AlertTriangle className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-500">
                  {t('onlineOrders.environment.noSandbox')}
                </p>
              </div>
            )}
            {hasRealSandbox && isSandbox && (
              <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  {t('onlineOrders.environment.sandboxWarning')}
                </p>
              </div>
            )}
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
              disabled={testConnection.isPending || isSaving || !config}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {testConnection.isPending || isSaving ? (
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

            {/* Menu sync */}
            <button
              onClick={handleSyncMenu}
              disabled={syncMenu.isPending || !config}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {syncMenu.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t('onlineOrders.syncMenu')}
            </button>

            {/* Send test order — sandbox-only "we've never tested" affordance */}
            <button
              onClick={handleSendTestOrder}
              disabled={sendTestOrder.isPending || !config || !isSandbox}
              title={
                !isSandbox ? t('onlineOrders.testOrderSandboxOnly') : undefined
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendTestOrder.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t('onlineOrders.sendTestOrder')}
            </button>
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
