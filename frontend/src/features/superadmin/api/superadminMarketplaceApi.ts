import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getApiErrorMessage } from '../../../lib/api-error';
import { superAdminApi as api } from './superAdminApi';

export interface AdminAddOn {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: 'software' | 'integration' | 'capacity' | 'support';
  billing: 'recurring' | 'oneTime';
  priceCents: number;
  currency: string;
  grants: Record<string, unknown>;
  deps: string[];
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface AdminHardwareProduct {
  id: string;
  sku: string;
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  priceCents: number;
  rentalMonthlyCents: number | null;
  currency: string;
  warrantyMonths: number;
  images: string[];
  stockStatus: string;
  status: 'draft' | 'published' | 'archived';
  inventory?: { available: number; allocated: number; shipped: number };
}

export const saMarketplaceKeys = {
  addons: (status?: string, kind?: string) => ['sa', 'addons', status, kind] as const,
  products: (status?: string, category?: string) => ['sa', 'products', status, category] as const,
};

// ── Add-ons ────────────────────────────────────────────────────────────

export const useSaListAddOns = (filters: { status?: string; kind?: string } = {}) =>
  useQuery({
    queryKey: saMarketplaceKeys.addons(filters.status, filters.kind),
    queryFn: async (): Promise<AdminAddOn[]> => {
      const r = await api.get('/v1/superadmin/marketplace/addons', { params: filters });
      return r.data;
    },
  });

export const useSaCreateAddOn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<AdminAddOn>): Promise<AdminAddOn> => {
      const r = await api.post('/v1/superadmin/marketplace/addons', body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa', 'addons'] });
      toast.success('Add-on created.');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Create failed')),
  });
};

export const useSaUpdateAddOn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<AdminAddOn> & { id: string }): Promise<AdminAddOn> => {
      const r = await api.patch(`/v1/superadmin/marketplace/addons/${id}`, body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa', 'addons'] });
      toast.success('Add-on updated.');
    },
  });
};

export const useSaArchiveAddOn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminAddOn> => {
      const r = await api.delete(`/v1/superadmin/marketplace/addons/${id}`);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa', 'addons'] });
      toast.success('Add-on archived.');
    },
  });
};

// ── Hardware catalog ───────────────────────────────────────────────────

export const useSaListProducts = (filters: { status?: string; category?: string } = {}) =>
  useQuery({
    queryKey: saMarketplaceKeys.products(filters.status, filters.category),
    queryFn: async (): Promise<AdminHardwareProduct[]> => {
      const r = await api.get('/v1/superadmin/catalog/products', { params: filters });
      return r.data;
    },
  });

export const useSaCreateProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<AdminHardwareProduct>): Promise<AdminHardwareProduct> => {
      const r = await api.post('/v1/superadmin/catalog/products', body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa', 'products'] });
      toast.success('Product created.');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Create failed')),
  });
};

export const useSaUpdateProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<AdminHardwareProduct> & { id: string }): Promise<AdminHardwareProduct> => {
      const r = await api.patch(`/v1/superadmin/catalog/products/${id}`, body);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'products'] }),
  });
};

export const useSaArchiveProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminHardwareProduct> => {
      const r = await api.delete(`/v1/superadmin/catalog/products/${id}`);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'products'] }),
  });
};

export const useSaReceiveStock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, qty, serials }: { id: string; qty: number; serials?: string[] }) => {
      const r = await api.post(`/v1/superadmin/catalog/products/${id}/stock`, { qty, serials });
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa', 'products'] });
      toast.success('Stock received.');
    },
  });
};
