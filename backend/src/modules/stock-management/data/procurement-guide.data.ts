// backend/src/modules/stock-management/data/procurement-guide.data.ts
import type { GuideCategory } from '../services/procurement-category.matcher';

export type VolumeTier = 'SMALL_CAFE' | 'MID_RESTAURANT' | 'MULTI_BRANCH';
export type ChannelKey =
  | 'CASH_CARRY' | 'WHOLESALE_MARKET' | 'ONLINE_B2B'
  | 'PRODUCER_COOP' | 'LOCAL_BUTCHER_WHOLESALER' | 'DISTRIBUTOR';

export interface GuideSource { id: string; title: string; publisher: string; url: string; accessedAt: string; }
export interface ChannelAdvice {
  channelKey: ChannelKey;
  rankForTier: Record<VolumeTier, number>; // 1 = best; higher = worse; 0 = not recommended
  advantageNoteKey: string;  // i18n key (stock.json guide.*)
  minOrderNoteKey: string;
  paymentNoteKey: string;
  eInvoiceNoteKey: string;
  sourceIds: string[];
}
export interface CategoryGuide {
  categoryKey: GuideCategory;
  recommendationKeyByTier: Record<VolumeTier, string>; // one-liner i18n key
  channels: ChannelAdvice[];
  ruleKeys: string[]; // 2-3 practical-rule i18n keys
}
export interface ProcurementGuide {
  version: string;
  midTierMonthlySpendTRY: number; // tier threshold: annualized 90d spend ≥ this → MID_RESTAURANT
  categories: CategoryGuide[];
  sources: GuideSource[];
}

// v0 stub — structurally complete, conservative. Phase 3 replaces content
// from docs/research/2026-07-22-tr-restaurant-procurement-channels.md.
// The 6 verified facts already available are encoded as sources s1..s3.
export const PROCUREMENT_GUIDE: ProcurementGuide = {
  version: '2026-07-22.v0',
  midTierMonthlySpendTRY: 150000,
  sources: [
    { id: 's1', title: 'Metro Gastro Servis', publisher: 'Metro Türkiye', url: 'https://www.metro-tr.com/gastroservis', accessedAt: '2026-07-22' },
    { id: 's2', title: 'HORECA Ürünleri', publisher: 'Bizim Toptan', url: 'https://www.bizimtoptan.com.tr/horeca-urunleri', accessedAt: '2026-07-22' },
    { id: 's3', title: 'Sebze ve Meyve Ticareti — SSS', publisher: 'T.C. Ticaret Bakanlığı', url: 'https://ticaret.gov.tr/ic-ticaret/sikca-sorulan-sorular/sebze-ve-meyve-ticareti', accessedAt: '2026-07-22' },
  ],
  categories: (['MEAT', 'PRODUCE', 'DRY_GOODS', 'DAIRY', 'BEVERAGE', 'PACKAGING', 'CLEANING'] as GuideCategory[]).map(
    (categoryKey) => ({
      categoryKey,
      recommendationKeyByTier: {
        SMALL_CAFE: `guide.rec.${categoryKey}.SMALL_CAFE`,
        MID_RESTAURANT: `guide.rec.${categoryKey}.MID_RESTAURANT`,
        MULTI_BRANCH: `guide.rec.${categoryKey}.MULTI_BRANCH`,
      },
      channels: [],
      ruleKeys: [],
    }),
  ),
};
