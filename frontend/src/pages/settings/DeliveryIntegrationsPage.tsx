import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, RefreshCw, AlertCircle, CheckCircle, Settings2, Package, Store } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import {
  useGetDeliveryPlatforms,
  useTogglePlatform,
  PlatformType,
  PlatformLabels,
  PlatformColors,
  DeliveryPlatform,
} from '../../features/integrations/deliveryApi';
import { toast } from 'sonner';
import PlatformConfigModal from '../../components/integrations/PlatformConfigModal';
import ProductMappingPanel from '../../components/integrations/ProductMappingPanel';
import PlatformOrdersPanel from '../../components/integrations/PlatformOrdersPanel';

const DeliveryIntegrationsPage = () => {
  const { t } = useTranslation('settings');
  const { data, isLoading, refetch } = useGetDeliveryPlatforms();
  const togglePlatform = useTogglePlatform();

  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('platforms');

  const platforms = data?.platforms || [];

  const handleToggle = async (platform: DeliveryPlatform) => {
    if (!platform.isConfigured && !platform.isEnabled) {
      setSelectedPlatform(platform.type as PlatformType);
      setConfigModalOpen(true);
      return;
    }

    try {
      await togglePlatform.mutateAsync({
        platformType: platform.type as PlatformType,
        isEnabled: !platform.isEnabled,
      });
      toast.success(
        platform.isEnabled
          ? t('delivery.disabledSuccess', { platform: platform.name })
          : t('delivery.enabledSuccess', { platform: platform.name })
      );
    } catch {
      toast.error(t('delivery.toggleFailed'));
    }
  };

  const handleConfigure = (platformType: PlatformType) => {
    setSelectedPlatform(platformType);
    setConfigModalOpen(true);
  };

  const getPlatformIcon = (type: string) => {
    // Return a colored circle with platform initial
    const color = PlatformColors[type as PlatformType] || '#666';
    return (
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg"
        style={{ backgroundColor: color }}
      >
        {type.charAt(0)}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="h-7 w-7" />
            {t('delivery.title')}
          </h1>
          <p className="text-gray-600 mt-1">{t('delivery.description')}</p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('delivery.refresh')}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="platforms" className="flex items-center gap-2">
            <Store className="h-4 w-4" />
            {t('delivery.platforms')}
          </TabsTrigger>
          <TabsTrigger value="mappings" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            {t('delivery.mappings')}
          </TabsTrigger>
          <TabsTrigger value="orders" className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            {t('delivery.orders')}
          </TabsTrigger>
        </TabsList>

        {/* Platforms Tab */}
        <TabsContent value="platforms" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {platforms.map((platform) => (
              <Card key={platform.type} className="relative overflow-hidden">
                <div
                  className="absolute top-0 left-0 w-1 h-full"
                  style={{ backgroundColor: platform.color }}
                />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {getPlatformIcon(platform.type)}
                      <div>
                        <CardTitle className="text-lg">{platform.name}</CardTitle>
                        <CardDescription className="text-sm">
                          {platform.isConfigured
                            ? t('delivery.configured')
                            : t('delivery.notConfigured')}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={platform.isEnabled ? 'success' : 'default'}
                    >
                      {platform.isEnabled ? t('delivery.enabled') : t('delivery.disabled')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {platform.lastSyncedAt && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      {t('delivery.lastSync')}: {new Date(platform.lastSyncedAt).toLocaleString()}
                    </div>
                  )}
                  {!platform.isConfigured && (
                    <div className="flex items-center gap-2 text-sm text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                      {t('delivery.needsConfiguration')}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConfigure(platform.type as PlatformType)}
                      className="flex-1"
                    >
                      <Settings2 className="h-4 w-4 mr-1" />
                      {t('delivery.configure')}
                    </Button>
                    <Button
                      variant={platform.isEnabled ? 'danger' : 'primary'}
                      size="sm"
                      onClick={() => handleToggle(platform)}
                      disabled={togglePlatform.isPending}
                      className="flex-1"
                    >
                      {platform.isEnabled ? t('delivery.disable') : t('delivery.enable')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Onboarding Guide */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t('delivery.onboardingTitle')}</CardTitle>
              <CardDescription>{t('delivery.onboardingDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold text-orange-600 mb-2">Trendyol Go</h4>
                  <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                    <li>partner.trendyol.com adresine gidin</li>
                    <li>API Entegrasyonu bolumune gidin</li>
                    <li>API Key ve Secret alın</li>
                    <li>Buraya girin ve test edin</li>
                  </ol>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold text-pink-600 mb-2">Yemeksepeti</h4>
                  <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                    <li>partner.yemeksepeti.com'a gidin</li>
                    <li>Entegrasyon Basvurusu yapın</li>
                    <li>OAuth Client ID/Secret alın</li>
                    <li>Webhook URL'lerini ayarlayın</li>
                  </ol>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold text-purple-600 mb-2">Getir</h4>
                  <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                    <li>getir.com/is-ortakligi'na basvurun</li>
                    <li>Partner onboarding surecini tamamlayın</li>
                    <li>Sandbox test zorunludur</li>
                    <li>Production anahtarlarını alın</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Product Mappings Tab */}
        <TabsContent value="mappings" className="mt-6">
          <ProductMappingPanel />
        </TabsContent>

        {/* Orders Tab */}
        <TabsContent value="orders" className="mt-6">
          <PlatformOrdersPanel />
        </TabsContent>
      </Tabs>

      {/* Configuration Modal */}
      {selectedPlatform && (
        <PlatformConfigModal
          open={configModalOpen}
          onClose={() => {
            setConfigModalOpen(false);
            setSelectedPlatform(null);
          }}
          platformType={selectedPlatform}
          onSuccess={() => {
            refetch();
            setConfigModalOpen(false);
            setSelectedPlatform(null);
          }}
        />
      )}
    </div>
  );
};

export default DeliveryIntegrationsPage;
