import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';

const BASE = '/stock-management';

export const useReorderSuggestions = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['purchasing', 'reorder', branchId],
    queryFn: async () => {
      const r = await api.get(`${BASE}/dashboard/reorder-suggestions`);
      return r.data;
    },
  });
};

export const useApAging = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['purchasing', 'ap-aging', branchId],
    queryFn: async () => {
      const r = await api.get(`${BASE}/purchase-invoices/ap-aging`);
      return r.data;
    },
  });
};

export const useSupplierScorecard = (params?: {
  startDate?: string;
  endDate?: string;
}) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['purchasing', 'scorecard', params, branchId],
    queryFn: async () => {
      const r = await api.get(`${BASE}/suppliers/scorecard`, { params });
      return r.data;
    },
  });
};

export const useBatchValuation = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['purchasing', 'batch-valuation', branchId],
    queryFn: async () => {
      const r = await api.get(`${BASE}/dashboard/batch-valuation`);
      return r.data;
    },
  });
};

export interface StockTransfer {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  items: Array<{ sourceStockItemId: string; destStockItemId: string; quantity: string }>;
  createdAt: string;
}

export const useStockTransfers = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['purchasing', 'transfers', branchId],
    queryFn: async (): Promise<StockTransfer[]> => {
      const r = await api.get(`${BASE}/transfers`);
      return r.data;
    },
  });
};

/**
 * Stock items of ANOTHER branch (the transfer destination) — sends an explicit
 * X-Branch-Id override, which the api interceptor respects and BranchGuard
 * still validates against the caller's allowed branches.
 */
export const useBranchStockItems = (branchId?: string) =>
  useQuery({
    queryKey: ['purchasing', 'branch-items', branchId],
    queryFn: async (): Promise<
      Array<{ id: string; name: string; unit: string }>
    > => {
      const r = await api.get(`${BASE}/items`, {
        headers: { 'X-Branch-Id': branchId! },
      });
      return r.data;
    },
    enabled: !!branchId,
  });

export const useCreateStockTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      toBranchId: string;
      notes?: string;
      items: Array<{
        sourceStockItemId: string;
        destStockItemId: string;
        quantity: number;
        unitCost?: number;
      }>;
    }) => {
      const r = await api.post(`${BASE}/transfers`, input);
      return r.data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchasing', 'transfers'] }),
  });
};

export const useCompleteStockTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await api.patch(`${BASE}/transfers/${id}/complete`);
      return r.data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchasing', 'transfers'] }),
  });
};

export const useCancelStockTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await api.patch(`${BASE}/transfers/${id}/cancel`);
      return r.data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchasing', 'transfers'] }),
  });
};

export const useApprovePurchaseOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await api.post(`${BASE}/purchase-orders/${id}/approve`);
      return r.data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stock', 'purchase-orders'] }),
  });
};

export const useApplyLandedCost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      freight?: number;
      customs?: number;
      other?: number;
    }) => {
      const { id, ...body } = input;
      const r = await api.post(
        `${BASE}/purchase-orders/${id}/landed-cost`,
        body
      );
      return r.data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stock', 'purchase-orders'] }),
  });
};

// ── PO templates, supplier return (RMA), barcode lookup, CSV export ─────────
export const usePoTemplates = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['purchasing', 'po-templates', branchId],
    queryFn: async () => {
      const r = await api.get(`${BASE}/purchase-orders/templates`);
      return r.data as Array<{ id: string; name: string; supplierId: string; items: any[] }>;
    },
  });
};

export const useCreateOrderFromTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const r = await api.post(`${BASE}/purchase-orders/templates/${templateId}/create-order`);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock', 'purchase-orders'] }),
  });
};

export const useDeletePoTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`${BASE}/purchase-orders/templates/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchasing', 'po-templates'] }),
  });
};

export const useSupplierReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      supplierId: string;
      reason?: string;
      items: Array<{ stockItemId: string; quantity: number; unitCost?: number }>;
    }) => {
      const r = await api.post(`${BASE}/purchase-invoices/supplier-return`, input);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchasing'] }),
  });
};

export const lookupBarcode = async (barcode: string) => {
  const r = await api.get(`${BASE}/items/by-barcode/${encodeURIComponent(barcode)}`);
  return r.data;
};
