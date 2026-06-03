import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';

export interface WebhookSubscription {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  status: 'active' | 'paused';
  lastDeliveryAt: string | null;
  lastDeliveryCode: number | null;
  consecutiveFailures: number;
  createdAt: string;
  // Present only on the create-response (returned once).
  secret?: string;
}

export const webhookKeys = {
  all: ['webhooks'] as const,
};

export const useListWebhooks = () =>
  useQuery({
    queryKey: webhookKeys.all,
    queryFn: async (): Promise<WebhookSubscription[]> => {
      const r = await api.get('/v1/webhooks/subscriptions');
      return r.data;
    },
  });

export const useCreateWebhook = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { url: string; events?: string[] }): Promise<WebhookSubscription> => {
      const r = await api.post('/v1/webhooks/subscriptions', input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: webhookKeys.all });
      toast.success('Webhook subscription created. Save the secret — it is shown once.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Failed'),
  });
};

export const useRevokeWebhook = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/v1/webhooks/subscriptions/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: webhookKeys.all });
      toast.success('Subscription revoked.');
    },
  });
};
