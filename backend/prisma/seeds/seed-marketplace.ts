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

const PRODUCTS = [
  {
    sku: 'kds-21in-touch',
    category: 'kds_screen',
    name: '21" KDS Touchscreen',
    brand: 'HummyTummy',
    model: 'KDS-21',
    description: '21-inch capacitive touchscreen. Wall-mount or desk-stand. Runs the Tauri KDS kiosk.',
    priceCents: 750_000,
    warrantyMonths: 24,
    images: [] as string[],
    stockStatus: 'in_stock',
  },
  {
    sku: 'kds-27in-touch',
    category: 'kds_screen',
    name: '27" KDS Touchscreen',
    brand: 'HummyTummy',
    model: 'KDS-27',
    description: '27-inch high-brightness display for busy kitchens.',
    priceCents: 1_150_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'tab-galaxy-a8-10in',
    category: 'tablet',
    name: 'Galaxy Tab A8 10"',
    brand: 'Samsung',
    model: 'SM-X205',
    description: 'Standard waiter tablet pre-flashed with the HummyTummy waiter app.',
    priceCents: 450_000,
    warrantyMonths: 12,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'printer-epson-tm-t20iii-lan',
    category: 'printer',
    name: 'Epson TM-T20III (LAN)',
    brand: 'Epson',
    model: 'TM-T20III',
    description: '80mm ESC/POS receipt printer with auto-cutter. LAN-connected.',
    priceCents: 380_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'printer-star-tsp143iv',
    category: 'printer',
    name: 'Star TSP143IV',
    brand: 'Star',
    model: 'TSP143IV',
    description: 'Fast 80mm receipt printer with bluetooth + LAN.',
    priceCents: 420_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'yazarkasa-hugin-cf350',
    category: 'yazarkasa',
    name: 'Hugin CF350 Yazarkasa',
    brand: 'Hugin',
    model: 'CF350',
    description: 'GİB-onaylı yazarkasa. Drives via the Local Bridge Agent.',
    compat: { requiredAddOn: ['fiscal_hugin'] },
    priceCents: 1_800_000,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'hummybox-lite',
    category: 'bridge',
    name: 'HummyBox Lite',
    brand: 'HummyTummy',
    model: 'BOX-LITE-01',
    description: 'Mini-PC pre-flashed with the Local Bridge Agent. 4GB RAM, 64GB SSD, fanless.',
    priceCents: 480_000,
    rentalMonthlyCents: 9900,
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
    description: 'Higher-spec bridge with UPS + dual-LAN failover for high-volume venues.',
    priceCents: 950_000,
    rentalMonthlyCents: 19900,
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'caller-id-box-4line',
    category: 'caller_id',
    name: 'Caller ID Box (4-line)',
    brand: 'Generic',
    model: 'CID-4L',
    description: 'Analog caller-ID box with serial output. Connects via the Local Bridge Agent.',
    priceCents: 250_000,
    warrantyMonths: 12,
    images: [],
    stockStatus: 'in_stock',
  },
  {
    sku: 'scanner-honeywell-1900',
    category: 'scanner',
    name: 'Honeywell Xenon 1900',
    brand: 'Honeywell',
    model: '1900',
    description: 'Wired 2D barcode scanner. USB HID; works directly with tablets.',
    priceCents: 320_000,
    warrantyMonths: 12,
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
