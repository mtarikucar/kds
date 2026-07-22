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
import { PrismaClient } from "@prisma/client";
// Single source of truth for the regulatory tier-by-category policy — shared
// with CatalogService so seeded rows and admin-created rows can't drift.
import { CATEGORY_DEFAULT_SALE_MODE } from "../../src/modules/catalog/dto/create-hardware-product.dto";

const prisma = new PrismaClient();

// Minimal seller-responsibility docs stamped on seeded DIRECT_SALE rows so
// (a) the storefront "Yasal & Garanti" tab isn't empty and (b) a later admin
// edit doesn't hit the publish gate (which requires complianceDocs for
// DIRECT_SALE).
//
// Task 11 — this used to also carry `warrantyCertUrl`/`returnTermsUrl`
// pointing at "/docs/*.pdf" files that were never actually uploaded anywhere
// (dead links) and a `serviceInfo` string with a fabricated support line
// ("0850 000 00 00") — all three rendered, unfiltered, to real tenants on
// the product detail page's "Yasal & Garanti" tab. Removed rather than
// replaced with different placeholders. `invoiceIssued: true` is a real
// business fact (invoices ARE issued through the accounting module) and
// alone still satisfies CatalogService.hasComplianceDocs (>=1 non-empty
// value), so the DIRECT_SALE publish gate stays satisfied. Reversible data
// migration 20260722160000_hardware_drop_fake_compliance_placeholders backs
// this out for already-seeded rows (round-trip verified).
export const SEED_DEFAULT_COMPLIANCE = {
  invoiceIssued: true,
};

// ---- Add-on catalog ---------------------------------------------------
//
// Exported so tests can assert catalog invariants (e.g. every
// `kind:'integration'` add-on must grant an `integration.*` key) without
// executing the seed. The `main()` invocation at the bottom is guarded by
// `require.main === module` so importing this file has no side effects.

export const ADDONS = [
  // Capacity
  {
    code: "kds_extra_screen",
    name: "Extra KDS screen",
    description:
      "Adds one additional kitchen display screen slot to your branch.",
    kind: "capacity",
    billing: "recurring",
    priceCents: 9900,
    grants: { "limit.kdsScreens": 1 },
    deps: [] as string[],
  },
  {
    code: "kds_extra_station",
    name: "Extra KDS station",
    description:
      "Adds one routing station (bar / grill / dessert) on top of the default kitchen.",
    kind: "capacity",
    billing: "recurring",
    priceCents: 14900,
    grants: { "limit.kdsStations": 1 },
    deps: [],
  },
  {
    code: "extra_tablet",
    name: "Extra waiter tablet",
    description: "Increases your waiter-tablet seat limit by one.",
    kind: "capacity",
    billing: "recurring",
    priceCents: 7900,
    grants: { "limit.tablets": 1 },
    deps: [],
  },
  {
    code: "extra_branch",
    name: "Extra branch",
    description: "Adds one branch beyond your plan limit. Required for chains.",
    kind: "capacity",
    billing: "recurring",
    priceCents: 39900,
    grants: { "limit.maxBranches": 1, "feature.multiLocation": true },
    deps: [],
  },
  // Integrations
  {
    code: "fiscal_efatura",
    name: "e-Fatura / e-Arşiv integration",
    description:
      "Issue tax-compliant electronic invoices (cloud, no hardware required).",
    kind: "integration",
    billing: "recurring",
    priceCents: 19900,
    grants: { "integration.fiscal": ["efatura"] },
    deps: [],
  },
  {
    code: "fiscal_hugin",
    name: "Hugin yazarkasa integration",
    description: "Drive a Hugin fiscal device via the Local Bridge Agent.",
    kind: "integration",
    billing: "recurring",
    priceCents: 29900,
    grants: { "integration.fiscal": ["hugin"] },
    deps: ["plan:PRO"],
  },
  {
    code: "delivery_yemeksepeti",
    name: "Yemeksepeti integration",
    description: "Receive Yemeksepeti orders directly into your KDS.",
    kind: "integration",
    billing: "recurring",
    priceCents: 24900,
    grants: { "integration.delivery": ["yemeksepeti"] },
    deps: [],
  },
  {
    code: "delivery_getir",
    name: "Getir Yemek integration",
    description: "Receive Getir Yemek orders directly into your KDS.",
    kind: "integration",
    billing: "recurring",
    priceCents: 24900,
    grants: { "integration.delivery": ["getir"] },
    deps: [],
  },
  {
    code: "delivery_trendyol_yemek",
    name: "Trendyol Yemek integration",
    description: "Receive Trendyol Yemek orders directly into your KDS.",
    kind: "integration",
    billing: "recurring",
    priceCents: 24900,
    grants: { "integration.delivery": ["trendyol_yemek"] },
    deps: [],
  },
  {
    code: "caller_id_integration",
    name: "Caller ID / phone-order integration",
    description: "Open a customer card automatically on every inbound call.",
    kind: "integration",
    billing: "recurring",
    priceCents: 14900,
    // The caller feed is gated as an INTEGRATION on every surface: the
    // frontend route + sidebar use FeatureGate integration={{domain:'caller'}}
    // and the backend endpoint uses @RequiresIntegration('caller') — all three
    // resolve the engine key `integration.caller`. A `feature.*` grant here
    // satisfied none of them, so buying the add-on unlocked nothing (feed
    // stayed 403 + nav hidden behind the upsell). Grant the integration vendor
    // list instead, mirroring the delivery add-ons (`integration.delivery`).
    grants: { "integration.caller": ["generic"] },
    deps: [],
  },
  // Software / features
  {
    code: "advanced_reports",
    name: "Advanced reports",
    description: "Cohort analysis, custom reports, scheduled email delivery.",
    kind: "software",
    billing: "recurring",
    priceCents: 12900,
    grants: { "feature.advancedReports": true },
    deps: [],
  },
  {
    code: "api_access",
    name: "API access",
    description: "Public API key + outbound webhooks for your integrations.",
    kind: "software",
    billing: "recurring",
    priceCents: 24900,
    grants: { "feature.apiAccess": true },
    deps: [],
  },
  // Support
  {
    code: "priority_support",
    name: "Priority support",
    description:
      "24-hour SLA on critical tickets. Direct line during business hours.",
    kind: "support",
    billing: "recurring",
    priceCents: 19900,
    grants: { "feature.prioritySupport": true },
    deps: [],
  },
  {
    code: "onsite_install_full",
    name: "On-site setup (one-time)",
    description:
      "A HummyTummy technician comes to your venue, installs the bridge + devices, and trains your staff.",
    kind: "support",
    billing: "oneTime",
    priceCents: 750_000,
    grants: {}, // no entitlement delta; just a service line
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

export const PRODUCTS = [
  // ── Yeni Nesil Yazarkasa POS (YN ÖKC — GİB onaylı) ───────────────────
  {
    sku: "yazarkasa-hugin-tiger-t300",
    category: "yazarkasa",
    name: "Hugin Tiger T300 4G",
    brand: "Hugin",
    model: "Tiger T300",
    description:
      "GİB onaylı, 4G mobil yeni nesil yazarkasa POS. Tek elle kullanım için 360g hafif, kebap/cafe gibi paket-servis ağırlıklı işletmelerde yaygın. Aktivasyon yetkili bayi kanalı üzerinden yapılır.",
    compat: {
      requiredAddOn: ["fiscal_hugin"],
      gibCertified: true,
      sourceUrl: "https://shop.hugin.com.tr/urun/tiger-t300",
    },
    priceCents: 640_000,
    warrantyMonths: 24,
    images: ["/products/yazarkasa-hugin-tiger-t300.webp"],
    stockStatus: "in_stock",
  },
  {
    sku: "yazarkasa-beko-300tr",
    category: "yazarkasa",
    name: "Beko 300TR Temassız Android",
    brand: "Beko",
    model: "300TR",
    description:
      'GİB onaylı, 5" dokunmatik Android yeni nesil yazarkasa POS. WiFi + 4G dahili SIM. Pay-at-table senaryosu ve yazılım entegrasyonu için ideal.',
    compat: {
      gibCertified: true,
      sourceUrl:
        "https://www.beko.com.tr/yazar-kasa-pos/300-tr-temassiz-odeme-sistemleri",
    },
    priceCents: 650_000,
    warrantyMonths: 24,
    images: ["/products/yazarkasa-beko-300tr.webp"],
    stockStatus: "in_stock",
  },
  // ── Banka POS Terminali (Tier 2 — PARTNER_REDIRECT) ──────────────────
  //
  // Task 11 — moved out of the "Yeni Nesil Yazarkasa POS" section above.
  // Ingenico Move/5000F is a bank/PSP card-payment terminal (EMV L1/L2 +
  // PCI PTS 5.x acquiring device), not a YN ÖKC fiscal cash register — it
  // was previously seeded with category:'yazarkasa', which defaulted it to
  // saleMode:QUOTE_ONLY (the fiscal-dealer tier) instead of the correct
  // saleMode:PARTNER_REDIRECT (bank/PSP tier — see CATEGORY_DEFAULT_SALE_MODE
  // in create-hardware-product.dto.ts). `compat.gibCertified` is dropped for
  // the same reason: GİB's YN ÖKC onay listesi doesn't apply to a bank POS
  // terminal, so the badge was a false claim. Reversible data migration
  // 20260722150000_hardware_recategorize_ingenico_pos_terminal backfills
  // this on already-seeded rows (round-trip verified). SKU keeps its
  // original "yazarkasa-…" prefix — renaming it would ripple into
  // HARDWARE_DETAILS' key, historical order lines, and cart/quote
  // references for no functional benefit.
  {
    sku: "yazarkasa-ingenico-move5000f",
    category: "pos_terminal",
    name: "Ingenico Move/5000F",
    brand: "Ingenico",
    model: "Move/5000F",
    description:
      "Premium mobil banka POS terminali. 4G + Ethernet + WiFi + entegre termal printer; EMV L1/L2 + PCI PTS 5.x sertifikalı. Yüksek hacimli restoran/cafe için.",
    compat: {
      sourceUrl: "https://shop.interpay.com.tr/Product/SingleProduct/?id=1004",
    },
    priceCents: 1_900_000,
    warrantyMonths: 24,
    images: ["/products/yazarkasa-ingenico-move5000f.webp"],
    stockStatus: "in_stock",
  },

  // ── Termal Fiş Yazıcılar ─────────────────────────────────────────────
  {
    sku: "printer-epson-tm-t20iii-lan",
    category: "printer",
    name: "Epson TM-T20III (LAN)",
    brand: "Epson",
    model: "TM-T20III",
    description:
      "80mm ESC/POS termal fiş yazıcısı, auto-cutter, LAN bağlantı. SambaPOS / Simpra / RestApp gibi POS yazılımlarıyla uyumlu. Standart counter printer.",
    compat: {
      sourceUrl:
        "https://www.epson.com.tr/%C3%9Cr%C3%BCnler/perakende/pos-yaz%C4%B1c%C4%B1lar/pc-pos-printers/epson-tm-t20iii-series/p/28271",
    },
    priceCents: 450_000,
    warrantyMonths: 24,
    images: ["/products/printer-epson-tm-t20iii-lan.webp"],
    stockStatus: "in_stock",
  },
  {
    sku: "printer-epson-tm-t88vi-eth",
    category: "printer",
    name: "Epson TM-T88VI (Ethernet)",
    brand: "Epson",
    model: "TM-T88VI",
    description:
      "Premium 80mm termal yazıcı, otomatik kesici, network-resilient. Yoğun mutfak/bar ortamları için tasarlandı — istasyon başı bir adet yerleştirme önerilir.",
    compat: {
      sourceUrl:
        "https://www.barkomatik.com/epson-tm-t88vi-112-termal-fis-yazici-3-port-7315.html",
    },
    priceCents: 900_000,
    warrantyMonths: 24,
    images: ["/products/printer-epson-tm-t88vi-eth.webp"],
    stockStatus: "in_stock",
  },
  {
    sku: "printer-star-tsp143iiibi",
    category: "printer",
    name: "Star TSP143IIIBI (Bluetooth)",
    brand: "Star Micronics",
    model: "TSP143IIIBI",
    description:
      "BLE eşleştirmeli 80mm termal yazıcı. iPad veya Android tabanlı POS sistemlerinde Ethernet çekmek pratik olmayan yerlerde tercih edilir.",
    compat: {
      sourceUrl:
        "https://www.meltas-tedarik.com/star-micronics/tsp-100/3698964",
    },
    priceCents: 650_000,
    warrantyMonths: 24,
    images: ["/products/printer-star-tsp143iiibi.webp"],
    stockStatus: "in_stock",
  },

  // ── KDS Ekranları ────────────────────────────────────────────────────
  {
    sku: "kds-sunmi-d2s",
    category: "kds_screen",
    name: 'Sunmi D2s KDS (15.6" PoE Android)',
    brand: "Sunmi",
    model: "D2s",
    description:
      'Mutfak ekranı olarak özel tasarlanmış 15.6" PoE Android cihaz. HummyTummy KDS uygulaması ile uyumlu, Türkiye distribütörü Noyatech.',
    compat: {
      sourceUrl: "https://noyatech.com/marka/sunmi/",
    },
    priceCents: 1_500_000,
    warrantyMonths: 24,
    images: ["/products/kds-sunmi-d2s.webp"],
    stockStatus: "in_stock",
  },
  {
    sku: "kds-penetek-15in-ip65",
    category: "kds_screen",
    name: 'PENETEK 15.6" IP65 Restaurant Panel PC',
    brand: "PENETEK",
    model: "P3224-M82",
    description:
      "IP65 koruma sınıfı (buhar/sıvı temasına dayanıklı) panel PC, mutfak ortamı için Türkiye üretimi. Yüksek dayanıklılık gereken kebap/grill restoranlarında tercih edilir.",
    compat: {
      sourceUrl:
        "https://www.penetek.com/tr/product/kitchen-display-panel-pc_P3224-M82.html",
    },
    priceCents: 2_200_000,
    warrantyMonths: 24,
    images: ["/products/kds-penetek-15in-ip65.webp"],
    stockStatus: "in_stock",
  },

  // ── Garson / Müşteri Tabletleri ──────────────────────────────────────
  {
    sku: "tablet-sunmi-v2-pro",
    category: "tablet",
    name: "Sunmi V2 Pro (yazıcılı handheld POS)",
    brand: "Sunmi",
    model: "V2 Pro",
    description:
      '5.99" Android handheld POS, dahili 58mm termal yazıcı. Garson el terminali olarak kullanılır; sipariş + adisyon kesimi tek cihazdan.',
    compat: {
      sourceUrl:
        "https://www.desnet.com.tr/urun/sunmi-v2-pro-yazicili-android-el-terminali/",
    },
    priceCents: 1_400_000,
    warrantyMonths: 12,
    images: ["/products/tablet-sunmi-v2-pro.webp"],
    stockStatus: "in_stock",
  },
  {
    sku: "tablet-samsung-tab-a9-plus",
    category: "tablet",
    name: 'Samsung Galaxy Tab A9+ 11"',
    brand: "Samsung",
    model: "SM-X216",
    description:
      'Müşteri menüsü veya basit sipariş alımı için 11" Android tablet. Vatan/MediaMarkt/Trendyol kanallarından bol; ekonomik seçenek.',
    compat: { sourceUrl: "https://www.samsung.com/tr/tablets/galaxy-tab-a/" },
    priceCents: 1_100_000,
    warrantyMonths: 24,
    images: ["/products/tablet-samsung-tab-a9-plus.webp"],
    stockStatus: "in_stock",
  },

  // ── Barkod Okuyucu ───────────────────────────────────────────────────
  {
    sku: "scanner-honeywell-voyager-1450g",
    category: "scanner",
    name: "Honeywell Voyager 1450g (1D/2D USB)",
    brand: "Honeywell",
    model: "1450g",
    description:
      "Kablolu USB 2D barkod okuyucu, counter + paketli ürün okutma için piyasanın standart cihazı. Telefon ekranındaki QR kodları da okur.",
    compat: {
      sourceUrl: "https://www.akbarkod.com.tr/urun/honeywell-1450g-2d",
    },
    priceCents: 350_000,
    warrantyMonths: 12,
    images: ["/products/scanner-honeywell-voyager-1450g.webp"],
    stockStatus: "in_stock",
  },
  {
    sku: "scanner-zebra-ds2208",
    category: "scanner",
    name: "Zebra DS2208 (1D/2D USB)",
    brand: "Zebra",
    model: "DS2208",
    description:
      "Premium 2D barkod okuyucu, hasarlı/silik barkodları ve telefon ekranındaki QR kodları rahat okur. Yoğun retail/F&B counter'ları için.",
    compat: {
      sourceUrl:
        "https://www.trendbarkod.com.tr/zebra-ds2208-2d-kablolu-barkod-okuyucu",
    },
    priceCents: 350_000,
    warrantyMonths: 24,
    images: ["/products/scanner-zebra-ds2208.webp"],
    stockStatus: "in_stock",
  },

  // ── Caller ID (Arayan Numara) ────────────────────────────────────────
  {
    sku: "caller-id-cidshow-cid602",
    category: "caller_id",
    name: "Cidshow CID602 (2-hat Caller ID)",
    brand: "Cidshow",
    model: "CID602",
    description:
      "2 PSTN hat, USB Caller ID kutusu. Telefon çaldığında müşteri kaydını otomatik açar — paket-servis (pizza/kebap/pide) için kritik. Stack edilerek 4 hatta çıkar.",
    compat: {
      requiredAddOn: ["caller_id_integration"],
      sourceUrl:
        "https://www.hepsiburada.com/cidshow-cid602-2-hatli-caller-id-pm-telatilimcid602",
    },
    priceCents: 40_000,
    warrantyMonths: 12,
    images: ["/products/caller-id-cidshow-cid602.webp"],
    stockStatus: "in_stock",
  },

  // ── Para Çekmecesi ───────────────────────────────────────────────────
  {
    sku: "cash-drawer-afanda-lb405k",
    category: "cash_drawer",
    name: "AFANDA LB-405K Para Çekmecesi",
    brand: "AFANDA",
    model: "LB-405K",
    description:
      "5 banknot + 5 madeni para bölmesi, RJ11 12V drawer kick portu. Termal yazıcının drawer-kick çıkışından açılır; ayrı güç/data kablosu istemez.",
    compat: {
      sourceUrl:
        "https://www.trendyol.com/pd/afanda/para-cekmecesi-5-bolmeli-lb-405k-cash-drawer-rj11-12v-siyah-p-300322413",
    },
    priceCents: 150_000,
    warrantyMonths: 12,
    images: ["/products/cash-drawer-afanda-lb405k.webp"],
    stockStatus: "in_stock",
  },

  // ── Network Bridge (HummyTummy kendi cihazı) ─────────────────────────
  //
  // Task 11 — rentalMonthlyCents REMOVED (was 9_900 / 19_900). Approved
  // decision: PayTR only supports one-time charges, so there was no
  // monthly-billing rail behind "rent" — a buyer who chose "rent" here paid
  // once and was never billed again. Rent is deferred to its own future
  // project, not deleted: the `rentalMonthlyCents` column, the DTO field,
  // and QuoteService's `acquisition === 'rent'` branch (which still throws
  // if it's unset) all stay — only the catalog no longer OFFERS it, so the
  // storefront never sends acquisition:'rent'. Reversible data migration
  // 20260722140000_hardware_drop_rent_offering backfills already-seeded
  // rows (round-trip verified).
  {
    sku: "hummybox-lite",
    category: "bridge",
    name: "HummyBox Lite",
    brand: "HummyTummy",
    model: "BOX-LITE-01",
    description:
      "HummyTummy Local Bridge Agent önyüklü mini-PC. 4GB RAM, 64GB SSD, fanless. Yazarkasa + printer + caller-ID donanımını buluta bağlar; offline çalışır.",
    compat: { sourceUrl: "https://hummytummy.com/landing" },
    priceCents: 480_000,
    warrantyMonths: 24,
    images: ["/products/hummybox-lite.webp"],
    stockStatus: "in_stock",
  },
  {
    sku: "hummybox-pro",
    category: "bridge",
    name: "HummyBox Pro",
    brand: "HummyTummy",
    model: "BOX-PRO-01",
    description:
      "Yüksek hacim için: dahili UPS + dual-LAN failover. Elektrik/internet kesintilerinde işin durmaması gereken çok şubeli işletmeler için.",
    compat: { sourceUrl: "https://hummytummy.com/landing" },
    priceCents: 950_000,
    warrantyMonths: 24,
    images: ["/products/hummybox-pro.webp"],
    stockStatus: "in_stock",
  },
];

// ---- Installation & integration services ------------------------------
//
// v2.8.87 — services live as HardwareProduct rows (category: 'service')
// rather than a separate ServiceOffering model. This reuses the cart /
// quote / checkout pipeline (CartItemService.code === HardwareProduct.sku)
// and lets the storefront grid render them with the same card scaffold.
//
// CheckoutService reads `serviceMeta.serviceType`:
//   - 'onsite'       → mints an InstallationRequest with branchId +
//                      preferredDates + notes from the cart line meta.
//   - 'remote'       → no scheduling row; the service line stays on
//                      HardwareOrder for invoicing. Fulfilment is async
//                      (e.g. our integrations team schedules outside the
//                      app for now; later v2.9.x adds a remote work queue).
//   - 'consultation' → same as remote; intended for high-touch advisory.
//
// `requiresBranch` forces the buyer to pick a branch at the SPA detail
// page before "Add to cart" enables.

const SERVICES = [
  {
    sku: "install-yazarkasa-gib",
    category: "service",
    name: "Yazarkasa kurulum + GİB kaydı yardımı",
    description:
      "Yeni nesil yazarkasa POS kurulumu, GİB başvuru evraklarının hazırlanması, ilk fiş kesimine kadar yerinde teknik destek. 4 saatlik tek seans.",
    priceCents: 350_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: {
      serviceType: "onsite",
      durationHours: 4,
      requiresBranch: true,
      geoCoverage: ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya"],
    },
    details: {
      includes: [
        "Kurulum öncesi 15 dk telefon görüşmesi",
        "Sahada teknisyen ziyareti (4 saat)",
        "GİB bayisi üzerinden aktivasyon takibi",
        "İlk fiş kesimine kadar yerinde yardım",
        "30 gün e-posta üzerinden öncelikli destek",
      ],
      requirements: [
        "Cihazın size ulaşmış olması (kargo + paket açma)",
        "Sürekli AC güç",
        "WiFi en az 10 Mbps (4G modeli için isteğe bağlı)",
        "GİB e-Devlet şifresi (sahada teyit için)",
      ],
      steps: [
        {
          title: "1. Randevu",
          body: "Sipariş sonrası 24 saat içinde sizi arayıp şubeniz için en uygun günü belirleriz.",
        },
        {
          title: "2. Teknisyen ziyareti",
          body: "Belirlenen günde teknisyenimiz şubeye gelir, cihaz kurulumunu yapar, GİB aktivasyonunu başlatır.",
        },
        {
          title: "3. Test fişi",
          body: "İlk gerçek satışınızla birlikte test fişi kesilir, doğrulama tamamlanır.",
        },
        {
          title: "4. Devir",
          body: "Personelinize temel kullanım anlatılır, 30 günlük destek başlar.",
        },
      ],
      faq: [
        {
          q: "Hangi şehirlerde sahaya geliyorsunuz?",
          a: "İstanbul, Ankara, İzmir, Bursa ve Antalya merkez ilçeler. Diğer iller için ekstra yol bedeli alınır — bizimle iletişime geçin.",
        },
        {
          q: "Kurulum kaç saat sürer?",
          a: "Standart tek cihaz için ortalama 4 saat. Kargo geç gelirse veya GİB tarafında bekleme olursa süre uzayabilir.",
        },
        {
          q: "GİB başvurusu ne kadar sürer?",
          a: "Bayi-kanalı üzerinden 3-7 iş günü. Kurulum gününde başvuruyu başlatırız, takibini biz yaparız.",
        },
      ],
    },
  },
  {
    sku: "install-full-pos",
    category: "service",
    name: "Tam POS kurulumu (yazarkasa + printer + KDS eşleme)",
    description:
      "Yazarkasa POS + termal fiş yazıcı + mutfak KDS ekranlarının yerinde kurulumu, eşlemesi ve test edilmesi. 8 saatlik kapsamlı paket.",
    priceCents: 750_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: {
      serviceType: "onsite",
      durationHours: 8,
      requiresBranch: true,
      geoCoverage: ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya"],
    },
    details: {
      includes: [
        "Kurulum öncesi şube krokisi + ağ planı incelemesi",
        "Sahada 2 teknisyen (8 saat)",
        "Yazarkasa + 2 yazıcı + 2 KDS eşlemesi",
        "Personel eğitim oturumu (1 saat)",
        "60 gün öncelikli destek",
      ],
      requirements: [
        "Tüm donanımın şubeye ulaşmış olması",
        "WiFi en az 50 Mbps",
        "Switch / router yönetici erişimi",
        "Mutfak + ön salon arası kablolu hat (KDS için, en az CAT5)",
        "En az 1 personel kurulum gününde hazır",
      ],
      steps: [
        {
          title: "1. Şube incelemesi",
          body: "Kurulumdan 3-5 gün önce şube krokinizi + mevcut ağ yapısını gözden geçiririz.",
        },
        {
          title: "2. Saha günü",
          body: "08:30-17:30 arası 2 teknisyen şubede çalışır. Tüm cihazlar test edilerek devreye alınır.",
        },
        {
          title: "3. Eğitim",
          body: "Kurulum bitince 1 saatlik personel oturumu — yazarkasa + KDS akışı uçtan uca gösterilir.",
        },
        {
          title: "4. Stabilizasyon",
          body: "İlk 7 gün boyunca size atanmış teknisyen WhatsApp destek hattında olur.",
        },
      ],
      faq: [
        {
          q: "KDS ekranlarımız yoksa kuruluma dahil mi?",
          a: 'Hayır, bu hizmet kurulum ücreti — donanımlar ayrı satılır. Mağazadan tüm setin "Add to cart" ile alabilirsiniz.',
        },
        {
          q: "Halihazırda bizde printer var, sadece eşleme yapabilir misiniz?",
          a: "Evet, BYO (bring your own) senaryosunu uyumlu donanım listesinde olduğu sürece destekliyoruz.",
        },
      ],
    },
  },
  {
    sku: "install-kds-only",
    category: "service",
    name: "KDS ekran kurulumu",
    description:
      "Mutfak KDS ekranlarının kurulumu, route rule yapılandırması ve uçtan uca test. 3 saatlik tek seans.",
    priceCents: 250_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: {
      serviceType: "onsite",
      durationHours: 3,
      requiresBranch: true,
      geoCoverage: ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya"],
    },
    details: {
      includes: [
        "Sahada teknisyen (3 saat)",
        "1-3 KDS ekran kurulum + sabitleme",
        "Sipariş yönlendirme kurallarının yapılandırılması",
        "Yemek hazır iş akışı testi",
      ],
      requirements: [
        "KDS donanımının şubeye ulaşmış olması",
        "WiFi en az 20 Mbps",
        "Mutfakta ekran montajı için duvar",
      ],
    },
  },
  {
    sku: "training-basic-4h",
    category: "service",
    name: "Temel personel eğitimi (4 saat)",
    description:
      "Garson + kasa + mutfak ekibi için 4 saatlik temel sistem eğitimi. Sipariş alma, fiş kesme, KDS akışı, raporlar.",
    priceCents: 150_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: {
      serviceType: "onsite",
      durationHours: 4,
      requiresBranch: true,
      geoCoverage: ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya"],
    },
    details: {
      includes: [
        "Sahada eğitmen (4 saat)",
        "Garson + kasa + mutfak rolleri",
        "Uygulamalı sipariş simülasyonu",
        "PDF eğitim dokümanı",
      ],
      requirements: ["Sistem kurulu olmalı", "En az 4 personel ayrılabilmeli"],
    },
  },
  {
    sku: "training-advanced-8h",
    category: "service",
    name: "İleri seviye personel eğitimi (8 saat)",
    description:
      "Yönetici + müdür ekibi için 8 saatlik ileri eğitim. Raporlama, stok, müşteri sadakat programı, çoklu şube yönetimi.",
    priceCents: 280_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: {
      serviceType: "onsite",
      durationHours: 8,
      requiresBranch: true,
      geoCoverage: ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya"],
    },
    details: {
      includes: [
        "Sahada eğitmen (8 saat, 2 oturum)",
        "Yönetici raporları (Z-raporu, ciro analizi, ürün karlılığı)",
        "Stok takibi + tedarikçi yönetimi",
        "Müşteri sadakat programı kurgu",
        "Çoklu şube yönetimi (mevcutsa)",
      ],
    },
  },
  {
    sku: "integration-yemeksepeti",
    category: "service",
    name: "Yemeksepeti entegrasyon kurulumu + menü eşleme",
    description:
      "Yemeksepeti API anahtarınızı sisteme tanımlar, menünüzü Yemeksepeti tarafıyla eşleriz. Tamamen uzaktan, 2-3 iş günü sürer.",
    priceCents: 250_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: { serviceType: "remote", requiresBranch: false },
    details: {
      includes: [
        "Yemeksepeti satıcı paneli üzerinden API key/credentials kurulumu",
        "Menü kategorileri + ürün eşleme",
        "2 örnek sipariş ile uçtan uca test",
        "Sürekli sipariş akışı doğrulaması (24 saat izleme)",
      ],
      requirements: [
        "Yemeksepeti satıcı hesabı + bayi yöneticisi onayı",
        "Menünüzün HummyTummy tarafında girilmiş olması",
      ],
    },
  },
  {
    sku: "integration-trendyol-yemek",
    category: "service",
    name: "Trendyol Yemek entegrasyon kurulumu",
    description:
      "Trendyol Yemek partner API kurulumu + menü eşleme. Tamamen uzaktan.",
    priceCents: 250_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: { serviceType: "remote", requiresBranch: false },
    details: {
      includes: [
        "Trendyol partner API kurulumu",
        "Menü eşleme",
        "Test siparişi",
      ],
      requirements: ["Trendyol Yemek partner hesabı"],
    },
  },
  {
    sku: "integration-efatura-setup",
    category: "service",
    name: "e-Fatura sağlayıcı kurulumu + ilk fatura testi",
    description:
      "Anlaşmalı e-Fatura entegratörünüzün API anahtarlarını sistemde tanımlar, GİB özel entegratör ayarlarını test eder, ilk e-Faturanın başarıyla iletildiğini doğrularız.",
    priceCents: 350_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: { serviceType: "remote", requiresBranch: true },
    details: {
      includes: [
        "e-Fatura sağlayıcı kimlik bilgilerinin tanımlanması",
        "GİB özel entegratör test ortamı doğrulaması",
        "1 örnek e-Fatura uçtan uca testi (test + gerçek)",
        "Hata yönetim akışı kontrolü",
      ],
      requirements: [
        "e-Fatura sağlayıcısı (Foriba, Mali İdare, vb.) ile mevcut sözleşme",
        "GİB e-Fatura mükellef kaydı",
      ],
    },
  },
  {
    sku: "menu-migration",
    category: "service",
    name: "Eski POS'tan menü migrasyonu (şube başı)",
    description:
      "Eski POS sisteminizdeki menüyü Excel/CSV/API üzerinden alır, HummyTummy formatına dönüştürür, kategorileri + modifiyeleri + alerjenleri eşleriz. Şube başına fiyatlandırılır.",
    priceCents: 200_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: { serviceType: "remote", requiresBranch: true },
    details: {
      includes: [
        "Eski POS export'unun (Excel/CSV/JSON) alınması",
        "200 ürüne kadar otomatik dönüşüm",
        "Kategori + modifiye + alerjen eşleme",
        "Yüklenen menü için sizin onayınızla yayına alma",
      ],
      requirements: [
        "Eski sistemden veri export imkanı (kullanıcı veya bayi panel erişimi)",
      ],
    },
  },
  {
    sku: "wifi-site-survey",
    category: "service",
    name: "WiFi/ağ site survey (şube başı)",
    description:
      "KDS + tablet + yazarkasa'nın stabil çalışacağı bir ağ için şubenizde WiFi sinyal haritalama, switch/router önerisi, kablolu hat planı.",
    priceCents: 150_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: {
      serviceType: "onsite",
      durationHours: 2,
      requiresBranch: true,
      geoCoverage: ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya"],
    },
    details: {
      includes: [
        "Sahada teknisyen (2 saat)",
        "WiFi sinyal harita raporu (PDF)",
        "Cihaz başına önerilen bağlantı tipi (WiFi / Ethernet / 4G)",
        "Tedarik edilmesi gereken switch/AP listesi",
      ],
      requirements: ["Şubeye fiziksel erişim"],
    },
  },
  {
    sku: "multibranch-rollout",
    category: "service",
    name: "Çoklu şube rollout danışmanlığı",
    description:
      "3+ şubeli işletmeler için kurulum sıralaması, eğitim takvimi, kademeli geçiş planı oluşturma danışmanlığı. Uzaktan, video çağrı bazlı.",
    priceCents: 500_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: { serviceType: "consultation", requiresBranch: false },
    details: {
      includes: [
        "2 saatlik keşif video çağrısı",
        "Şube önceliklendirme matrisi",
        "Pilot şube + kademeli rollout planı (PDF)",
        "4 hafta boyunca haftalık 30 dk durum takibi çağrısı",
      ],
      requirements: ["3 veya daha fazla aktif şube"],
    },
  },
];

// ---- Rich details for top-priority hardware SKUs ----------------------
//
// v2.8.87 — overlays `details` JSON onto specific SKUs in PRODUCTS at
// runtime so we can keep the original PRODUCTS table flat. The detail
// page renders graceful-degraded for SKUs not in this map (spec tab
// only).

const HARDWARE_DETAILS: Record<string, { details: any; specs?: any }> = {
  "yazarkasa-hugin-tiger-t300": {
    specs: {
      headlineSpecs: ["5.5″", "4G", "GİB onaylı", "360g"],
      display: "5.5″ HD dokunmatik",
      connectivity: "WiFi 802.11 + 4G LTE",
      printer: "Entegre 58mm termal",
      battery: "5000 mAh, ~8 saat aktif kullanım",
      weight: "360g",
      os: "Android 11 (PayTR sertifikalı yazılım)",
    },
    details: {
      includes: [
        "Hugin Tiger T300 4G cihazı",
        "Şarj kablosu + adaptör",
        "Hızlı başlangıç kılavuzu (TR)",
        "24 ay üretici garantisi",
        "GİB aktivasyonu için bayi kanalı yönlendirmesi",
      ],
      requirements: [
        "GİB e-Devlet şifresi",
        "4G SIM (cihaz üzerinden veya kendi hattınız)",
        "WiFi (opsiyonel, 4G yedeği)",
      ],
      faq: [
        {
          q: "GİB aktivasyonu kim yapıyor?",
          a: "Hugin bayisi yapar. Sipariş sonrası süreci sizin adınıza başlatırız.",
        },
        {
          q: "Pay-at-table yapabilir miyim?",
          a: "Evet. Tigers T300 mobil bir cihaz, masa-yanı tahsilat için ideal.",
        },
        {
          q: "Yemeksepeti otomatik sipariş çekebilir mi?",
          a: "Sadece HummyTummy yazılımı üzerinden (entegrasyon ayrı satılır). Cihaz tek başına Yemeksepeti API'sine bağlanmaz.",
        },
      ],
    },
  },
  "yazarkasa-beko-300tr": {
    specs: {
      headlineSpecs: ["5″", "Android", "GİB onaylı", "WiFi + 4G"],
      display: "5″ kapasitif dokunmatik",
      connectivity: "WiFi + 4G dahili SIM yuvası",
      printer: "Entegre 58mm termal",
      os: "Android 10",
    },
    details: {
      includes: [
        "Beko 300TR cihazı",
        "Şarj kablosu + adaptör",
        "Türkçe hızlı başlangıç kılavuzu",
        "24 ay üretici garantisi",
      ],
      requirements: ["GİB e-Devlet şifresi", "WiFi (4G isteğe bağlı)"],
    },
  },
  "yazarkasa-ingenico-move5000f": {
    specs: {
      headlineSpecs: ["Premium", "4G + LAN", "EMV L1/L2", "PCI PTS 5.x"],
      display: "4.3″ renkli dokunmatik",
      connectivity: "4G + Ethernet + WiFi",
      printer: "Entegre yüksek hızlı termal",
      security: "EMV L1/L2, PCI PTS 5.x",
    },
    details: {
      includes: [
        "Ingenico Move/5000F cihazı",
        "Tüm kablo seti",
        "24 ay garanti",
        "PCI sertifikalı yazılım önyüklemesi",
      ],
      // Task 11: was "GİB e-Devlet şifresi" — that requirement belonged to
      // the fiscal-yazarkasa framing this SKU no longer carries (it's a
      // bank/PSP terminal, not a YN ÖKC device; see the category-fix
      // comment above the PRODUCTS entry).
      requirements: ["Banka/PSP üye işyeri (merchant) sözleşmesi", "WiFi veya Ethernet"],
      faq: [
        {
          q: "Hangi banka işyerlerine uygun?",
          a: "Tüm major TR bankaları (Garanti BBVA, İş Bankası, Akbank, Yapı Kredi, vb.). Banka entegrasyonunu kurulum sırasında biz tamamlarız.",
        },
      ],
    },
  },
  "printer-epson-tm-t20iii-lan": {
    specs: {
      headlineSpecs: ["80mm", "LAN", "Auto-cutter", "250mm/s"],
      width: "80mm",
      interface: "Ethernet (LAN)",
      speed: "250 mm/saniye",
      autoCutter: "Evet (1.5 milyon kesim ömrü)",
      protocol: "ESC/POS",
    },
    details: {
      includes: ["Epson TM-T20III yazıcı", "Güç adaptörü", "Örnek termal rulo"],
      requirements: [
        "Statik IP veya DHCP destekli LAN portu",
        "POS yazılımınızda 80mm ESC/POS desteği",
      ],
    },
  },
  "kds-sunmi-d2s": {
    specs: {
      headlineSpecs: ["15.6″", "Android", "Geniş açı", "Duvar montajı"],
      display: "15.6″ FHD IPS, geniş açı",
      mount: "VESA 100x100 duvar veya tezgah ayağı",
      os: "Android 11 (Sunmi-locked)",
    },
    details: {
      includes: [
        "Sunmi D2s ekran",
        "VESA duvar montajı",
        "HDMI + USB-C kablo",
        "12 ay üretici garantisi",
      ],
      requirements: [
        "WiFi en az 10 Mbps",
        "Mutfakta duvar veya tezgah sabitleme imkanı",
        "Sürekli AC güç",
      ],
    },
  },
  "tablet-sunmi-v2-pro": {
    specs: {
      headlineSpecs: ["5.5″", "4G", "Termal printer", "Garson tableti"],
      display: "5.5″ HD dokunmatik",
      connectivity: "WiFi + 4G",
      printer: "Entegre 58mm termal yazıcı",
      battery: "4000 mAh",
    },
    details: {
      includes: ["Sunmi V2 Pro cihazı", "Şarj kablosu", "12 ay garanti"],
      requirements: ["WiFi en az 10 Mbps", "4G için SIM kart (isteğe bağlı)"],
    },
  },
};

// ---- Integration providers --------------------------------------------
//
// HONESTY GATE (2026-06): every row below seeds with status:'coming_soon',
// NOT 'published'. The integration-gateway module's public GET /providers
// filters to status:'published' and connect() rejects any non-published
// provider — so 'coming_soon' rows show as catalog placeholders an operator
// CANNOT "connect" to. This is deliberate: there is no real end-to-end
// product path through this gateway today.
//
//   - efatura/hugin/beko/iyzico/paytr/stripe/twilio/verimor/netgsm have NO
//     adapter at all in IntegrationService.adapters — a "connection" would
//     accept credentials and then go nowhere (no webhook verify, no sync).
//   - yemeksepeti/getir/trendyol_yemek DO have signing adapters here, but
//     they are DUPLICATES of the real delivery integration. The live order
//     ingest / status push / polling flow lives in the delivery-platforms
//     module (DeliveryOrderService + DeliveryWebhookController), and this
//     gateway's ingestWebhook verifies-then-discards the parsed orders — it
//     never turns them into real Orders. Publishing them would let an
//     operator "connect Yemeksepeti" here and silently receive nothing.
//   - paytr/iyzico/stripe payments are handled by payments-core (the real
//     PayTR webhook is payments/webhooks/paytr-webhook.controller.ts), not
//     by this gateway.
//
// Flip a row to 'published' ONLY once it has a real adapter here AND a
// downstream consumer that acts on integration.webhook.*.received.v1.
const PROVIDERS = [
  {
    id: "efatura",
    kind: "fiscal",
    name: "e-Fatura / e-Arşiv",
    description: "Cloud-side electronic invoicing.",
    status: "coming_soon",
  },
  {
    id: "hugin",
    kind: "fiscal",
    name: "Hugin Yazarkasa",
    description: "Yazarkasa via Local Bridge.",
    status: "coming_soon",
  },
  {
    id: "beko",
    kind: "fiscal",
    name: "Beko Yazarkasa",
    description: "Yazarkasa via Local Bridge.",
    status: "coming_soon",
  },
  {
    id: "iyzico",
    kind: "payment",
    name: "Iyzico",
    description: "Card-not-present payment provider.",
    status: "coming_soon",
  },
  {
    id: "paytr",
    kind: "payment",
    name: "PayTR",
    description: "TR iframe-based payment provider.",
    status: "coming_soon",
  },
  {
    id: "stripe",
    kind: "payment",
    name: "Stripe",
    description: "International payments.",
    status: "coming_soon",
  },
  // Delivery: real flow is the delivery-platforms module, not this gateway.
  {
    id: "yemeksepeti",
    kind: "delivery",
    name: "Yemeksepeti",
    description: "Receive Yemeksepeti orders.",
    status: "coming_soon",
  },
  {
    id: "getir",
    kind: "delivery",
    name: "Getir Yemek",
    description: "Receive Getir Yemek orders.",
    status: "coming_soon",
  },
  {
    id: "trendyol_yemek",
    kind: "delivery",
    name: "Trendyol Yemek",
    description: "Receive Trendyol Yemek orders.",
    status: "coming_soon",
  },
  {
    id: "twilio",
    kind: "voip",
    name: "Twilio Voice",
    description: "Cloud VoIP / caller ID.",
    status: "coming_soon",
  },
  {
    id: "verimor",
    kind: "voip",
    name: "Verimor",
    description: "TR-region VoIP provider.",
    status: "coming_soon",
  },
  {
    id: "netgsm",
    kind: "sms",
    name: "Netgsm",
    description: "TR-region SMS provider.",
    status: "coming_soon",
  },
];

async function main() {
  console.log("[seed-marketplace] starting");

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
        status: "published",
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
        status: "published",
      },
    });
  }
  console.log(`[seed-marketplace] add-ons: ${ADDONS.length}`);

  // v2.8.87: PRODUCTS + SERVICES go through the same upsert path; SERVICES
  // are HardwareProduct rows with category='service'. The shared helper
  // also passes through specs/details/serviceMeta if present on the entry.
  const ALL_CATALOG_ENTRIES = [...PRODUCTS, ...SERVICES];
  for (const p of ALL_CATALOG_ENTRIES) {
    // Overlay the rich-detail JSON for the top-6 hardware SKUs (the
    // services already carry details inline). Lets us keep the PRODUCTS
    // array shape unchanged while still seeding `details` + headlineSpecs.
    const overlay = HARDWARE_DETAILS[p.sku];
    // Per-entry override wins, else the shared category→tier map, else direct.
    const saleMode =
      (p as any).saleMode ??
      CATEGORY_DEFAULT_SALE_MODE[p.category] ??
      "DIRECT_SALE";
    const sharedData = {
      category: p.category,
      name: p.name,
      brand: (p as any).brand ?? null,
      model: (p as any).model ?? null,
      description: p.description,
      priceCents: p.priceCents,
      rentalMonthlyCents: (p as any).rentalMonthlyCents ?? null,
      warrantyMonths: (p as any).warrantyMonths ?? 0,
      images: (p as any).images ?? [],
      stockStatus: (p as any).stockStatus ?? "in_stock",
      compat: (p as any).compat ?? null,
      specs: overlay?.specs ?? (p as any).specs ?? null,
      details: overlay?.details ?? (p as any).details ?? null,
      serviceMeta: (p as any).serviceMeta ?? null,
      status: "published",
      saleMode,
      // DIRECT_SALE rows must carry compliance docs (publish gate); other
      // tiers aren't sold directly so they don't need them.
      complianceDocs:
        (p as any).complianceDocs ??
        (saleMode === "DIRECT_SALE" ? SEED_DEFAULT_COMPLIANCE : null),
    };
    const product = await prisma.hardwareProduct.upsert({
      where: { sku: p.sku },
      update: sharedData,
      create: {
        sku: p.sku,
        ...sharedData,
      },
    });
    // Ensure inventory row exists. Services skip stock tracking; the row
    // is harmless to create (available stays 0; quote/checkout for
    // category='service' bypasses CatalogService.allocate).
    //
    // Task 4 (Donanım stok kontrolü ödeme-önüne) — REVERSIBLE representative
    // stock: a brand-new, never-seeded DIRECT_SALE hardware row starts with
    // `available: 25` instead of the schema default 0, so it's actually
    // buyable the moment it's seeded (pre-fix, every DIRECT_SALE product
    // shipped with available=0 while the hand-written stockStatus said
    // "in_stock" — pay first, "Insufficient stock" second).
    //
    // Deliberately CREATE-ONLY (not `update`): this is a content seed, not
    // an inventory-ops tool. `receiveStock` / `allocate` / `markShipped`
    // are the real inventory-ops rails; re-running this seed (the
    // seed-runner workflow does so routinely against staging/prod to push
    // catalog content changes) must NEVER clobber real received/sold stock
    // that ops has since tracked. `update: {}` already left `available`
    // untouched — this keeps that invariant.
    //
    // The "down" for a DB that was already seeded before this fix (so this
    // upsert's create branch never fires again) is the paired data
    // migration 20260722120000_hardware_inventory_seed_stock/{migration,
    // down}.sql, which backfills/reverts existing rows using the identical
    // available=0-and-untouched scope — verified round-trip (up→down→up).
    const isDirectSaleHardware =
      product.category !== "service" && saleMode === "DIRECT_SALE";
    await prisma.hardwareInventory.upsert({
      where: { productId: product.id },
      update: {},
      create: {
        productId: product.id,
        ...(isDirectSaleHardware ? { available: 25 } : {}),
      },
    });
  }
  console.log(
    `[seed-marketplace] catalog: ${PRODUCTS.length} hardware + ${SERVICES.length} service SKUs`,
  );

  for (const ip of PROVIDERS) {
    // Idempotent: re-running converges status to the per-provider value
    // above (currently all 'coming_soon'). The update branch deliberately
    // (re-)sets status so an already-seeded prod/staging DB carrying the
    // old 'published' rows gets downgraded to a non-connectable state.
    await prisma.integrationProviderDef.upsert({
      where: { id: ip.id },
      update: {
        kind: ip.kind,
        name: ip.name,
        description: ip.description,
        configSchema: {} as any,
        isOfficial: true,
        status: ip.status,
      },
      create: {
        id: ip.id,
        kind: ip.kind,
        name: ip.name,
        description: ip.description,
        configSchema: {} as any,
        isOfficial: true,
        status: ip.status,
      },
    });
  }
  const publishedProviders = PROVIDERS.filter(
    (p) => p.status === "published",
  ).length;
  console.log(
    `[seed-marketplace] integration providers: ${PROVIDERS.length} (${publishedProviders} published / connectable)`,
  );

  console.log("[seed-marketplace] done");
}

// Only run the seed when invoked directly (ts-node prisma/seeds/seed-marketplace.ts).
// Guard keeps the module import-safe for unit tests that assert catalog invariants.
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
