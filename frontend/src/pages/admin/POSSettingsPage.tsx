import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useGetPosSettings, useUpdatePosSettings } from '../../features/pos/posApi';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Settings } from 'lucide-react';

const POSSettingsPage = () => {
  const { data: posSettings, isLoading } = useGetPosSettings();
  const { mutate: updateSettings, isPending: isUpdating } = useUpdatePosSettings();

  const [enableTablelessMode, setEnableTablelessMode] = useState(false);
  const [enableTwoStepCheckout, setEnableTwoStepCheckout] = useState(false);

  // Load settings when data arrives
  useEffect(() => {
    if (posSettings) {
      setEnableTablelessMode(posSettings.enableTablelessMode);
      setEnableTwoStepCheckout(posSettings.enableTwoStepCheckout);
    }
  }, [posSettings]);

  const handleSave = () => {
    updateSettings(
      {
        enableTablelessMode,
        enableTwoStepCheckout,
      },
      {
        onSuccess: () => {
          toast.success('POS settings updated successfully');
        },
        onError: (error: any) => {
          toast.error(error.response?.data?.message || 'Failed to update settings');
        },
      }
    );
  };

  const hasChanges =
    posSettings &&
    (enableTablelessMode !== posSettings.enableTablelessMode ||
      enableTwoStepCheckout !== posSettings.enableTwoStepCheckout);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">Loading POS settings...</p>
      </div>
    );
  }

  return (
    <div className="h-full p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="h-8 w-8" />
          POS Settings
        </h1>
        <p className="text-gray-600 mt-2">
          Configure how your Point of Sale system operates
        </p>
      </div>

      <div className="max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Operation Modes</CardTitle>
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
                      Enable Tableless Mode
                    </p>
                    <p className="text-sm text-gray-600">
                      Allow orders without table selection. Perfect for self-service,
                      takeaway, or counter-service restaurants. The table selection
                      panel will be hidden when enabled.
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
                        Enable Two-Step Checkout
                      </p>
                      <p className="text-sm text-gray-600">
                        Separate order creation and payment steps. Shows two buttons:
                        "Create Order" and "Proceed to Payment". Useful when you want
                        to send orders to kitchen before collecting payment.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> Changes will take effect immediately in the POS
                system. Make sure staff are informed of any operational changes.
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
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Settings Preview */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Current Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-600">Tableless Mode:</dt>
                <dd className="font-semibold">
                  {enableTablelessMode ? (
                    <span className="text-green-600">Enabled</span>
                  ) : (
                    <span className="text-gray-400">Disabled</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Two-Step Checkout:</dt>
                <dd className="font-semibold">
                  {enableTwoStepCheckout ? (
                    <span className="text-green-600">Enabled</span>
                  ) : (
                    <span className="text-gray-400">Disabled</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Order Type (tableless):</dt>
                <dd className="font-mono text-sm">
                  {enableTablelessMode ? 'TAKEAWAY' : 'DINE_IN'}
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
