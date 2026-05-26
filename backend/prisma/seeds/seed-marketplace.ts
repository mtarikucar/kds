/**
 * Idempotent seed of marketplace add-ons, launch hardware SKUs, and
 * integration provider definitions.
 *
 * Run via `ts-node prisma/seeds/seed-marketplace.ts`. Safe to run multiple
 * times — every upsert is keyed on a stable code/sku/id, so re-running
 * refreshes prices and copy without creating duplicates.
 *
 * This is the **content** of the marketplace, deliberately separated from
 * the engine code. Tweaking prices, names, deps, or compatibility info is
 * a data change — no redeploy needed.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---- Add-on catalog ---------------------------------------------------

const ADDONS = [
  // Capacity
  {
    code: 'kds_extra_screen',
    name: 'Extra KDS screen',
    description: 'Adds one additional kitchen display screen slot to your branch.',
    kind: 'capacity',
    billing: 'recurring',
    priceCents: 9900,
    grants: { 'limit.kdsScreens': 1 },
    deps: [] as string[],
  },
  {
    code: 'kds_extra_station',
    name: 'Extra KDS station',
    description: 'Adds one routing station (bar / grill / dessert) on top of the default kitchen.',
    kind: 'capacity',
    billing: 'recurring',
    priceCents: 14900,
    grants: { 'limit.kdsStations': 1 },
    deps: [],
  },
  {
    code: 'extra_tablet',
    name: 'Extra waiter tablet',
    description: 'Increases your waiter-tablet seat limit by one.',
    kind: 'capacity',
    billing: 'recurring',
    priceCents: 7900,
    grants: { 'limit.tablets': 1 },
    deps: [],
  },
  {
    code: 'extra_branch',
    name: 'Extra branch',
    description: 'Adds one branch beyond your plan limit. Required for chains.',
    kind: 'capacity',
    billing: 'recurring',
    priceCents: 39900,
    grants: { 'limit.branches': 1, 'feature.multiLocation': true },
    deps: [],
  },
  // Integrations
  {
    code: 'fiscal_efatura',
    name: 'e-Fatura / e-Arşiv integration',
    description: 'Issue tax-compliant electronic invoices (cloud, no hardware required).',
    kind: 'integration',
    billing: 'recurring',
    priceCents: 19900,
    grants: { 'integration.fiscal': ['efatura'] },
    deps: [],
  },
  {
    code: 'fiscal_hugin',
    name: 'Hugin yazarkasa integration',
    description: 'Drive a Hugin fiscal device via the Local Bridge Agent.',
    kind: 'integration',
    billing: 'recurring',
    priceCents: 29900,
    grants: { 'integration.fiscal': ['hugin'] },
    deps: ['plan:PRO'],
  },
  {
    code: 'delivery_yemeksepeti',
    name: 'Yemeksepeti integration',
    description: 'Receive Yemeksepeti orders directly into your KDS.',
    kind: 'integration',
    billing: 'recurring',
    priceCents: 24900,
    grants: { 'integration.delivery': ['yemeksepeti'] },
    deps: [],
  },
  {
    code: 'delivery_getir',
    name: 'Getir Yemek integration',
    description: 'Receive Getir Yemek orders directly into your KDS.',
    kind: 'integration',
    billing: 'recurring',
    priceCents: 24900,
    grants: { 'integration.delivery': ['getir'] },
    deps: [],
  },
  {
    code: 'delivery_trendyol_yemek',
    name: 'Trendyol Yemek integration',
    description: 'Receive Trendyol Yemek orders directly into your KDS.',
    kind: 'integration',
    billing: 'recurring',
    priceCents: 24900,
    grants: { 'integration.delivery': ['trendyol_yemek'] },
    deps: [],
  },
  {
    code: 'caller_id_integration',
    name: 'Caller ID / phone-order integration',
    description: 'Open a customer card automatically on every inbound call.',
    kind: 'integration',
    billing: 'recurring',
    priceCents: 14900,
    grants: { 'feature.callerIntegration': true },
    deps: [],
  },
  // Software / features
  {
    code: 'advanced_reports',
    name: 'Advanced reports',
    description: 'Cohort analysis, custom reports, scheduled email delivery.',
    kind: 'software',
    billing: 'recurring',
    priceCents: 12900,
    grants: { 'feature.advancedReports': true },
    deps: [],
  },
  {
    code: 'api_access',
    name: 'API access',
    description: 'Public API key + outbound webhooks for your integrations.',
    kind: 'software',
    billing: 'recurring',
    priceCents: 24900,
    grants: { 'feature.apiAccess': true },
    deps: [],
  },
  // Support
  {
    code: 'priority_support',
    name: 'Priority support',
    description: '24-hour SLA on critical tickets. Direct line during business hours.',
    kind: 'support',
    billing: 'recurring',
    priceCents: 19900,
    grants: { 'feature.prioritySupport': true },
    deps: [],
  },
  {
    code: 'onsite_install_full',
    name: 'On-site setup (one-time)',
    description: 'A HummyTummy technician comes to your venue, installs the bridge + devices, and trains your staff.',
    kind: 'support',
    billing: 'oneTime',
    priceCents: 750_000,
    grants: {},   // no entitlement delta; just a service line
    deps: [],
  },
];

// ---- Launch hardware SKUs ---------------------------------------------
//
// Curated Türkiye-market catalog (Mayıs 2026). Prices are TRY street-price
// estimates from Akakce / Hepsiburada / Hugin official shop / Interpay /
// Desnet / official manufacturer pages — treat as B2C indicative, not
// distributor pricing. compat.sourceUrl points to a public reference page
// so customers can verify the device exists; compat.gibCertified marks
// YN ÖKC devices that appear on the GİB onay listesi (mandatory for
// retail/F&B in Türkiye, see https://ynokc.gib.gov.tr/Home/OnayAlanFirmalar/1003).
//
// Images intentionally empty for now — manufacturer hot-linking is fragile
// and copyright-grey. The store UI gracefully handles empty arrays
// (category-name fallback card). Replace with own-CDN URLs in a follow-up
// once we have permission/uploads in place.

const PRODUCTS = [
  // ── Yeni Nesil Yazarkasa POS (YN ÖKC — GİB onaylı) ───────────────────
  {
    sku: 'yazarkasa-hugin-tiger-t300',
    category: 'yazarkasa',
    name: 'Hugin Tiger T300 4G',
    brand: 'Hugin',
    model: 'Tiger T300',
    description:
      'GİB onaylı, 4G mobil yeni nesil yazarkasa POS. Tek elle kullanım için 360g hafif, kebap/cafe gibi paket-servis ağırlıklı işletmelerde yaygın. Aktivasyon yetkili bayi kanalı üzerinden yapılır.',
    compat: {
      requiredAddOn: ['fiscal_hugin'],
      gibCertified: true,
      sourceUrl: 'https://shop.hugin.com.tr/urun/tiger-t300',
    },
    priceCents: 640_000,
    warrantyMonths: 24,
    images: [] as string[],
    stockStatus: 'in_stock',
  },
  {
    sku: 'yazarkasa-beko-300tr',
    category: 'yazarkasa',
    name: 'Beko 300TR Temassız Android',
    brand: 'Beko',
    model: '300TR',
    description:
      'GİB onaylı, 5" dokunmatik Android yeni nesil yazarkasa POS. WiFi + 4G dahili SIM. Pay-at-table senaryosu ve yazılım entegrasyonu için ideal.',
    compat: {
      gibCertified: true,
      sourceUrl: 'https://www.beko.com.tr/yazar-kasa-pos/300-tr-temassiz-odeme-sistemleri',
    },
    priceCents: 650_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'yazarkasa-ingenico-move5000f',
    category: 'yazarkasa',
    name: 'Ingenico Move/5000F',
    brand: 'Ingenico',
    model: 'Move/5000F',
    description:
      'GİB onaylı, premium mobil yeni nesil yazarkasa POS. 4G + Ethernet + WiFi + entegre termal printer; EMV L1/L2 + PCI PTS 5.x sertifikalı. Yüksek hacimli restoran/cafe için.',
    compat: {
      gibCertified: true,
      sourceUrl: 'https://shop.interpay.com.tr/Product/SingleProduct/?id=1004',
    },
    priceCents: 1_900_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },

  // ── Termal Fiş Yazıcılar ─────────────────────────────────────────────
  {
    sku: 'printer-epson-tm-t20iii-lan',
    category: 'printer',
    name: 'Epson TM-T20III (LAN)',
    brand: 'Epson',
    model: 'TM-T20III',
    description:
      '80mm ESC/POS termal fiş yazıcısı, auto-cutter, LAN bağlantı. SambaPOS / Simpra / RestApp gibi POS yazılımlarıyla uyumlu. Standart counter printer.',
    compat: {
      sourceUrl:
        'https://www.epson.com.tr/%C3%9Cr%C3%BCnler/perakende/pos-yaz%C4%B1c%C4%B1lar/pc-pos-printers/epson-tm-t20iii-series/p/28271',
    },
    priceCents: 450_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'printer-epson-tm-t88vi-eth',
    category: 'printer',
    name: 'Epson TM-T88VI (Ethernet)',
    brand: 'Epson',
    model: 'TM-T88VI',
    description:
      'Premium 80mm termal yazıcı, otomatik kesici, network-resilient. Yoğun mutfak/bar ortamları için tasarlandı — istasyon başı bir adet yerleştirme önerilir.',
    compat: {
      sourceUrl: 'https://www.barkomatik.com/epson-tm-t88vi-112-termal-fis-yazici-3-port-7315.html',
    },
    priceCents: 900_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'printer-star-tsp143iiibi',
    category: 'printer',
    name: 'Star TSP143IIIBI (Bluetooth)',
    brand: 'Star Micronics',
    model: 'TSP143IIIBI',
    description:
      'BLE eşleştirmeli 80mm termal yazıcı. iPad veya Android tabanlı POS sistemlerinde Ethernet çekmek pratik olmayan yerlerde tercih edilir.',
    compat: {
      sourceUrl: 'https://www.meltas-tedarik.com/star-micronics/tsp-100/3698964',
    },
    priceCents: 650_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },

  // ── KDS Ekranları ────────────────────────────────────────────────────
  {
    sku: 'kds-sunmi-d2s',
    category: 'kds_screen',
    name: 'Sunmi D2s KDS (15.6" PoE Android)',
    brand: 'Sunmi',
    model: 'D2s',
    description:
      'Mutfak ekranı olarak özel tasarlanmış 15.6" PoE Android cihaz. HummyTummy KDS uygulaması ile uyumlu, Türkiye distribütörü Noyatech.',
    compat: {
      sourceUrl: 'https://noyatech.com/marka/sunmi/',
    },
    priceCents: 1_500_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'kds-penetek-15in-ip65',
    category: 'kds_screen',
    name: 'PENETEK 15.6" IP65 Restaurant Panel PC',
    brand: 'PENETEK',
    model: 'P3224-M82',
    description:
      'IP65 koruma sınıfı (buhar/sıvı temasına dayanıklı) panel PC, mutfak ortamı için Türkiye üretimi. Yüksek dayanıklılık gereken kebap/grill restoranlarında tercih edilir.',
    compat: {
      sourceUrl: 'https://www.penetek.com/tr/product/kitchen-display-panel-pc_P3224-M82.html',
    },
    priceCents: 2_200_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },

  // ── Garson / Müşteri Tabletleri ──────────────────────────────────────
  {
    sku: 'tablet-sunmi-v2-pro',
    category: 'tablet',
    name: 'Sunmi V2 Pro (yazıcılı handheld POS)',
    brand: 'Sunmi',
    model: 'V2 Pro',
    description:
      '5.99" Android handheld POS, dahili 58mm termal yazıcı. Garson el terminali olarak kullanılır; sipariş + adisyon kesimi tek cihazdan.',
    compat: {
      sourceUrl: 'https://www.desnet.com.tr/urun/sunmi-v2-pro-yazicili-android-el-terminali/',
    },
    priceCents: 1_400_000,
    warrantyMonths: 12,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'tablet-samsung-tab-a9-plus',
    category: 'tablet',
    name: 'Samsung Galaxy Tab A9+ 11"',
    brand: 'Samsung',
    model: 'SM-X216',
    description:
      'Müşteri menüsü veya basit sipariş alımı için 11" Android tablet. Vatan/MediaMarkt/Trendyol kanallarından bol; ekonomik seçenek.',
    compat: { sourceUrl: 'https://www.samsung.com/tr/tablets/galaxy-tab-a/' },
    priceCents: 1_100_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },

  // ── Barkod Okuyucu ───────────────────────────────────────────────────
  {
    sku: 'scanner-honeywell-voyager-1450g',
    category: 'scanner',
    name: 'Honeywell Voyager 1450g (1D/2D USB)',
    brand: 'Honeywell',
    model: '1450g',
    description:
      'Kablolu USB 2D barkod okuyucu, counter + paketli ürün okutma için piyasanın standart cihazı. Telefon ekranındaki QR kodları da okur.',
    compat: { sourceUrl: 'https://www.akbarkod.com.tr/urun/honeywell-1450g-2d' },
    priceCents: 350_000,
    warrantyMonths: 12,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'scanner-zebra-ds2208',
    category: 'scanner',
    name: 'Zebra DS2208 (1D/2D USB)',
    brand: 'Zebra',
    model: 'DS2208',
    description:
      'Premium 2D barkod okuyucu, hasarlı/silik barkodları ve telefon ekranındaki QR kodları rahat okur. Yoğun retail/F&B counter\'ları için.',
    compat: { sourceUrl: 'https://www.trendbarkod.com.tr/zebra-ds2208-2d-kablolu-barkod-okuyucu' },
    priceCents: 350_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },

  // ── Caller ID (Arayan Numara) ────────────────────────────────────────
  {
    sku: 'caller-id-cidshow-cid602',
    category: 'caller_id',
    name: 'Cidshow CID602 (2-hat Caller ID)',
    brand: 'Cidshow',
    model: 'CID602',
    description:
      '2 PSTN hat, USB Caller ID kutusu. Telefon çaldığında müşteri kaydını otomatik açar — paket-servis (pizza/kebap/pide) için kritik. Stack edilerek 4 hatta çıkar.',
    compat: {
      requiredAddOn: ['caller_id_integration'],
      sourceUrl: 'https://www.hepsiburada.com/cidshow-cid602-2-hatli-caller-id-pm-telatilimcid602',
    },
    priceCents: 40_000,
    warrantyMonths: 12,
    images: [],
    stockStatus: 'in_stock',
  },

  // ── Para Çekmecesi ───────────────────────────────────────────────────
  {
    sku: 'cash-drawer-afanda-lb405k',
    category: 'cash_drawer',
    name: 'AFANDA LB-405K Para Çekmecesi',
    brand: 'AFANDA',
    model: 'LB-405K',
    description:
      '5 banknot + 5 madeni para bölmesi, RJ11 12V drawer kick portu. Termal yazıcının drawer-kick çıkışından açılır; ayrı güç/data kablosu istemez.',
    compat: {
      sourceUrl:
        'https://www.trendyol.com/pd/afanda/para-cekmecesi-5-bolmeli-lb-405k-cash-drawer-rj11-12v-siyah-p-300322413',
    },
    priceCents: 150_000,
    warrantyMonths: 12,
    images: [],
    stockStatus: 'in_stock',
  },

  // ── Network Bridge (HummyTummy kendi cihazı) ─────────────────────────
  {
    sku: 'hummybox-lite',
    category: 'bridge',
    name: 'HummyBox Lite',
    brand: 'HummyTummy',
    model: 'BOX-LITE-01',
    description:
      'HummyTummy Local Bridge Agent önyüklü mini-PC. 4GB RAM, 64GB SSD, fanless. Yazarkasa + printer + caller-ID donanımını buluta bağlar; offline çalışır.',
    compat: { sourceUrl: 'https://hummytummy.com/landing' },
    priceCents: 480_000,
    rentalMonthlyCents: 9_900,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'hummybox-pro',
    category: 'bridge',
    name: 'HummyBox Pro',
    brand: 'HummyTummy',
    model: 'BOX-PRO-01',
    description:
      'Yüksek hacim için: dahili UPS + dual-LAN failover. Elektrik/internet kesintilerinde işin durmaması gereken çok şubeli işletmeler için.',
    compat: { sourceUrl: 'https://hummytummy.com/landing' },
    priceCents: 950_000,
    rentalMonthlyCents: 19_900,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
];

// ---- Integration providers --------------------------------------------

const PROVIDERS = [
  { id: 'efatura', kind: 'fiscal', name: 'e-Fatura / e-Arşiv', description: 'Cloud-side electronic invoicing.' },
  { id: 'hugin', kind: 'fiscal', name: 'Hugin Yazarkasa', description: 'Yazarkasa via Local Bridge.' },
  { id: 'beko', kind: 'fiscal', name: 'Beko Yazarkasa', description: 'Yazarkasa via Local Bridge.' },
  { id: 'iyzico', kind: 'payment', name: 'Iyzico', description: 'Card-not-present payment provider.' },
  { id: 'paytr', kind: 'payment', name: 'PayTR', description: 'TR iframe-based payment provider.' },
  { id: 'stripe', kind: 'payment', name: 'Stripe', description: 'International payments.' },
  { id: 'yemeksepeti', kind: 'delivery', name: 'Yemeksepeti', description: 'Receive Yemeksepeti orders.' },
  { id: 'getir', kind: 'delivery', name: 'Getir Yemek', description: 'Receive Getir Yemek orders.' },
  { id: 'trendyol_yemek', kind: 'delivery', name: 'Trendyol Yemek', description: 'Receive Trendyol Yemek orders.' },
  { id: 'twilio', kind: 'voip', name: 'Twilio Voice', description: 'Cloud VoIP / caller ID.' },
  { id: 'verimor', kind: 'voip', name: 'Verimor', description: 'TR-region VoIP provider.' },
  { id: 'netgsm', kind: 'sms', name: 'Netgsm', description: 'TR-region SMS provider.' },
];

async function main() {
  console.log('[seed-marketplace] starting');

  for (const a of ADDONS) {
    await prisma.marketplaceAddOn.upsert({
      where: { code: a.code },
      update: {
        name: a.name,
        description: a.description,
        kind: a.kind,
        billing: a.billing,
        priceCents: a.priceCents,
        grants: a.grants as any,
        deps: a.deps,
        status: 'published',
      },
      create: {
        code: a.code,
        name: a.name,
        description: a.description,
        kind: a.kind,
        billing: a.billing,
        priceCents: a.priceCents,
        grants: a.grants as any,
        deps: a.deps,
        status: 'published',
      },
    });
  }
  console.log(`[seed-marketplace] add-ons: ${ADDONS.length}`);

  for (const p of PRODUCTS) {
    const product = await prisma.hardwareProduct.upsert({
      where: { sku: p.sku },
      update: {
        category: p.category,
        name: p.name,
        brand: p.brand,
        model: p.model,
        description: p.description,
        priceCents: p.priceCents,
        rentalMonthlyCents: (p as any).rentalMonthlyCents ?? null,
        warrantyMonths: p.warrantyMonths,
        images: p.images,
        stockStatus: p.stockStatus,
        compat: (p as any).compat ?? null,
        status: 'published',
      },
      create: {
        sku: p.sku,
        category: p.category,
        name: p.name,
        brand: p.brand,
        model: p.model,
        description: p.description,
        priceCents: p.priceCents,
        rentalMonthlyCents: (p as any).rentalMonthlyCents ?? null,
        warrantyMonths: p.warrantyMonths,
        images: p.images,
        stockStatus: p.stockStatus,
        compat: (p as any).compat ?? null,
        status: 'published',
      },
    });
    // Ensure inventory row exists.
    await prisma.hardwareInventory.upsert({
      where: { productId: product.id },
      update: {},
      create: { productId: product.id },
    });
  }
  console.log(`[seed-marketplace] hardware SKUs: ${PRODUCTS.length}`);

  for (const ip of PROVIDERS) {
    await prisma.integrationProviderDef.upsert({
      where: { id: ip.id },
      update: {
        kind: ip.kind,
        name: ip.name,
        description: ip.description,
        configSchema: {} as any,
        isOfficial: true,
        status: 'published',
      },
      create: {
        id: ip.id,
        kind: ip.kind,
        name: ip.name,
        description: ip.description,
        configSchema: {} as any,
        isOfficial: true,
        status: 'published',
      },
    });
  }
  console.log(`[seed-marketplace] integration providers: ${PROVIDERS.length}`);

  console.log('[seed-marketplace] done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
