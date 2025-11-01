import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useGetPosSettings, useUpdatePosSettings } from '../../features/pos/posApi';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
const POSSettingsPage = () => {
  const { t } = useTranslation('settings');
  const { data: posSettings, isLoading } = useGetPosSettings();
  const { mutate: updateSettings, isPending: isUpdating } = useUpdatePosSettings();

  const [enableTablelessMode, setEnableTablelessMode] = useState(false);
  const [enableTwoStepCheckout, setEnableTwoStepCheckout] = useState(false);
  const [showProductImages, setShowProductImages] = useState(true);
  const [enableCustomerOrdering, setEnableCustomerOrdering] = useState(true);

  // Load settings when data arrives
  useEffect(() => {
    if (posSettings) {
      setEnableTablelessMode(posSettings.enableTablelessMode);
      setEnableTwoStepCheckout(posSettings.enableTwoStepCheckout);
      setShowProductImages(posSettings.showProductImages);
      setEnableCustomerOrdering(posSettings.enableCustomerOrdering);
    }
  }, [posSettings]);

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

  const hasChanges =
    posSettings &&
    (enableTablelessMode !== posSettings.enableTablelessMode ||
      enableTwoStepCheckout !== posSettings.enableTwoStepCheckout ||
      showProductImages !== posSettings.showProductImages ||
      enableCustomerOrdering !== posSettings.enableCustomerOrdering);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">{t('posSettings.loading')}</p>
      </div>
    );
  }

  return (
    <div className="h-full p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('posSettings.title')}</h1>
        <p className="text-gray-600 mt-1">
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
                      onChange={(e) => setEnableTwoStepCheckout(e.target.checked)}
                      className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <div>
                      <p className="font-semibold text-gray-900">
                        {t('twoStepCheckout.title')}
                      </p>
                      <p className="text-sm text-gray-600">
                        {t('twoStepCheckout.description')}
                      </p>
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
                      onChange={(e) => setEnableCustomerOrdering(e.target.checked)}
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
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default POSSettingsPage;
