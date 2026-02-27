import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import i18n from '../../i18n/config';
import { toast } from 'sonner';
import type {
  StockItemCategory,
  StockItem,
  Recipe,
  Supplier,
  PurchaseOrder,
  IngredientMovement,
  WasteLog,
  StockCount,
  StockSettings,
  StockDashboard,
  StockValuation,
  StockCheckResult,
  StockBatch,
} from './types';

const BASE = '/stock-management';

// ─── Categories ─────────────────────────────
export const useStockCategories = () =>
  useQuery<StockItemCategory[]>({
    queryKey: ['stockCategories'],
    queryFn: async () => (await api.get(`${BASE}/categories`)).data,
  });

export const useCreateStockCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; description?: string; color?: string }) =>
      (await api.post(`${BASE}/categories`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockCategories'] });
      toast.success(i18n.t('stock:categories.created'));
    },
    onError: () => toast.error(i18n.t('stock:categories.createError')),
  });
};

export const useUpdateStockCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<StockItemCategory> }) =>
      (await api.patch(`${BASE}/categories/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockCategories'] });
      toast.success(i18n.t('stock:categories.updated'));
    },
    onError: () => toast.error(i18n.t('stock:categories.updateError')),
  });
};

export const useDeleteStockCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${BASE}/categories/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockCategories'] });
      toast.success(i18n.t('stock:categories.deleted'));
    },
    onError: () => toast.error(i18n.t('stock:categories.deleteError')),
  });
};

// ─── Stock Items ─────────────────────────────
export const useStockItems = (params?: { search?: string; categoryId?: string; isActive?: boolean; sortBy?: string; sortOrder?: string }) =>
  useQuery<StockItem[]>({
    queryKey: ['stockItems', params],
    queryFn: async () => (await api.get(`${BASE}/items`, { params })).data,
  });

export const useStockItem = (id: string) =>
  useQuery<StockItem>({
    queryKey: ['stockItems', id],
    queryFn: async () => (await api.get(`${BASE}/items/${id}`)).data,
    enabled: !!id,
  });

export const useLowStockItems = () =>
  useQuery<any[]>({
    queryKey: ['stockItems', 'lowStock'],
    queryFn: async () => (await api.get(`${BASE}/items/low-stock`)).data,
  });

export const useExpiringSoon = (days?: number) =>
  useQuery<StockBatch[]>({
    queryKey: ['stockItems', 'expiring', days],
    queryFn: async () => (await api.get(`${BASE}/items/expiring-soon`, { params: { days } })).data,
  });

export const useCreateStockItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post(`${BASE}/items`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockItems'] });
      toast.success(i18n.t('stock:items.created'));
    },
    onError: () => toast.error(i18n.t('stock:items.createError')),
  });
};

export const useUpdateStockItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await api.patch(`${BASE}/items/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockItems'] });
      toast.success(i18n.t('stock:items.updated'));
    },
    onError: () => toast.error(i18n.t('stock:items.updateError')),
  });
};

export const useDeleteStockItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${BASE}/items/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockItems'] });
      toast.success(i18n.t('stock:items.deleted'));
    },
    onError: () => toast.error(i18n.t('stock:items.deleteError')),
  });
};

// ─── Recipes ─────────────────────────────────
export const useRecipes = () =>
  useQuery<Recipe[]>({
    queryKey: ['recipes'],
    queryFn: async () => (await api.get(`${BASE}/recipes`)).data,
  });

export const useRecipe = (id: string) =>
  useQuery<Recipe>({
    queryKey: ['recipes', id],
    queryFn: async () => (await api.get(`${BASE}/recipes/${id}`)).data,
    enabled: !!id,
  });

export const useRecipeByProduct = (productId: string) =>
  useQuery<Recipe>({
    queryKey: ['recipes', 'product', productId],
    queryFn: async () => (await api.get(`${BASE}/recipes/by-product/${productId}`)).data,
    enabled: !!productId,
  });

export const useCreateRecipe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post(`${BASE}/recipes`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      toast.success(i18n.t('stock:recipes.created'));
    },
    onError: () => toast.error(i18n.t('stock:recipes.createError')),
  });
};

export const useUpdateRecipe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await api.patch(`${BASE}/recipes/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      toast.success(i18n.t('stock:recipes.updated'));
    },
    onError: () => toast.error(i18n.t('stock:recipes.updateError')),
  });
};

export const useDeleteRecipe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${BASE}/recipes/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      toast.success(i18n.t('stock:recipes.deleted'));
    },
    onError: () => toast.error(i18n.t('stock:recipes.deleteError')),
  });
};

export const useCheckRecipeStock = () =>
  useMutation<StockCheckResult, Error, { id: string; quantity?: number }>({
    mutationFn: async ({ id, quantity }) =>
      (await api.post(`${BASE}/recipes/${id}/check-stock`, null, { params: { quantity } })).data,
  });

// ─── Suppliers ───────────────────────────────
export const useSuppliers = () =>
  useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get(`${BASE}/suppliers`)).data,
  });

export const useSupplier = (id: string) =>
  useQuery<Supplier>({
    queryKey: ['suppliers', id],
    queryFn: async () => (await api.get(`${BASE}/suppliers/${id}`)).data,
    enabled: !!id,
  });

export const useCreateSupplier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post(`${BASE}/suppliers`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(i18n.t('stock:suppliers.created'));
    },
    onError: () => toast.error(i18n.t('stock:suppliers.createError')),
  });
};

export const useUpdateSupplier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await api.patch(`${BASE}/suppliers/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(i18n.t('stock:suppliers.updated'));
    },
    onError: () => toast.error(i18n.t('stock:suppliers.updateError')),
  });
};

export const useDeleteSupplier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${BASE}/suppliers/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(i18n.t('stock:suppliers.deleted'));
    },
    onError: () => toast.error(i18n.t('stock:suppliers.deleteError')),
  });
};

export const useAddSupplierItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ supplierId, data }: { supplierId: string; data: any }) =>
      (await api.post(`${BASE}/suppliers/${supplierId}/items`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(i18n.t('stock:suppliers.itemAdded'));
    },
    onError: () => toast.error(i18n.t('stock:suppliers.itemAddError')),
  });
};

export const useRemoveSupplierItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ supplierId, stockItemId }: { supplierId: string; stockItemId: string }) =>
      (await api.delete(`${BASE}/suppliers/${supplierId}/items/${stockItemId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
};

// ─── Purchase Orders ─────────────────────────
export const usePurchaseOrders = (status?: string) =>
  useQuery<PurchaseOrder[]>({
    queryKey: ['purchaseOrders', status],
    queryFn: async () => (await api.get(`${BASE}/purchase-orders`, { params: { status } })).data,
  });

export const usePurchaseOrder = (id: string) =>
  useQuery<PurchaseOrder>({
    queryKey: ['purchaseOrders', id],
    queryFn: async () => (await api.get(`${BASE}/purchase-orders/${id}`)).data,
    enabled: !!id,
  });

export const useCreatePurchaseOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post(`${BASE}/purchase-orders`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
      toast.success(i18n.t('stock:purchaseOrders.created'));
    },
    onError: () => toast.error(i18n.t('stock:purchaseOrders.createError')),
  });
};

export const useSubmitPurchaseOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${BASE}/purchase-orders/${id}/submit`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
      toast.success(i18n.t('stock:purchaseOrders.submitted'));
    },
    onError: () => toast.error(i18n.t('stock:purchaseOrders.submitError')),
  });
};

export const useReceivePurchaseOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await api.post(`${BASE}/purchase-orders/${id}/receive`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
      qc.invalidateQueries({ queryKey: ['stockItems'] });
      toast.success(i18n.t('stock:purchaseOrders.received'));
    },
    onError: () => toast.error(i18n.t('stock:purchaseOrders.receiveError')),
  });
};

export const useCancelPurchaseOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${BASE}/purchase-orders/${id}/cancel`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
      toast.success(i18n.t('stock:purchaseOrders.cancelled'));
    },
    onError: () => toast.error(i18n.t('stock:purchaseOrders.cancelError')),
  });
};

// ─── Movements ───────────────────────────────
export const useIngredientMovements = (params?: { stockItemId?: string; type?: string; startDate?: string; endDate?: string }) =>
  useQuery<IngredientMovement[]>({
    queryKey: ['ingredientMovements', params],
    queryFn: async () => (await api.get(`${BASE}/movements`, { params })).data,
  });

export const useCreateMovement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post(`${BASE}/movements`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredientMovements'] });
      qc.invalidateQueries({ queryKey: ['stockItems'] });
      toast.success(i18n.t('stock:movements.created'));
    },
    onError: () => toast.error(i18n.t('stock:movements.createError')),
  });
};

// ─── Waste Logs ──────────────────────────────
export const useWasteLogs = (params?: { stockItemId?: string; reason?: string; startDate?: string; endDate?: string }) =>
  useQuery<WasteLog[]>({
    queryKey: ['wasteLogs', params],
    queryFn: async () => (await api.get(`${BASE}/waste-logs`, { params })).data,
  });

export const useWasteSummary = (params?: { startDate?: string; endDate?: string }) =>
  useQuery({
    queryKey: ['wasteLogs', 'summary', params],
    queryFn: async () => (await api.get(`${BASE}/waste-logs/summary`, { params })).data,
  });

export const useCreateWasteLog = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post(`${BASE}/waste-logs`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wasteLogs'] });
      qc.invalidateQueries({ queryKey: ['stockItems'] });
      toast.success(i18n.t('stock:waste.created'));
    },
    onError: () => toast.error(i18n.t('stock:waste.createError')),
  });
};

// ─── Stock Counts ────────────────────────────
export const useStockCounts = (status?: string) =>
  useQuery<StockCount[]>({
    queryKey: ['stockCounts', status],
    queryFn: async () => (await api.get(`${BASE}/stock-counts`, { params: { status } })).data,
  });

export const useStockCount = (id: string) =>
  useQuery<StockCount>({
    queryKey: ['stockCounts', id],
    queryFn: async () => (await api.get(`${BASE}/stock-counts/${id}`)).data,
    enabled: !!id,
  });

export const useCreateStockCount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await api.post(`${BASE}/stock-counts`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockCounts'] });
      toast.success(i18n.t('stock:counts.created'));
    },
    onError: () => toast.error(i18n.t('stock:counts.createError')),
  });
};

export const useUpdateStockCountItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ countId, itemId, data }: { countId: string; itemId: string; data: { countedQty: number } }) =>
      (await api.patch(`${BASE}/stock-counts/${countId}/items/${itemId}`, data)).data,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['stockCounts', vars.countId] });
    },
  });
};

export const useFinalizeStockCount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${BASE}/stock-counts/${id}/finalize`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockCounts'] });
      qc.invalidateQueries({ queryKey: ['stockItems'] });
      toast.success(i18n.t('stock:counts.finalized'));
    },
    onError: () => toast.error(i18n.t('stock:counts.finalizeError')),
  });
};

export const useCancelStockCount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`${BASE}/stock-counts/${id}/cancel`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockCounts'] });
      toast.success(i18n.t('stock:counts.cancelled'));
    },
  });
};

// ─── Dashboard ───────────────────────────────
export const useStockDashboard = () =>
  useQuery<StockDashboard>({
    queryKey: ['stockDashboard'],
    queryFn: async () => (await api.get(`${BASE}/dashboard`)).data,
  });

export const useStockValuation = () =>
  useQuery<StockValuation>({
    queryKey: ['stockValuation'],
    queryFn: async () => (await api.get(`${BASE}/dashboard/valuation`)).data,
  });

export const useMovementSummary = (params?: { startDate?: string; endDate?: string }) =>
  useQuery({
    queryKey: ['movementSummary', params],
    queryFn: async () => (await api.get(`${BASE}/dashboard/movement-summary`, { params })).data,
  });

// ─── Settings ────────────────────────────────
export const useStockSettings = () =>
  useQuery<StockSettings>({
    queryKey: ['stockSettings'],
    queryFn: async () => (await api.get(`${BASE}/settings`)).data,
  });

export const useUpdateStockSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<StockSettings>) =>
      (await api.patch(`${BASE}/settings`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stockSettings'] });
      toast.success(i18n.t('stock:settings.updated'));
    },
    onError: () => toast.error(i18n.t('stock:settings.updateError')),
  });
};
