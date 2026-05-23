import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';

export interface HardwareProduct {
  id: string;
  sku: string;
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  specs?: Record<string, unknown>;
  compat?: Record<string, unknown>;
  priceCents: number;
  rentalMonthlyCents: number | null;
  currency: string;
  warrantyMonths: number;
  images: string[];
  stockStatus: 'in_stock' | 'preorder' | 'out_of_stock' | 'discontinued';
}

export interface CartItem {
  type: 'plan' | 'addon' | 'hardware' | 'service';
  code?: string;
  sku?: string;
  qty?: number;
  billingCycle?: 'MONTHLY' | 'YEARLY';
  branchId?: string;
  acquisition?: 'sell' | 'rent';
}

export interface PricedLine {
  type: string;
  code: string;
  name: string;
  qty: number;
  unitCents: number;
  subtotalCents: number;
  cadence: 'monthly' | 'yearly' | 'oneTime';
  meta?: Record<string, unknown>;
}

export interface CartQuote {
  lines: PricedLine[];
  currency: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  warnings: string[];
  isPureRecurring: boolean;
}

export const storeKeys = {
  products: (category?: string) => ['hardware-store', 'products', category] as const,
};

export const useListProducts = (category?: string) =>
  useQuery({
    queryKey: storeKeys.products(category),
    queryFn: async (): Promise<HardwareProduct[]> => {
      const r = await api.get('/v1/catalog/products', { params: category ? { category } : {} });
      return r.data;
    },
  });

export const useQuoteCart = () => {
  return useMutation({
    mutationFn: async (cart: { items: CartItem[]; shippingAddress?: any }): Promise<CartQuote> => {
      const r = await api.post('/v1/checkout/quote', cart);
      return r.data;
    },
  });
};

export const useConfirmCheckout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cart, paymentRef }: { cart: { items: CartItem[]; shippingAddress?: any }; paymentRef: string }) => {
      const r = await api.post('/v1/checkout/confirm', { cart, paymentRef });
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries(); // entitlements + addons + devices may all change
      toast.success('Order placed.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Checkout failed'),
  });
};
