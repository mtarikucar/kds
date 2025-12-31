import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from '../ui/form';
import {
  PlatformType,
  PlatformLabels,
  useConfigurePlatform,
  useTestPlatformConnection,
  useGetPlatformConfig,
} from '../../features/integrations/deliveryApi';
import { toast } from 'sonner';

interface PlatformConfigModalProps {
  open: boolean;
  onClose: () => void;
  platformType: PlatformType;
  onSuccess: () => void;
}

// Schema for each platform
const getTrendyolSchema = () => z.object({
  supplierId: z.string().min(1, 'Supplier ID is required'),
  apiKey: z.string().min(1, 'API Key is required'),
  apiSecret: z.string().min(1, 'API Secret is required'),
});

const getYemeksepetiSchema = () => z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  restaurantId: z.string().min(1, 'Restaurant ID is required'),
});

const getGetirSchema = () => z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  restaurantId: z.string().min(1, 'Restaurant ID is required'),
});

const getMigrosSchema = () => z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  storeId: z.string().min(1, 'Store ID is required'),
});

const getFuudySchema = () => z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  restaurantId: z.string().min(1, 'Restaurant ID is required'),
});

const getSchemaForPlatform = (platform: PlatformType) => {
  switch (platform) {
    case PlatformType.TRENDYOL:
      return getTrendyolSchema();
    case PlatformType.YEMEKSEPETI:
      return getYemeksepetiSchema();
    case PlatformType.GETIR:
      return getGetirSchema();
    case PlatformType.MIGROS:
      return getMigrosSchema();
    case PlatformType.FUUDY:
      return getFuudySchema();
    default:
      return z.object({});
  }
};

// Combined type for all possible form data
type PlatformConfigFormData = {
  supplierId?: string;
  apiKey?: string;
  apiSecret?: string;
  clientId?: string;
  clientSecret?: string;
  restaurantId?: string;
  storeId?: string;
};

const PlatformConfigModal = ({ open, onClose, platformType, onSuccess }: PlatformConfigModalProps) => {
  const { t } = useTranslation('settings');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: currentConfig } = useGetPlatformConfig(platformType);
  const configurePlatform = useConfigurePlatform();
  const testConnection = useTestPlatformConnection();

  const schema = getSchemaForPlatform(platformType);

  const form = useForm<PlatformConfigFormData>({
    resolver: zodResolver(schema),
    defaultValues: (currentConfig?.config as PlatformConfigFormData) || {},
  });

  const handleTest = async () => {
    setTestResult(null);
    try {
      const result = await testConnection.mutateAsync(platformType);
      setTestResult({ success: result.success, message: result.message || 'Connection successful!' });
    } catch (error: any) {
      setTestResult({ success: false, message: error.response?.data?.message || 'Connection failed' });
    }
  };

  const handleSubmit = async (data: PlatformConfigFormData) => {
    try {
      await configurePlatform.mutateAsync({
        platformType,
        config: data,
      });
      toast.success(t('delivery.configSaved'));
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('delivery.configFailed'));
    }
  };

  const renderFields = () => {
    switch (platformType) {
      case PlatformType.TRENDYOL:
        return (
          <>
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="123456" />
                  </FormControl>
                  <FormDescription>Trendyol Seller Center'dan alabilirsiniz</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-api-key" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="apiSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Secret</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" placeholder="your-api-secret" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );

      case PlatformType.YEMEKSEPETI:
        return (
          <>
            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-client-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="clientSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Secret</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" placeholder="your-client-secret" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="restaurantId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Restaurant ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-restaurant-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );

      case PlatformType.GETIR:
        return (
          <>
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-api-key" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="restaurantId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Restaurant ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-restaurant-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );

      case PlatformType.MIGROS:
        return (
          <>
            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-client-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="clientSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Secret</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" placeholder="your-client-secret" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="storeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Store ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-store-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );

      case PlatformType.FUUDY:
        return (
          <>
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-api-key" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="restaurantId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Restaurant ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="your-restaurant-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('delivery.configurePlatform', { platform: PlatformLabels[platformType] })}</DialogTitle>
          <DialogDescription>
            {t('delivery.configureDesc')}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {renderFields()}

            {/* Test Result */}
            {testResult && (
              <div
                className={`flex items-center gap-2 p-3 rounded-lg ${
                  testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
                <span className="text-sm">{testResult.message}</span>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleTest} disabled={testConnection.isPending}>
                {testConnection.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('delivery.testConnection')}
              </Button>
              <Button type="submit" disabled={configurePlatform.isPending}>
                {configurePlatform.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('delivery.saveConfig')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default PlatformConfigModal;
