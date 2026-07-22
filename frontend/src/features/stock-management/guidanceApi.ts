import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';

export type GuideCategory = 'MEAT' | 'PRODUCE' | 'DRY_GOODS' | 'DAIRY' | 'BEVERAGE' | 'PACKAGING' | 'CLEANING';
export type VolumeTier = 'SMALL_CAFE' | 'MID_RESTAURANT' | 'MULTI_BRANCH';

export type GuidanceSource =
  | { type: 'OWN_HISTORY'; supplierId: string; supplierName: string; lastUnitPrice: number; lastPurchaseAt: string; avgUnitPrice90d: number; trendPct: number | null; receiptCount: number }
  | { type: 'CATALOG'; supplierId: string; supplierName: string; unitPrice: number; isPreferred: boolean }
  | { type: 'CHANNEL'; categoryKey: GuideCategory; channelKey: string | null; recommendationKey: string };

export interface BuyListItem {
  stockItemId: string; name: string; unit: string; currentStock: number; par: number; suggestedQty: number;
  purchaseUnit: string | null; purchaseQty: number | null;
  recommended: GuidanceSource; alternatives: GuidanceSource[];
}
export interface ChannelGuideEntry {
  categoryKey: GuideCategory; recommendationKey: string;
  detail: { channels: Array<{ channelKey: string | null; rankForTier: number; advantageNote: string; minOrderNote: string; paymentNote: string; eInvoiceNote: string; sourceIds: string[] }>; rules: string[] };
}
export interface GuidanceResponse { volumeTier: VolumeTier; buyList: BuyListItem[]; channelGuide: ChannelGuideEntry[]; }

export const guidanceKeys = {
  guidance: (branchId: string | null) => ['stock', 'guidance', branchId] as const,
};

export const useGuidance = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: guidanceKeys.guidance(branchId),
    queryFn: async (): Promise<GuidanceResponse> => (await api.get('/stock-management/guidance')).data,
    staleTime: 5 * 60 * 1000,
  });
};
