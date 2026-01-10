import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useGetPosSettings, useUpdatePosSettings } from '../../features/pos/posApi';
import {
  useGetTenantSettings,
  useUpdateTenantSettings,
  SUPPORTED_CURRENCIES,
} from '../../hooks/useCurrency';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import ReportSettings from '../../components/settings/ReportSettings';
import LocationSettings from '../../components/settings/LocationSettings';
const POSSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: posSettings, isLoading } = useGetPosSettings();
  const { mutate: updateSettings, isPending: isUpdating } = useUpdatePosSettings();
  const { data: tenantSettings, isLoading: isLoadingTenant } = useGetTenantSettings();
  const { mutate: updateTenantSettings, isPending: isUpdatingTenant } =
    useUpdateTenantSettings();

  const [enableTablelessMode, setEnableTablelessMode] = useState(false);
  const [enableTwoStepCheckout, setEnableTwoStepCheckout] = useState(false);
  const [showProductImages, setShowProductImages] = useState(true);
  const [enableCustomerOrdering, setEnableCustomerOrdering] = useState(true);
  const [currency, setCurrency] = useState('TRY');

  // Load settings when data arrives
  useEffect(() => {
    if (posSettings) {
      setEnableTablelessMode(posSettings.enableTablelessMode);
      setEnableTwoStepCheckout(posSettings.enableTwoStepCheckout);
      setShowProductImages(posSettings.showProductImages);
      setEnableCustomerOrdering(posSettings.enableCustomerOrdering);
    }
  }, [posSettings]);

  // Load tenant settings when data arrives
  useEffect(() => {
    if (tenantSettings) {
      setCurrency(tenantSettings.currency || 'TRY');
    }
  }, [tenantSettings]);

  const handleSave = () => {
    updateSettings(
      {
        enableTablelessMode,
        enableTwoStepCheckout,
        showProductImages,
        enableCustomerOrdering,
      },
      {
        onSuccess: () => {
          toast.success(t('settingsSaved'));
        },
        onError: (error: any) => {
          toast.error(error.response?.data?.message || t('settingsFailed'));
        },
      }
    );
  };

  const handleSaveCurrency = () => {
    updateTenantSettings(
      { currency },
      {
        onSuccess: () => {
          toast.success(t('settingsSaved'));
        },
        onError: (error: any) => {
          toast.error(error.response?.data?.message || t('settingsFailed'));
        },
      }
    );
  };

  const hasChanges =
    posSettings &&
    (enableTablelessMode !== posSettings.enableTablelessMode ||
      enableTwoStepCheckout !== posSettings.enableTwoStepCheckout ||
      showProductImages !== posSettings.showProductImages ||
      enableCustomerOrdering !== posSettings.enableCustomerOrdering);

  const hasCurrencyChanges =
    tenantSettings && currency !== tenantSettings.currency;

  if (isLoading || isLoadingTenant) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">{t('posSettings.loading')}</p>
      </div>
    );
  }

  return (
    <div className="h-full p-4 md:p-6">
      <div className="mb-4 md:mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">{t('posSettings.title')}</h1>
        <p className="text-sm md:text-base text-gray-600 mt-1">
          {t('posSettings.description')}
        </p>
      </div>

      <div className="max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>{t('operationModes')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Tableless Mode */}
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableTablelessMode}
                    onChange={(e) => setEnableTablelessMode(e.target.checked)}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div>
                    <p className="font-semibold text-gray-900">
                      {t('enableTablelessMode')}
                    </p>
                    <p className="text-sm text-gray-600">
                      {t('tablelessModeDescription')}
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="border-t pt-6">
              {/* Two-Step Checkout */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableTwoStepCheckout}
                      onChange={(e) => {
                        const newValue = e.target.checked;

                        // Prevent disabling two-step checkout if customer ordering is active
                        if (!newValue && enableCustomerOrdering) {
                          toast.error(t('twoStepCheckout.cannotDisableWithCustomerOrdering'));
                          return;
                        }

                        setEnableTwoStepCheckout(newValue);
                      }}
                      className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <div>
                      <p className="font-semibold text-gray-900">
                        {t('twoStepCheckout.title')}
                      </p>
                      <p className="text-sm text-gray-600">
                        {t('twoStepCheckout.description')}
                      </p>
                      {enableCustomerOrdering && (
                        <p className="text-xs text-orange-600 mt-1">
                          ⚠️ {t('twoStepCheckout.requiredForQRMenu')}
                        </p>
                      )}
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              {/* Show Product Images */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showProductImages}
                      onChange={(e) => setShowProductImages(e.target.checked)}
                      className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <div>
                      <p className="font-semibold text-gray-900">
                        {t('showProductImages.title')}
                      </p>
                      <p className="text-sm text-gray-600">
                        {t('showProductImages.description')}
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* QR Menu Customer Ordering Section */}
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">QR Menu Settings</h3>

              {/* Enable Customer Ordering */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableCustomerOrdering}
                      onChange={(e) => {
                        const newValue = e.target.checked;

                        // Auto-enable two-stage payment when enabling customer ordering
                        if (newValue && !enableTwoStepCheckout) {
                          setEnableTwoStepCheckout(true);
                          toast.info(t('twoStepCheckout.autoEnabled'));
                        }

                        setEnableCustomerOrdering(newValue);
                      }}
                      className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <div>
                      <p className="font-semibold text-gray-900">
                        {t('enableCustomerOrdering.title')}
                      </p>
                      <p className="text-sm text-gray-600">
                        {t('enableCustomerOrdering.description')}
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>{t('info.noteLabel')}</strong> {t('info.noteBody')}
              </p>
            </div>

            {/* Save button */}
            <div className="flex justify-end pt-4">
              <Button
                variant="primary"
                size="lg"
                onClick={handleSave}
                isLoading={isUpdating}
                disabled={!hasChanges}
              >
                {t('saveChanges')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Currency Settings */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t('currencySettings.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">{t('currencySettings.description')}</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('currencySettings.selectCurrency')}
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {SUPPORTED_CURRENCIES.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.symbol} - {curr.name} ({curr.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                variant="primary"
                size="lg"
                onClick={handleSaveCurrency}
                isLoading={isUpdatingTenant}
                disabled={!hasCurrencyChanges}
              >
                {t('saveChanges')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Settings Preview */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t('preview.currentConfiguration')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-600">{t('preview.tablelessMode')}:</dt>
                <dd className="font-semibold">
                  {enableTablelessMode ? (
                    <span className="text-green-600">{t('preview.enabled')}</span>
                  ) : (
                    <span className="text-gray-400">{t('preview.disabled')}</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">{t('preview.twoStepCheckout')}:</dt>
                <dd className="font-semibold">
                  {enableTwoStepCheckout ? (
                    <span className="text-green-600">{t('preview.enabled')}</span>
                  ) : (
                    <span className="text-gray-400">{t('preview.disabled')}</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">{t('preview.orderTypeTableless')}:</dt>
                <dd className="font-mono text-sm">
                  {enableTablelessMode ? t('orderTypes.takeaway') : t('orderTypes.dineIn')}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">{t('preview.productImages')}:</dt>
                <dd className="font-semibold">
                  {showProductImages ? (
                    <span className="text-green-600">{t('preview.enabled')}</span>
                  ) : (
                    <span className="text-gray-400">{t('preview.disabled')}</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">{t('preview.customerOrdering')}:</dt>
                <dd className="font-semibold">
                  {enableCustomerOrdering ? (
                    <span className="text-green-600">{t('preview.enabled')}</span>
                  ) : (
                    <span className="text-gray-400">{t('preview.disabled')}</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">{t('preview.currency')}:</dt>
                <dd className="font-semibold">
                  {SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.symbol || currency} (
                  {currency})
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Report Settings */}
        <div className="mt-6">
          <ReportSettings />
        </div>

        {/* Location Settings */}
        <div className="mt-6">
          <LocationSettings />
        </div>
      </div>
    </div>
  );
};

export default POSSettingsPage;
