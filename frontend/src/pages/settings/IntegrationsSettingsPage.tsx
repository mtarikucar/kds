import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, Plus, Trash2, Power, PowerOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import {
  useGetIntegrations,
  useDeleteIntegration,
  useToggleIntegration,
} from '@/features/settings/settingsApi';
import { toast } from 'sonner';

const IntegrationsSettingsPage = () => {
  const { t } = useTranslation('settings');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // API hooks
  const { data: integrations, isLoading, refetch } = useGetIntegrations();
  const deleteIntegration = useDeleteIntegration();
  const toggleIntegration = useToggleIntegration();

  const getIntegrationTypeLabel = (type: string) => {
    const types: Record<string, string> = {
  PAYMENT_GATEWAY: t('integrationTypes.PAYMENT_GATEWAY'),
  POS_HARDWARE: t('integrationTypes.POS_HARDWARE'),
  THIRD_PARTY_API: t('integrationTypes.THIRD_PARTY_API'),
  DELIVERY_APP: t('integrationTypes.DELIVERY_APP'),
  ACCOUNTING: t('integrationTypes.ACCOUNTING'),
  CRM: t('integrationTypes.CRM'),
  INVENTORY: t('integrationTypes.INVENTORY'),
  THERMAL_PRINTER: t('integrationTypes.THERMAL_PRINTER'),
  CASH_DRAWER: t('integrationTypes.CASH_DRAWER'),
  RESTAURANT_PAGER: t('integrationTypes.RESTAURANT_PAGER'),
  BARCODE_READER: t('integrationTypes.BARCODE_READER'),
  CUSTOMER_DISPLAY: t('integrationTypes.CUSTOMER_DISPLAY'),
  KITCHEN_DISPLAY: t('integrationTypes.KITCHEN_DISPLAY'),
  SCALE_DEVICE: t('integrationTypes.SCALE_DEVICE'),
    };
    return types[type] || type;
  };

  const handleToggleIntegration = async (id: string, currentStatus: boolean) => {
    try {
      await toggleIntegration.mutateAsync({ id, isEnabled: !currentStatus });
      toast.success(
        !currentStatus
          ? t('integrations.enabledSuccess')
          : t('integrations.disabledSuccess')
      );
      refetch();
    } catch (error) {
  toast.error(t('integrations.toggleFailed'));
    }
  };

  // Plain-integrations branch only — hardware devices have their own delete
  // handler (with the ~/.kds/hardware.json local unregister step) in
  // HardwareDevicesSection now.
  const handleDeleteIntegration = async (id: string) => {
  if (!confirm(t('integrations.confirmDelete'))) return;

    try {
      await deleteIntegration.mutateAsync(id);
      toast.success(t('integrations.deleteSuccess'));
      refetch();
    } catch (error) {
      toast.error(t('integrations.deleteFailed'));
    }
  };

  const regularIntegrations = integrations?.filter(
    (int) =>
      !int.integrationType.includes('PRINTER') &&
      !int.integrationType.includes('DRAWER') &&
      !int.integrationType.includes('PAGER') &&
      !int.integrationType.includes('BARCODE') &&
      !int.integrationType.includes('DISPLAY') &&
      !int.integrationType.includes('SCALE')
  );

  return (
    <div className="h-full p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold text-slate-900">{t('integrationsLabel')}</h1>
            <p className="text-slate-500 mt-1">
              {t('integrationsDescription')}
            </p>
          </div>
        </div>
      </div>

      {/* Other Integrations */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t('integrations.otherTitle')}</CardTitle>
            <Button
              variant="outline"
              onClick={() => toast.info(t('integrations.comingSoon'))}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('integrations.addIntegration')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-slate-500">{t('integrations.loading')}</p>
            </div>
          ) : regularIntegrations && regularIntegrations.length === 0 ? (
            <div className="text-center py-12">
              <Plug className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-500 mb-4">{t('integrations.none')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {regularIntegrations?.map((integration) => (
                <div
                  key={integration.id}
                  className="flex items-center justify-between px-6 py-5 border border-slate-200/60 rounded-xl hover:shadow-md transition-shadow duration-200"
                >
                  {(() => {
                    // HONEST status. Credential integrations have no live
                    // adapter consuming them yet, so the backend reports
                    // CONFIGURED_NOT_ACTIVE even when toggled on — never show
                    // such a row as "Active".
                    const notWired =
                      integration.activationState === 'CONFIGURED_NOT_ACTIVE';
                    const isLive = !notWired && integration.isEnabled;
                    return (
                  <div className="flex items-center gap-4 flex-1">
                    <div
                      className={`p-3 rounded-lg ${
                        isLive ? 'bg-green-100' : 'bg-slate-100'
                      }`}
                    >
                      <Plug
                        className={`h-5 w-5 ${
                          isLive ? 'text-green-600' : 'text-slate-400'
                        }`}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900">
                          {integration.provider}
                        </h3>
                        {notWired ? (
                          <Badge variant="warning">{t('integrations.configuredNotActive')}</Badge>
                        ) : integration.isEnabled ? (
                          <Badge variant="success">{t('common:statuses.active')}</Badge>
                        ) : (
                          <Badge variant="default">{t('common:statuses.inactive')}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        {getIntegrationTypeLabel(integration.integrationType)} •{' '}
                        {integration.provider}
                        {/* Only show "last synced" when a real sync exists.
                            Credential integrations never sync, so suppress it
                            instead of implying one happened. */}
                        {!notWired && integration.lastSyncedAt && (
                            <> • {t('integrations.lastSynced', { date: new Date(integration.lastSyncedAt).toLocaleString() })}</>
                          )}
                      </p>
                      {notWired && (
                        <p className="text-xs text-amber-600 mt-1">
                          {t('integrations.notWiredHint')}
                        </p>
                      )}
                    </div>
                  </div>
                    );
                  })()}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleToggleIntegration(integration.id, integration.isEnabled)
                      }
                    >
                      {integration.isEnabled ? (
                        <>
                          <PowerOff className="h-4 w-4 mr-1" />
                          {t('common:buttons.disable')}
                        </>
                      ) : (
                        <>
                          <Power className="h-4 w-4 mr-1" />
                          {t('common:buttons.enable')}
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteIntegration(integration.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default IntegrationsSettingsPage;
