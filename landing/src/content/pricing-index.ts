/**
 * Sourced price index for /tr/restoran-yazilimi-fiyatlari.
 *
 * WHY THIS EXISTS. Turkish restaurant-software comparisons routinely run to
 * thousands of words without a single ₺ figure, and the ones that do quote
 * numbers mix VAT-inclusive and VAT-exclusive prices without saying which is
 * which. A dated table where every row names its source and its VAT basis is a
 * position nobody in this market holds.
 *
 * RULES FOR EDITING. These are not style preferences; publishing a competitor's
 * price wrongly is a real harm and an easy lawsuit.
 *
 *   1. Every row is read off the vendor's own page. Never a blog, never a
 *      listicle, never a search-result snippet, never another comparison.
 *   2. `priceText` is what the page says, verbatim, including "+KDV" and any
 *      strike-through/discount framing.
 *   3. `vat` is never guessed. If the page does not state it, it is 'unstated'
 *      and the table says so in words.
 *   4. Foreign-currency prices stay in their currency. Converting them would
 *      bake in an exchange rate that is wrong within days and would make us the
 *      source of a number the vendor never published.
 *   5. `capturedAt` is the day the page was actually read.
 *
 * STALENESS. scripts/pricing-freshness.mjs fails the build when a row is older
 * than MAX_AGE_DAYS. A price index that silently rots is worse than none: it
 * keeps its authority while losing its accuracy.
 */

export const MAX_AGE_DAYS = 120;

export type VatBasis = 'included' | 'excluded' | 'unstated';
export type Period = 'monthly' | 'yearly' | 'one-time';

export interface PriceRow {
  vendor: string;
  plan: string;
  priceText: string;
  currency: 'TRY' | 'USD' | 'EUR';
  period: Period;
  vat: VatBasis;
  /** What the price does and does not cover, stated plainly. */
  note?: string;
  sourceUrl: string;
  capturedAt: string;
}

export const ROWS: PriceRow[] = [
  // ---------------------------------------------------------------- Adisyo
  {
    vendor: 'Adisyo',
    plan: 'Lite — yıllık peşin',
    priceText: 'Yıllık ₺12.500 + KDV',
    currency: 'TRY',
    period: 'yearly',
    vat: 'excluded',
    note: '1–3 personel. Adisyon ve masa yönetimi. QR menü bu pakete dahil değil; ayrı modül olarak ücretlendiriliyor.',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Adisyo',
    plan: 'Standart — yıllık peşin',
    priceText: 'Yıllık ₺18.500 + KDV',
    currency: 'TRY',
    period: 'yearly',
    vat: 'excluded',
    note: '4–7 personel. Sayfada "en çok tercih edilen" olarak işaretli. Mutfak ekranı bu pakette.',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Adisyo',
    plan: 'Pro — yıllık peşin',
    priceText: 'Yıllık ₺25.800 + KDV',
    currency: 'TRY',
    period: 'yearly',
    vat: 'excluded',
    note: 'Müşteri sadakat modülü ve otel entegrasyonu bu pakette.',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Adisyo',
    plan: 'Lite — aylık ödeme',
    priceText: '₺1.250/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'unstated',
    note: 'Aylık kartlarda KDV ifadesi yok; yıllık kartlarda "+ KDV" yazıyor. Sayfa aylık için bunu belirtmediğinden burada da belirtmiyoruz.',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Adisyo',
    plan: 'Ek modül — QR Menü Entegrasyonu',
    priceText: '+₺546/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'excluded',
    note: 'Paket ücretinin üstüne eklenir. QR menü hiçbir pakete dahil değil.',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Adisyo',
    plan: 'Ek modül — Paket Sipariş Entegrasyonları',
    priceText: '+₺225/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'excluded',
    note: 'Yemek platformu entegrasyonları. Paket ücretinin üstüne eklenir.',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Adisyo',
    plan: 'Ek modül — Yazar Kasa Entegrasyonu',
    priceText: '+₺565/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'excluded',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Adisyo',
    plan: 'Ek modül — Veri Aktarımı & API',
    priceText: '+₺565/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'excluded',
    note: 'API erişimi ayrı ücretli.',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Adisyo',
    plan: 'Ek modül — Kiosk Yazılımı',
    priceText: '+₺2.500/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'excluded',
    sourceUrl: 'https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari',
    capturedAt: '2026-08-25',
  },

  // ---------------------------------------------------------------- Simpra
  {
    vendor: 'Simpra',
    plan: 'Simpra POS — aylık (tek plan)',
    priceText: '1.550₺ +KDV',
    currency: 'TRY',
    period: 'monthly',
    vat: 'excluded',
    note: 'Kademe yok, tek plan. Aylık ve yıllık sekmelerin özellik listeleri birebir aynı.',
    sourceUrl: 'https://simprasuite.com.tr/restoran-otomasyonu/pos-sistemi/fiyatlar/',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Simpra',
    plan: 'Simpra POS — yıllık (tek plan)',
    priceText: '15.500₺ +KDV',
    currency: 'TRY',
    period: 'yearly',
    vat: 'excluded',
    note: 'Sayfada yıllık ödemede %16 indirim rozeti var.',
    sourceUrl: 'https://simprasuite.com.tr/restoran-otomasyonu/pos-sistemi/fiyatlar/',
    capturedAt: '2026-08-25',
  },

  // -------------------------------------------------------------- robotPOS
  {
    vendor: 'robotPOS',
    plan: 'air-POS — Ana Kullanıcı Lisansı',
    priceText: '$1.950 tek seferlik',
    currency: 'USD',
    period: 'one-time',
    vat: 'excluded',
    note: 'Terminal başına, tek seferlik lisans. Fiyatlar dolar cinsinden yayınlanıyor; kur riski alıcıda.',
    sourceUrl: 'https://www.robotpos.com/fiyatlandirma',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'robotPOS',
    plan: 'air-POS — Ek Kullanıcı Terminal Lisansı',
    priceText: '$750 tek seferlik',
    currency: 'USD',
    period: 'one-time',
    vat: 'excluded',
    note: 'Her ek terminal için ayrıca ödenir.',
    sourceUrl: 'https://www.robotpos.com/fiyatlandirma',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'robotPOS',
    plan: 'air-POS — KDS Terminal Lisansı',
    priceText: '$450 tek seferlik',
    currency: 'USD',
    period: 'one-time',
    vat: 'excluded',
    note: 'Mutfak ekranı lisansı; donanım dahil değil.',
    sourceUrl: 'https://www.robotpos.com/fiyatlandirma',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'robotPOS',
    plan: 'air inventory — aylık kullanım',
    priceText: '$45 şube/ay',
    currency: 'USD',
    period: 'monthly',
    vat: 'excluded',
    note: 'Şube başına aylık. Ayrıca "$250 tek seferlik" kurulum ve devreye alma bedeli var.',
    sourceUrl: 'https://www.robotpos.com/fiyatlandirma',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'robotPOS',
    plan: 'QR Menü — aylık kullanım',
    priceText: '$25 şube/ay',
    currency: 'USD',
    period: 'monthly',
    vat: 'excluded',
    note: 'Şube başına aylık.',
    sourceUrl: 'https://www.robotpos.com/fiyatlandirma',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'robotPOS',
    plan: 'Kiosk Menü — lisans',
    priceText: '$2.950 tek seferlik',
    currency: 'USD',
    period: 'one-time',
    vat: 'excluded',
    note: 'Ayrıca $15 şube/ay kullanım bedeli.',
    sourceUrl: 'https://www.robotpos.com/fiyatlandirma',
    capturedAt: '2026-08-25',
  },

  // --------------------------------------------------------------- Menulux
  {
    vendor: 'Menulux',
    plan: 'Web POS (bulut adisyon)',
    priceText: '750 ₺/ay — kampanyalı 525 ₺/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'unstated',
    note: 'Sayfada "başlayan fiyatlarla" ibaresi var; KDV durumu belirtilmemiş. Donanım ve kurulum dahil değil.',
    sourceUrl: 'https://www.menulux.com/restoran-otomasyonu/pos-sistemi/restoran-adisyon-programi#fiyatlar',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Menulux',
    plan: 'Premium POS (full-servis restoran)',
    priceText: '1500 ₺/ay — kampanyalı 1050 ₺/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'unstated',
    note: 'Donanım ve kurulum dahil değil.',
    sourceUrl: 'https://www.menulux.com/restoran-otomasyonu/pos-sistemi/restoran-adisyon-programi#fiyatlar',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Menulux',
    plan: 'QR Menü',
    priceText: '250 ₺/ay — kampanyalı 175 ₺/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'unstated',
    note: 'Bu üründe buton "Teklif Al"; nihai fiyat teklife bağlı.',
    sourceUrl: 'https://www.menulux.com/restoran-otomasyonu/dijital-menu/karekod-qr-menu#fiyatlar',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'Menulux',
    plan: 'Garson El Terminali',
    priceText: '250 ₺/ay — kampanyalı 175 ₺/ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'unstated',
    note: 'Ana POS lisansının üstüne eklenir; el terminali donanımı dahil değil.',
    sourceUrl: 'https://www.menulux.com/restoran-otomasyonu/pos-sistemi/restoran-adisyon-programi#fiyatlar',
    capturedAt: '2026-08-25',
  },

  // -------------------------------------------------------- Karekod Garson
  {
    vendor: 'Karekod Garson',
    plan: 'Standart Paket',
    priceText: '750₺ / Ay',
    currency: 'TRY',
    period: 'monthly',
    vat: 'unstated',
    note: 'Not: aynı sitenin Kullanım Şartları md. 5.1 abonelik ücretini "500 TL/ay (KDV dahil)" olarak yazıyor, kendi karşılaştırma aracı ise "Tüm Modüller" için ₺1.500/ay gösteriyor. Üç rakam da sitenin kendi sayfalarından; hangisinin güncel olduğunu satıcıya sormak gerekir.',
    sourceUrl: 'https://karekodgarson.com',
    capturedAt: '2026-08-25',
  },
];

/** Our own prices, from backend alacarte-catalog.const.ts. KDV dahildir. */
export const OURS: PriceRow[] = [
  {
    vendor: 'HummyTummy',
    plan: 'Çekirdek sistem (POS/adisyon, mutfak ekranı, menü, masa planı, QR menü, kasa, ekip)',
    priceText: '₺0',
    currency: 'TRY',
    period: 'yearly',
    vat: 'included',
    note: 'Süresiz ücretsiz. Ürün, kategori, masa, kullanıcı ve aylık sipariş sayısında sınır yok. Kredi kartı istenmez.',
    sourceUrl: 'https://landing.hummytummy.com/tr',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'HummyTummy',
    plan: 'Bakım, Destek ve Güncelleme (ücretli modülleri açan yıllık lisans)',
    priceText: '₺4.900/yıl',
    currency: 'TRY',
    period: 'yearly',
    vat: 'included',
    note: 'Yalnızca ücretli modül almak isteyenler için. Çekirdek sistem bu lisans olmadan da tam çalışır.',
    sourceUrl: 'https://landing.hummytummy.com/tr',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'HummyTummy',
    plan: 'Stok & Maliyet Yönetimi',
    priceText: '₺3.900/yıl',
    currency: 'TRY',
    period: 'yearly',
    vat: 'included',
    sourceUrl: 'https://landing.hummytummy.com/tr',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'HummyTummy',
    plan: 'Rezervasyon Sistemi',
    priceText: '₺990/yıl',
    currency: 'TRY',
    period: 'yearly',
    vat: 'included',
    sourceUrl: 'https://landing.hummytummy.com/tr',
    capturedAt: '2026-08-25',
  },
  {
    vendor: 'HummyTummy',
    plan: 'Ek Şube',
    priceText: '₺3.990/yıl',
    currency: 'TRY',
    period: 'yearly',
    vat: 'included',
    note: 'İlk şube ücretsizdir; bu bedel ikinci ve sonraki her şube içindir.',
    sourceUrl: 'https://landing.hummytummy.com/tr',
    capturedAt: '2026-08-25',
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Restoran adisyon programı fiyatları ne kadar?',
    a: '25 Ağustos 2026’da satıcıların kendi sayfalarından okunan yayınlanmış fiyatlar şöyle: Adisyo yıllık ₺12.500–₺25.800 + KDV, Simpra yıllık 15.500₺ + KDV, Menulux aylık 750–1.500 ₺ (KDV belirtilmemiş), robotPOS terminal başına tek seferlik $1.950 lisans artı modül başına aylık dolar bedeli. HummyTummy’de çekirdek sistem ücretsizdir; yalnızca ücretli modül alacaksanız ₺4.900/yıl KDV dahil lisans gerekir.',
  },
  {
    q: 'Bu fiyatlar KDV dahil mi?',
    a: 'Satıcıya göre değişiyor ve karşılaştırmayı en çok bozan nokta bu. Adisyo yıllık kartlarında ve Simpra fiyatlarında açıkça "+ KDV" yazıyor. Menulux ve Karekod Garson fiyat sayfalarında KDV durumunu belirtmiyor. HummyTummy fiyatları KDV dahildir. Tabloda her satırın hangi esasa göre yayınlandığını ayrıca yazdık; belirtilmemişse "belirtilmemiş" diyoruz, tahmin etmiyoruz.',
  },
  {
    q: 'Neden bazı fiyatlar dolar?',
    a: 'robotPOS fiyatlarını dolar cinsinden yayınlıyor. Bu rakamları liraya çevirmedik: çevirmek, satıcının hiç yayınlamadığı bir rakamı bize ait hâle getirir ve kur birkaç gün içinde değişir. Dolar fiyatlarda kur riski alıcıdadır.',
  },
  {
    q: 'QR menü fiyata dahil mi?',
    a: 'Satıcıya göre değişir. Adisyo’da QR menü hiçbir pakete dahil değil, +₺546/ay ek modül olarak satılıyor. robotPOS’ta $25 şube/ay. Menulux’ta 250 ₺/ay’dan başlıyor ve butonu "Teklif Al". HummyTummy’de QR menü çekirdeğin parçası ve ücretsizdir.',
  },
  {
    q: 'Bu liste ne sıklıkla güncelleniyor?',
    a: 'Her satırın yanında o fiyatın satıcının sayfasından okunduğu tarih yazıyor. Yayın sürecimiz, satırlar belirlenen tazelik penceresini aştığında derlemeyi durdurur; yani bu sayfa sessizce eskiyemez. Yine de nihai fiyat için satıcının kendi sayfasına bakın — bağlantılar tabloda.',
  },
];
