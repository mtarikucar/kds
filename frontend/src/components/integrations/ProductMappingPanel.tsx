import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw, Link2, Check, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import Badge from '../ui/Badge';
import { Input } from '../ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog';
import {
  useGetDeliveryPlatforms,
  useGetProductMappings,
  useGetUnmappedProducts,
  useCreateProductMapping,
  useDeleteProductMapping,
  useTriggerMenuSync,
  PlatformType,
  PlatformLabels,
  PlatformColors,
  ProductMapping,
  UnmappedProduct,
} from '../../features/integrations/deliveryApi';
import { toast } from 'sonner';

const ProductMappingPanel = () => {
  const { t } = useTranslation('settings');
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<UnmappedProduct | null>(null);
  const [platformProductId, setPlatformProductId] = useState('');

  const { data: platformsData } = useGetDeliveryPlatforms();
  const platforms = platformsData?.platforms?.filter(p => p.isConfigured) || [];

  const { data: mappingsData, isLoading: mappingsLoading, refetch: refetchMappings } = useGetProductMappings(
    selectedPlatform!,
    { limit: 100 }
  );
  const { data: unmappedData, refetch: refetchUnmapped } = useGetUnmappedProducts(selectedPlatform!);

  const createMapping = useCreateProductMapping();
  const deleteMapping = useDeleteProductMapping();
  const triggerSync = useTriggerMenuSync();

  const mappings = mappingsData?.mappings || [];
  const unmappedProducts = unmappedData?.products || [];

  const handleCreateMapping = async () => {
    if (!selectedPlatform || !selectedProduct || !platformProductId) return;

    try {
      await createMapping.mutateAsync({
        platformType: selectedPlatform,
        data: {
          productId: selectedProduct.id,
          platformProductId,
        },
      });
      toast.success(t('delivery.mappingCreated'));
      setShowAddModal(false);
      setSelectedProduct(null);
      setPlatformProductId('');
      refetchMappings();
      refetchUnmapped();
    } catch {
      toast.error(t('delivery.mappingFailed'));
    }
  };

  const handleDeleteMapping = async (mapping: ProductMapping) => {
    if (!selectedPlatform) return;

    try {
      await deleteMapping.mutateAsync({
        platformType: selectedPlatform,
        id: mapping.id,
      });
      toast.success(t('delivery.mappingDeleted'));
      refetchMappings();
      refetchUnmapped();
    } catch {
      toast.error(t('delivery.deleteFailed'));
    }
  };

  const handleSync = async () => {
    if (!selectedPlatform) return;

    try {
      const result = await triggerSync.mutateAsync({ platformType: selectedPlatform });
      toast.success(t('delivery.syncSuccess', { count: result.synced }));
    } catch {
      toast.error(t('delivery.syncFailed'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Platform Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            {t('delivery.productMappings')}
          </CardTitle>
          <CardDescription>{t('delivery.productMappingsDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select
              value={selectedPlatform || ''}
              onValueChange={(value) => setSelectedPlatform(value as PlatformType)}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder={t('delivery.selectPlatform')} />
              </SelectTrigger>
              <SelectContent>
                {platforms.map((platform) => (
                  <SelectItem key={platform.type} value={platform.type}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: platform.color }}
                      />
                      {platform.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedPlatform && (
              <>
                <Button variant="outline" onClick={() => setShowAddModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('delivery.addMapping')}
                </Button>
                <Button variant="outline" onClick={handleSync} disabled={triggerSync.isPending}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${triggerSync.isPending ? 'animate-spin' : ''}`} />
                  {t('delivery.syncAll')}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Mappings Table */}
      {selectedPlatform && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {t('delivery.mappedProducts')} ({mappings.length})
              </CardTitle>
              <Badge variant="info">
                {unmappedProducts.length} {t('delivery.unmapped')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {mappingsLoading ? (
              <div className="text-center py-8 text-gray-500">
                {t('common.loading')}...
              </div>
            ) : mappings.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {t('delivery.noMappings')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-gray-600">
                        {t('delivery.product')}
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">
                        {t('delivery.platformId')}
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">
                        {t('delivery.price')}
                      </th>
                      <th className="text-center py-3 px-4 font-medium text-gray-600">
                        {t('delivery.syncPrice')}
                      </th>
                      <th className="text-center py-3 px-4 font-medium text-gray-600">
                        {t('delivery.syncAvailability')}
                      </th>
                      <th className="text-right py-3 px-4 font-medium text-gray-600">
                        {t('common.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((mapping) => (
                      <tr key={mapping.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div>
                            <div className="font-medium">{mapping.product.name}</div>
                            <div className="text-sm text-gray-500">
                              {mapping.product.category?.name}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-sm">
                          {mapping.platformProductId}
                        </td>
                        <td className="py-3 px-4">
                          {mapping.product.price.toFixed(2)} TL
                          {mapping.priceMultiplier !== 1 && (
                            <span className="text-xs text-gray-500 ml-1">
                              (x{mapping.priceMultiplier})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {mapping.syncPrice ? (
                            <Check className="h-5 w-5 text-green-500 mx-auto" />
                          ) : (
                            <X className="h-5 w-5 text-gray-300 mx-auto" />
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {mapping.syncAvailability ? (
                            <Check className="h-5 w-5 text-green-500 mx-auto" />
                          ) : (
                            <X className="h-5 w-5 text-gray-300 mx-auto" />
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteMapping(mapping)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Mapping Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delivery.addMapping')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('delivery.selectProduct')}
              </label>
              <Select
                value={selectedProduct?.id || ''}
                onValueChange={(value) => {
                  const product = unmappedProducts.find(p => p.id === value);
                  setSelectedProduct(product || null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('delivery.selectProduct')} />
                </SelectTrigger>
                <SelectContent>
                  {unmappedProducts.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      <div className="flex items-center justify-between w-full">
                        <span>{product.name}</span>
                        <span className="text-gray-500 ml-2">{product.price.toFixed(2)} TL</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('delivery.platformProductId')}
              </label>
              <Input
                value={platformProductId}
                onChange={(e) => setPlatformProductId(e.target.value)}
                placeholder={`${PlatformLabels[selectedPlatform!]} urun ID'si`}
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('delivery.platformProductIdHelp')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleCreateMapping}
              disabled={!selectedProduct || !platformProductId || createMapping.isPending}
            >
              {t('delivery.createMapping')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductMappingPanel;
