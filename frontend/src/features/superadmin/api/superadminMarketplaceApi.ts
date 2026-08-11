import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../../i18n/config';
import { getApiErrorMessage } from '../../../lib/api-error';
import { superAdminApi as api } from './superAdminApi';

/** Mirrors the backend CreateAddOnDto vocabulary (dto/addon.dto.ts). */
export type AddOnKind =
  | 'license'
  | 'module'
  | 'integration'
  | 'capacity'
  | 'credit'
  | 'service';
export type AddOnBilling = 'annual' | 'oneTime';
export type CreditKind = 'PHOTO' | 'VIDEO' | 'MODEL3D' | 'SMS';

export const ADDON_KINDS: AddOnKind[] = [
  'license',
  'module',
  'integration',
  'capacity',
  'credit',
  'service',
];
export const ADDON_BILLINGS: AddOnBilling[] = ['annual', 'oneTime'];
export const CREDIT_KINDS: CreditKind[] = ['PHOTO', 'VIDEO', 'MODEL3D', 'SMS'];
export const CATALOG_LOCALES = ['tr', 'en', 'ar', 'ru', 'uz'] as const;

export interface AdminAddOn {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: AddOnKind;
  billing: AddOnBilling;
  priceCents: number;
  currency: string;
  grants: Record<string, unknown>;
  deps: string[];
  status: 'draft' | 'published' | 'archived';
  /** Whether a live licence is required to buy AND use this product. */
  requiresLicense: boolean;
  creditKind: CreditKind | null;
  creditUnits: number | null;
  maxQuantity: number | null;
  sortOrder: number;
  /** { tr: { name, description }, en: {...}, … } — copy ships without a release. */
  i18n: Record<string, { name?: string; description?: string }> | null;
  commissionRate: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantLicensingSnapshot {
  tenant: { id: string; name: string };
  license: {
    active: boolean;
    anchorAt: string | null;
    anniversaryAt: string | null;
    daysRemaining: number | null;
  };
  owned: Array<{
    id: string;
    code: string;
    name: string;
    kind: string;
    quantity: number;
    status: string;
    origin: string;
    compReason: string | null;
    periodEnd: string | null;
    chargedCents: number | null;
    listCents: number;
    currency: string;
    suppressedByLicence: boolean;
  }>;
  credits: Record<string, number>;
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
      toast.success(i18n.t('superadmin:marketplace.toasts.addonCreated'));
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.createFailed'))),
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
      toast.success(i18n.t('superadmin:marketplace.toasts.addonUpdated'));
    },
    // F5: without onError a failed edit/publish resolved silently — the row
    // simply didn't change. Mirror the create hook's toast pipeline.
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.updateFailed'))),
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
      toast.success(i18n.t('superadmin:marketplace.toasts.addonArchived'));
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.archiveFailed'))),
  });
};

// ── Tenant entitlements: licence, owned products, comps ────────────────

export const useSaTenantLicensing = (tenantId: string | undefined) =>
  useQuery({
    queryKey: ['sa', 'tenant-licensing', tenantId] as const,
    enabled: !!tenantId,
    queryFn: async (): Promise<TenantLicensingSnapshot> => {
      const r = await api.get(
        `/v1/superadmin/marketplace/tenants/${tenantId}/licensing`,
      );
      return r.data;
    },
  });

/**
 * Hand a tenant a product for free.
 *
 * NOT the same lever as a feature override. A comp is an ownership row: it
 * expires on the anniversary, shows up in the tenant's own list, records who
 * granted it and why, and cannot outrank a later purchase of the same code.
 */
export const useSaCompProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      tenantId: string;
      addOnCode: string;
      quantity?: number;
      reason: string;
      branchId?: string;
    }): Promise<{ ok: true; kind: string; warning: string | null }> => {
      const r = await api.post('/v1/superadmin/marketplace/comp', body);
      return r.data;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['sa', 'tenant-licensing', vars.tenantId] });
      qc.invalidateQueries({ queryKey: ['superadmin', 'tenants'] });
      // The comp landed either way; the warning is about whether its grants
      // are live yet, so it must not be reported as a failure.
      if (data.warning) toast.warning(data.warning);
      else toast.success(i18n.t('superadmin:marketplace.toasts.comped'));
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.compFailed'))),
  });
};

export const useSaRevokeComp = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenantId, tenantAddOnId }: { tenantId: string; tenantAddOnId: string }) => {
      const r = await api.delete(
        `/v1/superadmin/marketplace/comp/${tenantAddOnId}`,
        { params: { tenantId } },
      );
      return r.data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['sa', 'tenant-licensing', vars.tenantId] });
      toast.success(i18n.t('superadmin:marketplace.toasts.compRevoked'));
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.revokeFailed'))),
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
      toast.success(i18n.t('superadmin:marketplace.toasts.productCreated'));
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.createFailed'))),
  });
};

export const useSaUpdateProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<AdminHardwareProduct> & { id: string }): Promise<AdminHardwareProduct> => {
      const r = await api.patch(`/v1/superadmin/catalog/products/${id}`, body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa', 'products'] });
      toast.success(i18n.t('superadmin:marketplace.toasts.productUpdated'));
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.updateFailed'))),
  });
};

export const useSaArchiveProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminHardwareProduct> => {
      const r = await api.delete(`/v1/superadmin/catalog/products/${id}`);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa', 'products'] });
      toast.success(i18n.t('superadmin:marketplace.toasts.productArchived'));
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.archiveFailed'))),
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
      toast.success(i18n.t('superadmin:marketplace.toasts.stockReceived'));
    },
    onError: (e) =>
      toast.error(getApiErrorMessage(e, i18n.t('superadmin:marketplace.toasts.stockFailed'))),
  });
};
