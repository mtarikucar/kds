/**
 * Index metadata for the ported /tr/ozellikler and /tr/cozumler pages.
 *
 * `hasDeepDive` marks the slugs with real long-form copy in ./modules.ts. The
 * other eight modules only ever rendered a thin page derived from their own
 * tagline in the SPA, and a thin page is worse than no page: it competes with
 * the real ones for the same queries and gives a crawler nothing to rank. They
 * are listed on the index and link to the homepage section instead.
 */

/**
 * Whether a module is part of the free core or a paid annual add-on.
 *
 * Derived from backend/src/modules/entitlements/free-baseline.const.ts (which
 * grants posAccess, kdsIntegration, customBranding and multiLocation forever)
 * and backend/src/modules/marketplace/alacarte-catalog.const.ts. Deep-dive
 * pages sold several paid modules without saying so — the reports page is the
 * clearest case: every /reports/* route carries
 * `@RequiresFeature(ADVANCED_REPORTS)`, and that entitlement costs ₺1.290/yr on
 * top of the ₺4.900 licence.
 *
 * Keep this in step with the catalogue. A module that becomes free should be
 * changed here in the same commit.
 */
export type Pricing =
  | { kind: 'free' }
  | { kind: 'paid'; priceLabel: string };

export interface ModuleMeta {
  slug: string;
  pricing: Pricing;
  /** Excluded from the index and from the sitemap; see the entry's comment. */
  hidden?: boolean;
  title: string;
  tagline: string;
  hasDeepDive: boolean;
  /** Where a module already has a better dedicated page, point at it. */
  redirectTo?: string;
}

export const MODULES: ModuleMeta[] = [
  {
    slug: 'qr-menu',
    pricing: { kind: 'free' },
    title: 'QR Menü',
    tagline: 'Kağıt menü masrafına elveda.',
    hasDeepDive: true,
    redirectTo: '/qr-menu',
  },
  {
    slug: 'pos-odeme',
    pricing: { kind: 'free' },
    title: 'POS & Ödeme',
    tagline: 'Saniyeler içinde satış, hesap ve ödeme.',
    hasDeepDive: true,
  },
  {
    slug: 'masa-siparis',
    pricing: { kind: 'free' },
    title: 'Masa & Sipariş',
    tagline: 'Kat planında canlı masa yönetimi.',
    hasDeepDive: true,
  },
  {
    slug: 'rezervasyon',
    pricing: { kind: 'paid', priceLabel: '₺990/yıl' },
    title: 'Rezervasyon',
    tagline: 'Boş masa kalmasın, çifte rezervasyon olmasın.',
    hasDeepDive: true,
  },
  {
    slug: 'garson-cagri',
    pricing: { kind: 'free' },
    title: 'Garson Çağrı & Self-Pay',
    tagline: 'Masadan çağır, masadan öde.',
    hasDeepDive: true,
  },
  {
    slug: 'mutfak-ekrani-kds',
    pricing: { kind: 'free' },
    title: 'Mutfak Ekranı (KDS)',
    tagline: 'Mutfakta sipariş kaosuna son.',
    hasDeepDive: true,
  },
  {
    slug: 'stok-envanter',
    pricing: { kind: 'paid', priceLabel: '₺3.900/yıl' },
    title: 'Stok & Envanter',
    tagline: 'Reçeteyle otomatik stok düşümü.',
    hasDeepDive: true,
  },
  {
    slug: 'raporlar',
    pricing: { kind: 'paid', priceLabel: '₺1.290/yıl' },
    title: 'Raporlar & Analiz',
    tagline: 'Rakamları gör, kararı hızlı ver.',
    hasDeepDive: true,
  },
  // `analitik` ("Analitik & Isı Haritası") is deliberately absent.
  //
  // The 985 words written for it are entirely about a table-occupancy heat map
  // fed by edge camera devices. That whole suite ships inert behind
  // CAMERA_ANALYTICS_ENABLED, which is set in no environment file, and
  // camera-analytics.gate.ts makes its endpoints answer 404 in production.
  //
  // The copy still exists at frontend/src/marketing/data/moduleContent.generated.ts.
  // Port it back and re-add the entry here in the same change that enables the
  // flag — never earlier to fill a gap on the index page.
  {
    slug: 'personel',
    pricing: { kind: 'paid', priceLabel: '₺990/yıl' },
    title: 'Personel Yönetimi',
    tagline: 'Vardiya, mesai ve performans tek yerde.',
    hasDeepDive: true,
  },
  {
    slug: 'musteri-sadakat',
    pricing: { kind: 'free' },
    title: 'Müşteri & Sadakat',
    tagline: 'Gelen müşteri geri gelsin.',
    hasDeepDive: true,
  },
  {
    slug: 'coklu-sube',
    pricing: { kind: 'free' },
    title: 'Çoklu Şube',
    tagline: 'Tüm şubeler, tek hesap.',
    hasDeepDive: true,
  },
  {
    slug: 'entegrasyonlar',
    pricing: { kind: 'paid', priceLabel: '₺2.499/yıl' },
    title: 'Entegrasyonlar',
    tagline: 'Tüm sipariş kanalları tek panelde.',
    hasDeepDive: true,
  },
  {
    slug: 'e-fatura',
    pricing: { kind: 'paid', priceLabel: 'sağlayıcı hesabınıza bağlıdır' },
    title: 'e-Fatura & e-Dönüşüm',
    tagline: 'Ödemeden faturaya kesintisiz.',
    hasDeepDive: true,
  },
  {
    slug: 'donanim',
    pricing: { kind: 'paid', priceLabel: 'donanıma göre' },
    title: 'Donanım & Cihaz Ağı',
    tagline: 'Yazıcı, tablet ve cihazlar tek ağda.',
    hasDeepDive: true,
  },
  {
    slug: 'marketplace',
    pricing: { kind: 'paid', priceLabel: 'kaleme göre' },
    title: 'Marketplace & Eklentiler',
    tagline: 'İhtiyacın kadar özellik, tek tıkla.',
    hasDeepDive: true,
  },
  {
    slug: 'guvenlik',
    pricing: { kind: 'free' },
    title: 'Güvenlik & Uyum',
    tagline: 'Verileriniz şifreli, süreçleriniz KVKK uyumlu.',
    hasDeepDive: true,
  },
];

export interface SectorMeta {
  slug: string;
  title: string;
  emoji: string;
  moduleSlugs: string[];
}

export const SECTORS: SectorMeta[] = [
  {
    slug: 'restoran',
    title: 'Restoran',
    emoji: '🍽️',
    moduleSlugs: ['masa-siparis', 'pos-odeme', 'mutfak-ekrani-kds', 'qr-menu', 'stok-envanter', 'rezervasyon'],
  },
  {
    slug: 'kafe',
    title: 'Kafe',
    emoji: '☕',
    moduleSlugs: ['qr-menu', 'pos-odeme', 'musteri-sadakat', 'stok-envanter', 'mutfak-ekrani-kds', 'entegrasyonlar'],
  },
  {
    slug: 'bar',
    title: 'Bar',
    emoji: '🍸',
    moduleSlugs: ['pos-odeme', 'masa-siparis', 'stok-envanter', 'personel', 'garson-cagri'],
  },
  {
    slug: 'pastane',
    title: 'Pastane & Fırın',
    emoji: '🥐',
    moduleSlugs: ['stok-envanter', 'qr-menu', 'pos-odeme', 'e-fatura', 'raporlar'],
  },
  {
    slug: 'fast-food',
    title: 'Fast Food',
    emoji: '🍟',
    moduleSlugs: ['qr-menu', 'mutfak-ekrani-kds', 'pos-odeme', 'garson-cagri', 'entegrasyonlar'],
  },
  {
    slug: 'pizza',
    title: 'Pizza',
    emoji: '🍕',
    moduleSlugs: ['entegrasyonlar', 'mutfak-ekrani-kds', 'qr-menu', 'stok-envanter', 'pos-odeme'],
  },
  {
    slug: 'burger',
    title: 'Burger',
    emoji: '🍔',
    moduleSlugs: ['pos-odeme', 'mutfak-ekrani-kds', 'qr-menu', 'entegrasyonlar', 'coklu-sube'],
  },
  {
    slug: 'subeli',
    title: 'Şubeli & Zincir',
    emoji: '🏙️',
    moduleSlugs: ['coklu-sube', 'raporlar', 'donanim', 'entegrasyonlar', 'personel'],
  },
  {
    slug: 'bulut-mutfak',
    title: 'Bulut Mutfak',
    emoji: '🛵',
    moduleSlugs: ['entegrasyonlar', 'mutfak-ekrani-kds', 'stok-envanter', 'raporlar'],
  },
];
