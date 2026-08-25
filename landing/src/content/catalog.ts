/**
 * Index metadata for the ported /tr/ozellikler and /tr/cozumler pages.
 *
 * `hasDeepDive` marks the slugs with real long-form copy in ./modules.ts. The
 * other eight modules only ever rendered a thin page derived from their own
 * tagline in the SPA, and a thin page is worse than no page: it competes with
 * the real ones for the same queries and gives a crawler nothing to rank. They
 * are listed on the index and link to the homepage section instead.
 */

export interface ModuleMeta {
  slug: string;
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
    title: 'QR Menü',
    tagline: 'Kağıt menü masrafına elveda.',
    hasDeepDive: true,
    redirectTo: '/qr-menu',
  },
  {
    slug: 'pos-odeme',
    title: 'POS & Ödeme',
    tagline: 'Saniyeler içinde satış, hesap ve ödeme.',
    hasDeepDive: true,
  },
  {
    slug: 'masa-siparis',
    title: 'Masa & Sipariş',
    tagline: 'Kat planında canlı masa yönetimi.',
    hasDeepDive: true,
  },
  {
    slug: 'rezervasyon',
    title: 'Rezervasyon',
    tagline: 'Boş masa kalmasın, çifte rezervasyon olmasın.',
    hasDeepDive: true,
  },
  {
    slug: 'garson-cagri',
    title: 'Garson Çağrı & Self-Pay',
    tagline: 'Masadan çağır, masadan öde.',
    hasDeepDive: true,
  },
  {
    slug: 'mutfak-ekrani-kds',
    title: 'Mutfak Ekranı (KDS)',
    tagline: 'Mutfakta sipariş kaosuna son.',
    hasDeepDive: true,
  },
  {
    slug: 'stok-envanter',
    title: 'Stok & Envanter',
    tagline: 'Reçeteyle otomatik stok düşümü.',
    hasDeepDive: true,
  },
  {
    slug: 'raporlar',
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
    title: 'Personel Yönetimi',
    tagline: 'Vardiya, mesai ve performans tek yerde.',
    hasDeepDive: true,
  },
  {
    slug: 'musteri-sadakat',
    title: 'Müşteri & Sadakat',
    tagline: 'Gelen müşteri geri gelsin.',
    hasDeepDive: true,
  },
  {
    slug: 'coklu-sube',
    title: 'Çoklu Şube',
    tagline: 'Tüm şubeler, tek hesap.',
    hasDeepDive: true,
  },
  {
    slug: 'entegrasyonlar',
    title: 'Entegrasyonlar',
    tagline: 'Tüm sipariş kanalları tek panelde.',
    hasDeepDive: true,
  },
  {
    slug: 'e-fatura',
    title: 'e-Fatura & e-Dönüşüm',
    tagline: 'Ödemeden faturaya kesintisiz.',
    hasDeepDive: true,
  },
  {
    slug: 'donanim',
    title: 'Donanım & Cihaz Ağı',
    tagline: 'Yazıcı, tablet ve cihazlar tek ağda.',
    hasDeepDive: true,
  },
  {
    slug: 'marketplace',
    title: 'Marketplace & Eklentiler',
    tagline: 'İhtiyacın kadar özellik, tek tıkla.',
    hasDeepDive: true,
  },
  {
    slug: 'guvenlik',
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
