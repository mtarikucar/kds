import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { UserRole } from '../src/common/constants/roles.enum';

const prisma = new PrismaClient();

// ── Product image URLs (Unsplash) ────────────────────────────────────
const PRODUCT_IMAGES: Record<string, string> = {
  'Serpme Kahvalti': 'https://images.unsplash.com/photo-1590846406792-0adc7f938f1d?w=800&q=80',
  'Menemen': 'https://images.unsplash.com/photo-1623689048105-a17b1e1936b8?w=800&q=80',
  'Sucuklu Yumurta': 'https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?w=800&q=80',
  'Humus': 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=800&q=80',
  'Babaganus': 'https://images.unsplash.com/photo-1576020799627-aeac74d58064?w=800&q=80',
  'Sigara Boregi': 'https://images.unsplash.com/photo-1548340748-6d2b7d7da280?w=800&q=80',
  'Yaprak Sarma': 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=800&q=80',
  'Acili Ezme': 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=800&q=80',
  'Coban Salata': 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&q=80',
  'Sezar Salata': 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=800&q=80',
  'Kiymali Pide': 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80',
  'Kasarli Pide': 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80',
  'Karisik Pide': 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=800&q=80',
  'Kusbasi Pide': 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80',
  'Adana Kebap': 'https://images.unsplash.com/photo-1603360946369-dc9bb6258143?w=800&q=80',
  'Urfa Kebap': 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=800&q=80',
  'Kuzu Pirzola': 'https://images.unsplash.com/photo-1558030006-450675393462?w=800&q=80',
  'Karisik Izgara': 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80',
  'Tavuk Sis': 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=800&q=80',
  'Cop Sis': 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=800&q=80',
  'Iskender': 'https://images.unsplash.com/photo-1530469912745-a215c6b256ea?w=800&q=80',
  'Hunkar Begendi': 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&q=80',
  'Etli Guvec': 'https://images.unsplash.com/photo-1534939561126-855b8675edd7?w=800&q=80',
  'Ali Nazik': 'https://images.unsplash.com/photo-1606491048802-8342506d6471?w=800&q=80',
  'Kunefe': 'https://images.unsplash.com/photo-1579888944880-d98341245702?w=800&q=80',
  'Baklava': 'https://images.unsplash.com/photo-1598110750624-207050c4f28c?w=800&q=80',
  'Sutlac': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&q=80',
  'Kazandibi': 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=800&q=80',
  'Cay': 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=800&q=80',
  'Turk Kahvesi': 'https://images.unsplash.com/photo-1514066558159-fc8c737ef259?w=800&q=80',
  'Ayran': 'https://images.unsplash.com/photo-1553787499-6f9133860278?w=800&q=80',
  'Salgam': 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=800&q=80',
  'Limonata': 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=800&q=80',
};

async function downloadImage(url: string, destPath: string): Promise<number> {
  // Dynamic import for ESM-only sharp
  const sharp = (await import('sharp')).default;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const optimized = await sharp(buffer)
    .resize(800, 800, { fit: 'cover', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  fs.writeFileSync(destPath, optimized);
  return optimized.length;
}

async function main() {
  console.log('🌱 Seeding Sultanahmet Sofra demo restaurant...');

  // ── Idempotent cleanup ──────────────────────────────────────────────
  const existing = await prisma.tenant.findFirst({
    where: { subdomain: 'sultanahmet' },
  });

  if (existing) {
    console.log('🗑️  Removing existing sultanahmet tenant...');
    // Clean up uploaded image files
    const oldUploadsDir = path.join(process.cwd(), 'uploads', 'products', existing.id);
    if (fs.existsSync(oldUploadsDir)) {
      fs.rmSync(oldUploadsDir, { recursive: true });
    }
    // Delete users last because of Restrict constraints on Order.userId and StockMovement.userId
    // First delete records that reference User with onDelete: Restrict
    await prisma.stockMovement.deleteMany({ where: { tenantId: existing.id } });
    await prisma.orderItemModifier.deleteMany({
      where: { orderItem: { order: { tenantId: existing.id } } },
    });
    await prisma.orderItem.deleteMany({
      where: { order: { tenantId: existing.id } },
    });
    await prisma.payment.deleteMany({
      where: { order: { tenantId: existing.id } },
    });
    await prisma.order.deleteMany({ where: { tenantId: existing.id } });
    // Now cascade-safe tenant delete will handle the rest
    await prisma.tenant.delete({ where: { id: existing.id } });
    console.log('✅ Old tenant removed');
  }

  // ── Upsert BUSINESS plan ───────────────────────────────────────────
  const businessPlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'BUSINESS' },
    update: {},
    create: {
      name: 'BUSINESS',
      displayName: 'Business Plan',
      description: 'Enterprise solution for large restaurant chains',
      monthlyPrice: 199.99,
      yearlyPrice: 1999.99,
      currency: 'TRY',
      trialDays: 14,
      maxUsers: -1,
      maxTables: -1,
      maxProducts: -1,
      maxCategories: -1,
      maxMonthlyOrders: -1,
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
      isActive: true,
    },
  });

  console.log('✅ BUSINESS plan ready');

  // ── Tenant ─────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Sultanahmet Sofra',
      subdomain: 'sultanahmet',
      status: 'ACTIVE',
      currentPlanId: businessPlan.id,
      currency: 'TRY',
      timezone: 'Europe/Istanbul',
      latitude: 41.0054,
      longitude: 28.9768,
      closingTime: '00:00',
      reportEmailEnabled: true,
      reportEmails: ['rapor@sultanahmet-sofra.com', 'ahmet@sultanahmet-sofra.com'],
      wifiSsid: 'Sultanahmet_Sofra_WiFi',
      wifiPassword: 'hosgeldiniz2024',
      socialInstagram: 'sultanahmet_sofra',
      socialFacebook: 'https://facebook.com/sultanahmetsofra',
      socialTwitter: 'sultanahmetsofra',
      socialWhatsapp: '+905551234567',
      paymentRegion: 'TURKEY',
    },
  });

  console.log('✅ Tenant created:', tenant.name);

  // ── Staff Users ────────────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash('demo123', 10);

  const staffData = [
    { email: 'ahmet@sultanahmet-sofra.com', firstName: 'Ahmet', lastName: 'Yilmaz', role: UserRole.ADMIN },
    { email: 'elif@sultanahmet-sofra.com', firstName: 'Elif', lastName: 'Kaya', role: UserRole.MANAGER },
    { email: 'mehmet@sultanahmet-sofra.com', firstName: 'Mehmet', lastName: 'Demir', role: UserRole.WAITER },
    { email: 'zeynep@sultanahmet-sofra.com', firstName: 'Zeynep', lastName: 'Celik', role: UserRole.WAITER },
    { email: 'mustafa@sultanahmet-sofra.com', firstName: 'Mustafa', lastName: 'Ozturk', role: UserRole.KITCHEN },
  ];

  const users: Record<string, any> = {};
  for (const s of staffData) {
    const u = await prisma.user.create({
      data: { ...s, password: hashedPassword, status: 'ACTIVE', tenantId: tenant.id },
    });
    users[s.firstName.toLowerCase()] = u;
  }

  console.log('✅ 5 staff users created');

  // ── Categories ─────────────────────────────────────────────────────
  const categoryData = [
    { name: 'Kahvalti', description: 'Geleneksel Turk kahvaltisi', displayOrder: 1 },
    { name: 'Mezeler', description: 'Soguk ve sicak mezeler', displayOrder: 2 },
    { name: 'Salatalar', description: 'Taze salatalar', displayOrder: 3 },
    { name: 'Pideler', description: 'Firin pideler', displayOrder: 4 },
    { name: 'Izgara', description: 'Mangal ve izgara cesitleri', displayOrder: 5 },
    { name: 'Ana Yemekler', description: 'Geleneksel ana yemekler', displayOrder: 6 },
    { name: 'Tatlilar', description: 'Turk tatlilari', displayOrder: 7 },
    { name: 'Icecekler', description: 'Sicak ve soguk icecekler', displayOrder: 8 },
  ];

  const categories: Record<string, any> = {};
  for (const c of categoryData) {
    const cat = await prisma.category.create({
      data: { ...c, isActive: true, tenantId: tenant.id },
    });
    categories[c.name] = cat;
  }

  console.log('✅ 8 categories created');

  // ── Products ───────────────────────────────────────────────────────
  const productDefs: { cat: string; name: string; price: number; desc: string }[] = [
    // Kahvalti
    { cat: 'Kahvalti', name: 'Serpme Kahvalti', price: 450, desc: '2 kisilik zengin kahvalti tabagi' },
    { cat: 'Kahvalti', name: 'Menemen', price: 120, desc: 'Domatesli biberli yumurta' },
    { cat: 'Kahvalti', name: 'Sucuklu Yumurta', price: 130, desc: 'Kasap sucugu ile sahanda yumurta' },
    // Mezeler
    { cat: 'Mezeler', name: 'Humus', price: 90, desc: 'Tahinli nohut ezme' },
    { cat: 'Mezeler', name: 'Babaganus', price: 85, desc: 'Kozlenmis patlican salatasi' },
    { cat: 'Mezeler', name: 'Sigara Boregi', price: 95, desc: 'El acmasi sigara boregi' },
    { cat: 'Mezeler', name: 'Yaprak Sarma', price: 80, desc: 'Zeytinyagli yaprak sarma' },
    { cat: 'Mezeler', name: 'Acili Ezme', price: 75, desc: 'Taze acili domates ezme' },
    // Salatalar
    { cat: 'Salatalar', name: 'Coban Salata', price: 70, desc: 'Domates, salatalik, sogan, maydanoz' },
    { cat: 'Salatalar', name: 'Sezar Salata', price: 110, desc: 'Tavuklu sezar salata' },
    // Pideler
    { cat: 'Pideler', name: 'Kiymali Pide', price: 160, desc: 'Kiymali karisik pide' },
    { cat: 'Pideler', name: 'Kasarli Pide', price: 140, desc: 'Kasarli pide' },
    { cat: 'Pideler', name: 'Karisik Pide', price: 180, desc: 'Karisik malzemeli pide' },
    { cat: 'Pideler', name: 'Kusbasi Pide', price: 190, desc: 'Kusbasi etli pide' },
    // Izgara
    { cat: 'Izgara', name: 'Adana Kebap', price: 280, desc: 'Acili el kiymasi kebap' },
    { cat: 'Izgara', name: 'Urfa Kebap', price: 280, desc: 'Acisiz el kiymasi kebap' },
    { cat: 'Izgara', name: 'Kuzu Pirzola', price: 420, desc: '4 parca kuzu pirzola' },
    { cat: 'Izgara', name: 'Karisik Izgara', price: 380, desc: 'Adana, tavuk, kofte, pirzola' },
    { cat: 'Izgara', name: 'Tavuk Sis', price: 220, desc: 'Marine edilmis tavuk sis' },
    { cat: 'Izgara', name: 'Cop Sis', price: 250, desc: 'Kusbasi cop sis' },
    // Ana Yemekler
    { cat: 'Ana Yemekler', name: 'Iskender', price: 300, desc: 'Bursa iskender kebap' },
    { cat: 'Ana Yemekler', name: 'Hunkar Begendi', price: 290, desc: 'Patlican puresi ustunde kusbasi' },
    { cat: 'Ana Yemekler', name: 'Etli Guvec', price: 260, desc: 'Sebzeli etli guvec' },
    { cat: 'Ana Yemekler', name: 'Ali Nazik', price: 310, desc: 'Yogurtlu patlican ustunde kebap' },
    // Tatlilar
    { cat: 'Tatlilar', name: 'Kunefe', price: 180, desc: 'Antep fistigli kunefe' },
    { cat: 'Tatlilar', name: 'Baklava', price: 160, desc: 'Fistikli baklava (6 dilim)' },
    { cat: 'Tatlilar', name: 'Sutlac', price: 100, desc: 'Firin sutlac' },
    { cat: 'Tatlilar', name: 'Kazandibi', price: 110, desc: 'Geleneksel kazandibi' },
    // Icecekler
    { cat: 'Icecekler', name: 'Cay', price: 25, desc: 'Demlik cay' },
    { cat: 'Icecekler', name: 'Turk Kahvesi', price: 70, desc: 'Geleneksel Turk kahvesi' },
    { cat: 'Icecekler', name: 'Ayran', price: 40, desc: 'Ev yapimi ayran' },
    { cat: 'Icecekler', name: 'Salgam', price: 45, desc: 'Adana salgam suyu' },
    { cat: 'Icecekler', name: 'Limonata', price: 60, desc: 'Taze sikma limonata' },
  ];

  const products: Record<string, any> = {};
  let prodOrder = 0;
  for (const p of productDefs) {
    const prod = await prisma.product.create({
      data: {
        name: p.name,
        description: p.desc,
        price: p.price,
        isAvailable: true,
        stockTracked: true,
        currentStock: Math.floor(Math.random() * 30) + 10,
        displayOrder: prodOrder++,
        categoryId: categories[p.cat].id,
        tenantId: tenant.id,
      },
    });
    products[p.name] = prod;
  }

  console.log(`✅ ${Object.keys(products).length} products created`);

  // ── Product Images ─────────────────────────────────────────────────
  const uploadsDir = path.join(process.cwd(), 'uploads', 'products', tenant.id);
  fs.mkdirSync(uploadsDir, { recursive: true });

  const baseUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  let imgSuccess = 0;
  let imgFail = 0;

  for (const [productName, imageUrl] of Object.entries(PRODUCT_IMAGES)) {
    const product = products[productName];
    if (!product) continue;

    const filename = `${randomUUID()}.jpg`;
    const destPath = path.join(uploadsDir, filename);
    const relativePath = `uploads/products/${tenant.id}/${filename}`;

    try {
      const fileSize = await downloadImage(imageUrl, destPath);
      const productImage = await prisma.productImage.create({
        data: {
          url: `${baseUrl}/${relativePath}`,
          filename: `${productName.toLowerCase().replace(/\s+/g, '-')}.jpg`,
          size: fileSize,
          mimeType: 'image/jpeg',
          tenantId: tenant.id,
        },
      });
      await prisma.productToImage.create({
        data: {
          productId: product.id,
          imageId: productImage.id,
          order: 0,
        },
      });
      imgSuccess++;
    } catch (err: any) {
      console.warn(`  ⚠ Image skipped for "${productName}": ${err.message}`);
      imgFail++;
    }
  }

  console.log(`✅ Product images: ${imgSuccess} downloaded, ${imgFail} skipped`);

  // ── Modifier Groups & Modifiers ────────────────────────────────────
  // 1. Pide Boyutu
  const pideBoyutu = await prisma.modifierGroup.create({
    data: {
      name: 'pide_boyutu', displayName: 'Pide Boyutu', selectionType: 'SINGLE',
      isRequired: true, minSelections: 1, maxSelections: 1, displayOrder: 1, tenantId: tenant.id,
      modifiers: {
        create: [
          { name: 'normal', displayName: 'Normal', priceAdjustment: 0, displayOrder: 1, tenantId: tenant.id },
          { name: 'buyuk', displayName: 'Buyuk', priceAdjustment: 30, displayOrder: 2, tenantId: tenant.id },
        ],
      },
    },
    include: { modifiers: true },
  });

  // 2. Et Pisirme
  const etPisirme = await prisma.modifierGroup.create({
    data: {
      name: 'et_pisirme', displayName: 'Et Pisirme Derecesi', selectionType: 'SINGLE',
      isRequired: false, minSelections: 0, maxSelections: 1, displayOrder: 2, tenantId: tenant.id,
      modifiers: {
        create: [
          { name: 'az_pismis', displayName: 'Az Pismis', priceAdjustment: 0, displayOrder: 1, tenantId: tenant.id },
          { name: 'orta', displayName: 'Orta', priceAdjustment: 0, displayOrder: 2, tenantId: tenant.id },
          { name: 'iyi_pismis', displayName: 'Iyi Pismis', priceAdjustment: 0, displayOrder: 3, tenantId: tenant.id },
        ],
      },
    },
    include: { modifiers: true },
  });

  // 3. Sos Secimi
  const sosSec = await prisma.modifierGroup.create({
    data: {
      name: 'sos_secimi', displayName: 'Sos Secimi', selectionType: 'MULTIPLE',
      isRequired: false, minSelections: 0, maxSelections: 3, displayOrder: 3, tenantId: tenant.id,
      modifiers: {
        create: [
          { name: 'aci_sos', displayName: 'Aci Sos', priceAdjustment: 5, displayOrder: 1, tenantId: tenant.id },
          { name: 'sarimsak_sos', displayName: 'Sarimsak Sos', priceAdjustment: 5, displayOrder: 2, tenantId: tenant.id },
          { name: 'nar_eksisi', displayName: 'Nar Eksisi', priceAdjustment: 0, displayOrder: 3, tenantId: tenant.id },
        ],
      },
    },
    include: { modifiers: true },
  });

  // 4. Ekstra Malzeme
  const ekstraMalzeme = await prisma.modifierGroup.create({
    data: {
      name: 'ekstra_malzeme', displayName: 'Ekstra Malzeme', selectionType: 'MULTIPLE',
      isRequired: false, minSelections: 0, maxSelections: 5, displayOrder: 4, tenantId: tenant.id,
      modifiers: {
        create: [
          { name: 'kasar', displayName: 'Ekstra Kasar', priceAdjustment: 20, displayOrder: 1, tenantId: tenant.id },
          { name: 'sucuk', displayName: 'Ekstra Sucuk', priceAdjustment: 25, displayOrder: 2, tenantId: tenant.id },
          { name: 'mantar', displayName: 'Mantar', priceAdjustment: 15, displayOrder: 3, tenantId: tenant.id },
        ],
      },
    },
    include: { modifiers: true },
  });

  // 5. Icecek Boyutu
  const icecekBoyutu = await prisma.modifierGroup.create({
    data: {
      name: 'icecek_boyutu', displayName: 'Icecek Boyutu', selectionType: 'SINGLE',
      isRequired: true, minSelections: 1, maxSelections: 1, displayOrder: 5, tenantId: tenant.id,
      modifiers: {
        create: [
          { name: 'kucuk', displayName: 'Kucuk', priceAdjustment: 0, displayOrder: 1, tenantId: tenant.id },
          { name: 'orta_boy', displayName: 'Orta', priceAdjustment: 10, displayOrder: 2, tenantId: tenant.id },
          { name: 'buyuk_boy', displayName: 'Buyuk', priceAdjustment: 20, displayOrder: 3, tenantId: tenant.id },
        ],
      },
    },
    include: { modifiers: true },
  });

  // 6. Kahve Cesidi
  const kahveCesidi = await prisma.modifierGroup.create({
    data: {
      name: 'kahve_cesidi', displayName: 'Kahve Cesidi', selectionType: 'SINGLE',
      isRequired: false, minSelections: 0, maxSelections: 1, displayOrder: 6, tenantId: tenant.id,
      modifiers: {
        create: [
          { name: 'sade', displayName: 'Sade', priceAdjustment: 0, displayOrder: 1, tenantId: tenant.id },
          { name: 'orta_sekerli', displayName: 'Orta Sekerli', priceAdjustment: 0, displayOrder: 2, tenantId: tenant.id },
          { name: 'sekerli', displayName: 'Sekerli', priceAdjustment: 0, displayOrder: 3, tenantId: tenant.id },
          { name: 'menengiç', displayName: 'Menengic Kahvesi', priceAdjustment: 15, displayOrder: 4, tenantId: tenant.id },
        ],
      },
    },
    include: { modifiers: true },
  });

  // Link modifier groups to products
  const pideProducts = ['Kiymali Pide', 'Kasarli Pide', 'Karisik Pide', 'Kusbasi Pide'];
  const izgaraProducts = ['Adana Kebap', 'Urfa Kebap', 'Kuzu Pirzola', 'Karisik Izgara', 'Tavuk Sis', 'Cop Sis'];
  const drinkProducts = ['Ayran', 'Salgam', 'Limonata'];

  const pmgData: { productId: string; groupId: string }[] = [];

  for (const pName of pideProducts) {
    pmgData.push({ productId: products[pName].id, groupId: pideBoyutu.id });
    pmgData.push({ productId: products[pName].id, groupId: ekstraMalzeme.id });
  }
  for (const pName of izgaraProducts) {
    pmgData.push({ productId: products[pName].id, groupId: etPisirme.id });
    pmgData.push({ productId: products[pName].id, groupId: sosSec.id });
  }
  for (const pName of drinkProducts) {
    pmgData.push({ productId: products[pName].id, groupId: icecekBoyutu.id });
  }
  pmgData.push({ productId: products['Turk Kahvesi'].id, groupId: kahveCesidi.id });

  for (const pmg of pmgData) {
    await prisma.productModifierGroup.create({ data: pmg });
  }

  console.log('✅ 6 modifier groups with product links created');

  // ── Tables ─────────────────────────────────────────────────────────
  const tableData = [
    { number: '1', capacity: 2, section: 'Ic Salon', status: 'OCCUPIED' },
    { number: '2', capacity: 4, section: 'Ic Salon', status: 'OCCUPIED' },
    { number: '3', capacity: 4, section: 'Ic Salon', status: 'AVAILABLE' },
    { number: '4', capacity: 6, section: 'Ic Salon', status: 'RESERVED' },
    { number: '5', capacity: 2, section: 'Ic Salon', status: 'AVAILABLE' },
    { number: '6', capacity: 4, section: 'Ic Salon', status: 'AVAILABLE' },
    { number: '7', capacity: 4, section: 'Bahce', status: 'OCCUPIED' },
    { number: '8', capacity: 6, section: 'Bahce', status: 'AVAILABLE' },
    { number: '9', capacity: 4, section: 'Bahce', status: 'AVAILABLE' },
    { number: '10', capacity: 2, section: 'Teras', status: 'OCCUPIED' },
    { number: '11', capacity: 4, section: 'Teras', status: 'RESERVED' },
    { number: '12', capacity: 8, section: 'VIP Salon', status: 'AVAILABLE' },
  ];

  const tables: Record<string, any> = {};
  for (const t of tableData) {
    const table = await prisma.table.create({
      data: { ...t, tenantId: tenant.id },
    });
    tables[t.number] = table;
  }

  console.log('✅ 12 tables created');

  // ── Customers ──────────────────────────────────────────────────────
  const customerData = [
    { name: 'Ayse Yildiz', phone: '+905551000001', email: 'ayse@email.com', loyaltyTier: 'PLATINUM', tags: ['VIP'], totalOrders: 87, totalSpent: 24500, averageOrder: 281.61 },
    { name: 'Hasan Korkmaz', phone: '+905551000002', email: 'hasan@email.com', loyaltyTier: 'GOLD', tags: ['Regular'], totalOrders: 45, totalSpent: 11200, averageOrder: 248.89 },
    { name: 'Fatma Aksoy', phone: '+905551000003', email: 'fatma@email.com', loyaltyTier: 'GOLD', tags: ['Regular'], totalOrders: 38, totalSpent: 9800, averageOrder: 257.89 },
    { name: 'Emre Sahin', phone: '+905551000004', email: 'emre@email.com', loyaltyTier: 'SILVER', tags: ['Corporate'], totalOrders: 22, totalSpent: 8900, averageOrder: 404.55 },
    { name: 'Selin Dogan', phone: '+905551000005', email: 'selin@email.com', loyaltyTier: 'SILVER', tags: ['Regular'], totalOrders: 19, totalSpent: 4200, averageOrder: 221.05 },
    { name: 'Burak Cetin', phone: '+905551000006', email: 'burak@email.com', loyaltyTier: 'BRONZE', tags: ['New'], totalOrders: 5, totalSpent: 1350, averageOrder: 270 },
    { name: 'Derya Aydin', phone: '+905551000007', email: 'derya@email.com', loyaltyTier: 'BRONZE', tags: ['New'], totalOrders: 3, totalSpent: 680, averageOrder: 226.67 },
    { name: 'Kemal Taskin', phone: '+905551000008', email: 'kemal@email.com', loyaltyTier: 'GOLD', tags: ['VIP', 'Corporate'], totalOrders: 52, totalSpent: 18700, averageOrder: 359.62 },
    { name: 'Nurgul Ozkan', phone: '+905551000009', email: 'nurgul@email.com', loyaltyTier: 'SILVER', tags: ['Regular'], totalOrders: 15, totalSpent: 3800, averageOrder: 253.33 },
    { name: 'Tolga Erdem', phone: '+905551000010', email: 'tolga@email.com', loyaltyTier: 'BRONZE', tags: ['New'], totalOrders: 2, totalSpent: 560, averageOrder: 280 },
  ];

  const customers: Record<string, any> = {};
  for (const c of customerData) {
    const cust = await prisma.customer.create({
      data: {
        name: c.name,
        phone: c.phone,
        email: c.email,
        loyaltyTier: c.loyaltyTier,
        tags: c.tags,
        totalOrders: c.totalOrders,
        totalSpent: c.totalSpent,
        averageOrder: c.averageOrder,
        loyaltyPoints: Math.floor(c.totalSpent / 10),
        lastVisit: new Date(),
        tenantId: tenant.id,
      },
    });
    customers[c.name] = cust;
  }

  console.log('✅ 10 customers created');

  // ── Helper: create order with items ────────────────────────────────
  const now = new Date();
  let orderCounter = 1000;

  async function createOrder(opts: {
    type: string;
    status: string;
    tableId?: string;
    customerId?: string;
    userId?: string;
    items: { productName: string; qty: number; modifiers?: { modifierId: string; price: number }[] }[];
    source?: string;
    externalOrderId?: string;
    customerName?: string;
    requiresApproval?: boolean;
    createdMinutesAgo?: number;
    paid?: boolean;
    paymentMethod?: string;
    notes?: string;
  }) {
    const orderNum = `SS-${++orderCounter}`;
    const createdAt = new Date(now.getTime() - (opts.createdMinutesAgo || 0) * 60000);

    let totalAmount = 0;
    const itemsData = opts.items.map((it) => {
      const prod = products[it.productName];
      const modTotal = (it.modifiers || []).reduce((sum, m) => sum + m.price, 0);
      const unitPrice = Number(prod.price);
      const subtotal = (unitPrice + modTotal) * it.qty;
      totalAmount += subtotal;
      return { prod, qty: it.qty, unitPrice, modTotal, subtotal, modifiers: it.modifiers || [] };
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: orderNum,
        type: opts.type,
        status: opts.status,
        totalAmount,
        discount: 0,
        finalAmount: totalAmount,
        notes: opts.notes || null,
        customerName: opts.customerName || null,
        source: opts.source || null,
        externalOrderId: opts.externalOrderId || null,
        requiresApproval: opts.requiresApproval || false,
        tableId: opts.tableId || null,
        customerId: opts.customerId || null,
        userId: opts.userId || null,
        tenantId: tenant.id,
        createdAt,
        paidAt: opts.paid ? createdAt : null,
      },
    });

    for (const it of itemsData) {
      const orderItem = await prisma.orderItem.create({
        data: {
          quantity: it.qty,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
          modifierTotal: it.modTotal,
          orderId: order.id,
          productId: it.prod.id,
          status: opts.status === 'PENDING' || opts.status === 'PENDING_APPROVAL' ? 'PENDING' : opts.status === 'PREPARING' ? 'PREPARING' : 'READY',
        },
      });

      for (const mod of it.modifiers) {
        await prisma.orderItemModifier.create({
          data: {
            quantity: 1,
            priceAdjustment: mod.price,
            orderItemId: orderItem.id,
            modifierId: mod.modifierId,
          },
        });
      }
    }

    if (opts.paid && opts.paymentMethod) {
      await prisma.payment.create({
        data: {
          amount: totalAmount,
          method: opts.paymentMethod,
          status: 'COMPLETED',
          orderId: order.id,
          paidAt: createdAt,
        },
      });
    }

    return order;
  }

  // ── Orders ─────────────────────────────────────────────────────────
  // Grab some modifier IDs for use in orders
  const modOrta = etPisirme.modifiers.find((m) => m.name === 'orta')!;
  const modAci = sosSec.modifiers.find((m) => m.name === 'aci_sos')!;
  const modBuyukPide = pideBoyutu.modifiers.find((m) => m.name === 'buyuk')!;
  const modSade = kahveCesidi.modifiers.find((m) => m.name === 'sade')!;
  const modBuyukIcecek = icecekBoyutu.modifiers.find((m) => m.name === 'buyuk_boy')!;

  // 5 PAID orders (past)
  await createOrder({
    type: 'DINE_IN', status: 'PAID', tableId: tables['3'].id, userId: users.mehmet.id,
    customerId: customers['Ayse Yildiz'].id, customerName: 'Ayse Yildiz',
    items: [
      { productName: 'Adana Kebap', qty: 2, modifiers: [{ modifierId: modOrta.id, price: 0 }, { modifierId: modAci.id, price: 5 }] },
      { productName: 'Coban Salata', qty: 1 },
      { productName: 'Ayran', qty: 2 },
    ],
    paid: true, paymentMethod: 'CARD', createdMinutesAgo: 180,
  });

  await createOrder({
    type: 'DINE_IN', status: 'PAID', tableId: tables['5'].id, userId: users.mehmet.id,
    customerId: customers['Hasan Korkmaz'].id, customerName: 'Hasan Korkmaz',
    items: [
      { productName: 'Iskender', qty: 1 },
      { productName: 'Kunefe', qty: 1 },
      { productName: 'Cay', qty: 2 },
    ],
    paid: true, paymentMethod: 'CASH', createdMinutesAgo: 150,
  });

  await createOrder({
    type: 'TAKEAWAY', status: 'PAID', userId: users.zeynep.id,
    customerName: 'Misafir',
    items: [
      { productName: 'Karisik Pide', qty: 2, modifiers: [{ modifierId: modBuyukPide.id, price: 30 }] },
      { productName: 'Limonata', qty: 2 },
    ],
    paid: true, paymentMethod: 'CARD', createdMinutesAgo: 120,
  });

  await createOrder({
    type: 'COUNTER', status: 'PAID', userId: users.zeynep.id,
    items: [
      { productName: 'Turk Kahvesi', qty: 3, modifiers: [{ modifierId: modSade.id, price: 0 }] },
      { productName: 'Baklava', qty: 1 },
    ],
    paid: true, paymentMethod: 'DIGITAL', createdMinutesAgo: 90,
  });

  await createOrder({
    type: 'DINE_IN', status: 'PAID', tableId: tables['6'].id, userId: users.mehmet.id,
    customerId: customers['Kemal Taskin'].id, customerName: 'Kemal Taskin',
    items: [
      { productName: 'Karisik Izgara', qty: 1, modifiers: [{ modifierId: modOrta.id, price: 0 }] },
      { productName: 'Humus', qty: 1 },
      { productName: 'Acili Ezme', qty: 1 },
      { productName: 'Salgam', qty: 2, modifiers: [{ modifierId: modBuyukIcecek.id, price: 20 }] },
    ],
    paid: true, paymentMethod: 'CARD', createdMinutesAgo: 60,
  });

  // 2 SERVED orders
  await createOrder({
    type: 'DINE_IN', status: 'SERVED', tableId: tables['1'].id, userId: users.mehmet.id,
    customerId: customers['Fatma Aksoy'].id, customerName: 'Fatma Aksoy',
    items: [
      { productName: 'Serpme Kahvalti', qty: 1 },
      { productName: 'Menemen', qty: 1 },
      { productName: 'Cay', qty: 4 },
    ],
    createdMinutesAgo: 35,
  });

  await createOrder({
    type: 'DINE_IN', status: 'SERVED', tableId: tables['10'].id, userId: users.zeynep.id,
    customerId: customers['Selin Dogan'].id, customerName: 'Selin Dogan',
    items: [
      { productName: 'Ali Nazik', qty: 1 },
      { productName: 'Sezar Salata', qty: 1 },
    ],
    createdMinutesAgo: 25,
  });

  // 3 PREPARING orders
  await createOrder({
    type: 'DINE_IN', status: 'PREPARING', tableId: tables['2'].id, userId: users.mehmet.id,
    customerId: customers['Emre Sahin'].id, customerName: 'Emre Sahin',
    items: [
      { productName: 'Kuzu Pirzola', qty: 2, modifiers: [{ modifierId: modOrta.id, price: 0 }] },
      { productName: 'Babaganus', qty: 1 },
      { productName: 'Yaprak Sarma', qty: 1 },
    ],
    createdMinutesAgo: 12,
  });

  await createOrder({
    type: 'DINE_IN', status: 'PREPARING', tableId: tables['7'].id, userId: users.zeynep.id,
    items: [
      { productName: 'Kiymali Pide', qty: 1, modifiers: [{ modifierId: modBuyukPide.id, price: 30 }] },
      { productName: 'Kasarli Pide', qty: 1 },
      { productName: 'Ayran', qty: 2 },
    ],
    createdMinutesAgo: 8,
  });

  await createOrder({
    type: 'TAKEAWAY', status: 'PREPARING', userId: users.mehmet.id,
    customerName: 'Osman Bey',
    items: [
      { productName: 'Cop Sis', qty: 2 },
      { productName: 'Coban Salata', qty: 1 },
    ],
    createdMinutesAgo: 6,
  });

  // 4 PENDING orders
  await createOrder({
    type: 'DINE_IN', status: 'PENDING', tableId: tables['1'].id, userId: users.mehmet.id,
    items: [
      { productName: 'Sigara Boregi', qty: 1 },
      { productName: 'Turk Kahvesi', qty: 2, modifiers: [{ modifierId: modSade.id, price: 0 }] },
    ],
    createdMinutesAgo: 3,
  });

  await createOrder({
    type: 'COUNTER', status: 'PENDING', userId: users.zeynep.id,
    items: [
      { productName: 'Cay', qty: 5 },
      { productName: 'Baklava', qty: 2 },
    ],
    createdMinutesAgo: 2,
  });

  await createOrder({
    type: 'TAKEAWAY', status: 'PENDING', userId: users.mehmet.id,
    customerName: 'Leyla Hanim',
    items: [
      { productName: 'Hunkar Begendi', qty: 1 },
      { productName: 'Etli Guvec', qty: 1 },
    ],
    createdMinutesAgo: 1,
  });

  await createOrder({
    type: 'DINE_IN', status: 'PENDING', tableId: tables['10'].id, userId: users.zeynep.id,
    items: [
      { productName: 'Sutlac', qty: 2 },
      { productName: 'Kazandibi', qty: 1 },
    ],
    createdMinutesAgo: 1,
  });

  // 1 PENDING_APPROVAL (customer QR order)
  await createOrder({
    type: 'DINE_IN', status: 'PENDING_APPROVAL', tableId: tables['2'].id,
    requiresApproval: true, customerName: 'QR Siparis',
    items: [
      { productName: 'Tavuk Sis', qty: 1 },
      { productName: 'Limonata', qty: 1 },
    ],
    createdMinutesAgo: 1,
  });

  // 1 READY
  await createOrder({
    type: 'TAKEAWAY', status: 'READY', userId: users.zeynep.id,
    customerName: 'Ali Bey',
    items: [
      { productName: 'Adana Kebap', qty: 3, modifiers: [{ modifierId: modAci.id, price: 5 }] },
      { productName: 'Urfa Kebap', qty: 2 },
    ],
    createdMinutesAgo: 15,
  });

  // 2 CANCELLED
  await createOrder({
    type: 'DINE_IN', status: 'CANCELLED', tableId: tables['9'].id, userId: users.mehmet.id,
    notes: 'Musteri iptal etti',
    items: [
      { productName: 'Kusbasi Pide', qty: 1 },
    ],
    createdMinutesAgo: 45,
  });

  await createOrder({
    type: 'DELIVERY', status: 'CANCELLED', userId: users.zeynep.id,
    source: 'GETIR', externalOrderId: 'GTR-9988771',
    customerName: 'Getir Musteri',
    notes: 'Musteri iptal',
    items: [
      { productName: 'Iskender', qty: 1 },
    ],
    createdMinutesAgo: 40,
  });

  // 4 Delivery platform orders (mix of statuses)
  await createOrder({
    type: 'DELIVERY', status: 'PREPARING', userId: users.mehmet.id,
    source: 'YEMEKSEPETI', externalOrderId: 'YS-12345678',
    customerName: 'Yemeksepeti Musteri',
    items: [
      { productName: 'Karisik Izgara', qty: 1 },
      { productName: 'Coban Salata', qty: 1 },
      { productName: 'Ayran', qty: 2 },
    ],
    createdMinutesAgo: 10,
  });

  await createOrder({
    type: 'DELIVERY', status: 'PENDING', userId: users.zeynep.id,
    source: 'TRENDYOL', externalOrderId: 'TY-87654321',
    customerName: 'Trendyol Musteri',
    items: [
      { productName: 'Adana Kebap', qty: 2 },
      { productName: 'Baklava', qty: 1 },
    ],
    createdMinutesAgo: 3,
  });

  await createOrder({
    type: 'DELIVERY', status: 'PAID', userId: users.mehmet.id,
    source: 'MIGROS', externalOrderId: 'MIG-55443322',
    customerName: 'Migros Musteri',
    items: [
      { productName: 'Kunefe', qty: 2 },
      { productName: 'Turk Kahvesi', qty: 2 },
    ],
    paid: true, paymentMethod: 'DIGITAL', createdMinutesAgo: 70,
  });

  console.log('✅ 18 orders created');

  // ── Reservations ───────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const threeDaysOut = new Date(today); threeDaysOut.setDate(today.getDate() + 3);

  const reservationData = [
    { num: 'R-2001', date: yesterday, start: '19:00', end: '21:00', guests: 4, status: 'COMPLETED', name: 'Ayse Yildiz', phone: '+905551000001', tableId: tables['4'].id, completedAt: yesterday },
    { num: 'R-2002', date: yesterday, start: '20:00', end: '22:00', guests: 2, status: 'NO_SHOW', name: 'Tolga Erdem', phone: '+905551000010', tableId: tables['5'].id },
    { num: 'R-2003', date: today, start: '12:30', end: '14:00', guests: 6, status: 'SEATED', name: 'Kemal Taskin', phone: '+905551000008', email: 'kemal@email.com', tableId: tables['4'].id, seatedAt: now },
    { num: 'R-2004', date: today, start: '19:00', end: '21:00', guests: 4, status: 'CONFIRMED', name: 'Emre Sahin', phone: '+905551000004', tableId: tables['12'].id, confirmedAt: now },
    { num: 'R-2005', date: tomorrow, start: '13:00', end: '14:30', guests: 2, status: 'CONFIRMED', name: 'Fatma Aksoy', phone: '+905551000003', tableId: tables['3'].id, confirmedAt: now },
    { num: 'R-2006', date: tomorrow, start: '19:30', end: '21:30', guests: 8, status: 'PENDING', name: 'Hasan Korkmaz', phone: '+905551000002', tableId: tables['12'].id },
    { num: 'R-2007', date: tomorrow, start: '20:00', end: '22:00', guests: 3, status: 'CONFIRMED', name: 'Nurgul Ozkan', phone: '+905551000009', tableId: tables['7'].id, confirmedAt: now },
    { num: 'R-2008', date: threeDaysOut, start: '19:00', end: '21:00', guests: 5, status: 'CANCELLED', name: 'Burak Cetin', phone: '+905551000006', cancelledAt: now, cancelledBy: 'customer' },
  ];

  for (const r of reservationData) {
    await prisma.reservation.create({
      data: {
        reservationNumber: r.num,
        date: r.date,
        startTime: r.start,
        endTime: r.end,
        guestCount: r.guests,
        status: r.status,
        customerName: r.name,
        customerPhone: r.phone,
        customerEmail: (r as any).email || null,
        tableId: (r as any).tableId || null,
        confirmedAt: (r as any).confirmedAt || null,
        seatedAt: (r as any).seatedAt || null,
        completedAt: (r as any).completedAt || null,
        cancelledAt: (r as any).cancelledAt || null,
        cancelledBy: (r as any).cancelledBy || null,
        tenantId: tenant.id,
      },
    });
  }

  console.log('✅ 8 reservations created');

  // ── Stock Movements ────────────────────────────────────────────────
  const stockMovements = [
    { product: 'Adana Kebap', type: 'IN', qty: 30, reason: 'Sabah teslimat', user: 'mustafa' },
    { product: 'Urfa Kebap', type: 'IN', qty: 25, reason: 'Sabah teslimat', user: 'mustafa' },
    { product: 'Kuzu Pirzola', type: 'IN', qty: 20, reason: 'Kasap teslimat', user: 'mustafa' },
    { product: 'Serpme Kahvalti', type: 'IN', qty: 15, reason: 'Kahvalti malzemesi', user: 'mustafa' },
    { product: 'Kunefe', type: 'OUT', qty: 2, reason: 'Bozulma - fire', user: 'mustafa' },
    { product: 'Baklava', type: 'OUT', qty: 3, reason: 'Son kullanma tarihi gecmis', user: 'mustafa' },
    { product: 'Ayran', type: 'ADJUSTMENT', qty: 50, reason: 'Sayim duzeltme', user: 'elif' },
    { product: 'Cay', type: 'ADJUSTMENT', qty: 200, reason: 'Gunluk sayim', user: 'elif' },
  ];

  for (const sm of stockMovements) {
    await prisma.stockMovement.create({
      data: {
        type: sm.type,
        quantity: sm.qty,
        reason: sm.reason,
        productId: products[sm.product].id,
        userId: users[sm.user].id,
        tenantId: tenant.id,
      },
    });
  }

  console.log('✅ 8 stock movements created');

  // ── Settings ───────────────────────────────────────────────────────
  await prisma.qrMenuSettings.create({
    data: {
      tenantId: tenant.id,
      primaryColor: '#C62828',
      secondaryColor: '#1A237E',
      backgroundColor: '#FFF8E1',
      fontFamily: 'Nunito',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: true,
      showImages: true,
      layoutStyle: 'GRID',
      itemsPerRow: 2,
      enableTableQR: true,
      tableQRMessage: 'Menumuz icin QR kodu okutunuz',
    },
  });

  await prisma.posSettings.create({
    data: {
      tenantId: tenant.id,
      enableTablelessMode: false,
      enableTwoStepCheckout: true,
      showProductImages: true,
      enableCustomerOrdering: true,
      defaultMapView: '2d',
    },
  });

  await prisma.reservationSettings.create({
    data: {
      tenantId: tenant.id,
      isEnabled: true,
      requireApproval: true,
      timeSlotInterval: 30,
      minAdvanceBooking: 60,
      maxAdvanceDays: 30,
      defaultDuration: 90,
      maxGuestsPerReservation: 20,
      operatingHours: {
        monday: { open: '08:00', close: '23:00' },
        tuesday: { open: '08:00', close: '23:00' },
        wednesday: { open: '08:00', close: '23:00' },
        thursday: { open: '08:00', close: '23:00' },
        friday: { open: '08:00', close: '00:00' },
        saturday: { open: '08:00', close: '00:00' },
        sunday: { open: '09:00', close: '23:00' },
      },
      bannerTitle: 'Sultanahmet Sofra\'ya Hos Geldiniz',
      bannerDescription: 'Geleneksel Turk mutfaginin en guzel lezzetleri',
      customMessage: 'Rezervasyonunuz onaylandiktan sonra size bilgi verilecektir.',
    },
  });

  console.log('✅ Settings created (QR Menu, POS, Reservations)');

  // ── Delivery Platform Configs ──────────────────────────────────────
  const platforms = ['YEMEKSEPETI', 'GETIR', 'TRENDYOL', 'MIGROS'];
  for (const platform of platforms) {
    await prisma.deliveryPlatformConfig.create({
      data: {
        platform,
        isEnabled: true,
        restaurantOpen: true,
        autoAccept: platform === 'YEMEKSEPETI' || platform === 'GETIR',
        remoteRestaurantId: `${platform.toLowerCase()}-sultanahmet-001`,
        tenantId: tenant.id,
      },
    });
  }

  console.log('✅ 4 delivery platform configs created');

  // ── Subscription ───────────────────────────────────────────────────
  const periodStart = new Date();
  const periodEnd = new Date(); periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planId: businessPlan.id,
      status: 'ACTIVE',
      billingCycle: 'YEARLY',
      paymentProvider: 'PAYTR',
      startDate: periodStart,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      amount: 1999.99,
      currency: 'TRY',
      autoRenew: true,
      cancelAtPeriodEnd: false,
    },
  });

  console.log('✅ Active BUSINESS subscription created');

  // ── Notifications ──────────────────────────────────────────────────
  const notificationData = [
    { title: 'Dusuk Stok Uyarisi', message: 'Kuzu Pirzola stogu 5 adetten az. Lutfen siparis verin.', type: 'STOCK', priority: 'HIGH' },
    { title: 'Yeni Rezervasyon', message: 'Hasan Korkmaz 8 kisilik yarin aksam 19:30 icin rezervasyon talebi olusturdu.', type: 'INFO', priority: 'NORMAL' },
    { title: 'Yemeksepeti Siparisi', message: 'Yeni Yemeksepeti siparisi alindi: Karisik Izgara, Coban Salata, 2x Ayran.', type: 'ORDER', priority: 'HIGH' },
    { title: 'Gunluk Rapor', message: 'Dunku toplam ciro: 12.450 TL | Toplam siparis: 47 | Ortalama siparis: 264.89 TL', type: 'INFO', priority: 'LOW' },
    { title: 'QR Menu Siparisi Bekliyor', message: 'Masa 2\'den yeni QR menu siparisi onay bekliyor.', type: 'ORDER', priority: 'NORMAL' },
  ];

  for (const n of notificationData) {
    await prisma.notification.create({
      data: {
        ...n,
        isGlobal: true,
        tenantId: tenant.id,
      },
    });
  }

  console.log('✅ 5 notifications created');

  // ── Done ───────────────────────────────────────────────────────────
  console.log(`
  ========================================
  🎉 Sultanahmet Sofra demo seeded!
  ========================================

  Login Credentials:

  Admin:
    Email: ahmet@sultanahmet-sofra.com
    Password: demo123

  Manager:
    Email: elif@sultanahmet-sofra.com
    Password: demo123

  Waiter:
    Email: mehmet@sultanahmet-sofra.com
    Password: demo123

  Waiter:
    Email: zeynep@sultanahmet-sofra.com
    Password: demo123

  Kitchen:
    Email: mustafa@sultanahmet-sofra.com
    Password: demo123

  ========================================
  `);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding demo:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
