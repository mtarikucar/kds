import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { UserRole } from '../src/common/constants/roles.enum';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create subscription plans. The `update` branch mirrors every field
  // that can drift after the first seed (prices/currency/displayName);
  // otherwise re-running `prisma:seed` keeps stale USD numbers when the
  // codebase has migrated to TRY.
  // FREE plan is the post-trial fallback, not a self-serve choice.
  // Registration grants an automatic 14-day BUSINESS trial; when that
  // trial expires without a paid subscription the tenant falls through
  // to FREE (PlanFeatureGuard treats FREE as live without requiring an
  // active Subscription row).
  //
  // The plan stays `isActive: true` so /subscriptions/plans and
  // /superadmin/plans still surface it for internal consumers (the
  // PlanFeatureGuard, the post-trial scheduler, e2e tests). The
  // landing page deliberately omits it from the public pricing grid
  // — see landing/src/components/sections/Pricing.tsx.
  const freePlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'FREE' },
    update: {
      displayName: 'Ücretsiz',
      description: 'Deneme sürümü sona erdiğinde kullanılan kısıtlı plan',
      monthlyPrice: 0,
      yearlyPrice: 0,
      currency: 'TRY',
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      inventoryTracking: false,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
      deliveryIntegration: false,
    },
    create: {
      name: 'FREE',
      displayName: 'Ücretsiz',
      description: 'Deneme sürümü sona erdiğinde kullanılan kısıtlı plan',
      monthlyPrice: 0,
      yearlyPrice: 0,
      currency: 'TRY',
      trialDays: 0,
      maxUsers: 2,
      maxTables: 5,
      maxProducts: 25,
      maxCategories: 5,
      maxMonthlyOrders: 50,
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      inventoryTracking: false,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
      deliveryIntegration: false,
      isActive: true,
    },
  });

  const basicPlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'BASIC' },
    update: {
      displayName: 'Başlangıç',
      description: 'Kafe ve küçük restoranlar için temel POS + stok takibi',
      monthlyPrice: 499,
      yearlyPrice: 4490, // 2 ay bedava (10 ay × 499 = 4990 → 4490 promosyon)
      currency: 'TRY',
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
      deliveryIntegration: false,
    },
    create: {
      name: 'BASIC',
      displayName: 'Başlangıç',
      description: 'Kafe ve küçük restoranlar için temel POS + stok takibi',
      monthlyPrice: 499,
      yearlyPrice: 4490,
      currency: 'TRY',
      trialDays: 14,
      maxUsers: 5,
      maxTables: 20,
      maxProducts: 100,
      maxCategories: 20,
      maxMonthlyOrders: 500,
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
      deliveryIntegration: false,
      isActive: true,
    },
  });

  const proPlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'PRO' },
    update: {
      displayName: 'Profesyonel',
      description: 'Şehir merkezi restoranlar için rezervasyon + delivery + personel takibi',
      monthlyPrice: 1299,
      yearlyPrice: 12990, // 2 ay bedava (10 ay × 1299 = 12990 düz)
      currency: 'TRY',
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: false,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
      deliveryIntegration: true,
    },
    create: {
      name: 'PRO',
      displayName: 'Profesyonel',
      description: 'Şehir merkezi restoranlar için rezervasyon + delivery + personel takibi',
      monthlyPrice: 1299,
      yearlyPrice: 12990,
      currency: 'TRY',
      trialDays: 14,
      maxUsers: 15,
      maxTables: 50,
      maxProducts: 500,
      maxCategories: 50,
      maxMonthlyOrders: 2000,
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: false,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
      deliveryIntegration: true,
      isActive: true,
    },
  });

  const businessPlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'BUSINESS' },
    update: {
      displayName: 'Kurumsal',
      description: 'Çok şubeli zincirler için sınırsız + API erişimi + öncelikli destek',
      monthlyPrice: 2999,
      yearlyPrice: 29990, // 2 ay bedava (10 ay × 2999 = 29990 düz)
      currency: 'TRY',
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
      deliveryIntegration: true,
    },
    create: {
      name: 'BUSINESS',
      displayName: 'Kurumsal',
      description: 'Çok şubeli zincirler için sınırsız + API erişimi + öncelikli destek',
      monthlyPrice: 2999,
      yearlyPrice: 29990,
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
      deliveryIntegration: true,
      isActive: true,
    },
  });

  console.log('✅ Subscription plans created');

  // Upsert tenant and users so re-running the seed against an existing
  // DB no longer hits @@unique constraints. The previous `create` calls
  // worked exactly once per database — every subsequent run blew up on
  // `subdomain` or `email` collision and required a manual reset.
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: 'demo' },
    update: {},
    create: {
      name: 'Demo Restaurant',
      subdomain: 'demo',
      status: 'ACTIVE',
      currentPlanId: freePlan.id,
    },
  });

  console.log('✅ Tenant created:', tenant.name);

  // Create users
  const hashedPassword = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@restaurant.com' },
    update: {},
    create: {
      email: 'admin@restaurant.com',
      password: hashedPassword,
      firstName: 'John',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      status: 'ACTIVE',
      tenantId: tenant.id,
    },
  });

  const waiter = await prisma.user.upsert({
    where: { email: 'waiter@restaurant.com' },
    update: {},
    create: {
      email: 'waiter@restaurant.com',
      password: hashedPassword,
      firstName: 'Jane',
      lastName: 'Waiter',
      role: UserRole.WAITER,
      status: 'ACTIVE',
      tenantId: tenant.id,
    },
  });

  const kitchen = await prisma.user.upsert({
    where: { email: 'kitchen@restaurant.com' },
    update: {},
    create: {
      email: 'kitchen@restaurant.com',
      password: hashedPassword,
      firstName: 'Mike',
      lastName: 'Chef',
      role: UserRole.KITCHEN,
      status: 'ACTIVE',
      tenantId: tenant.id,
    },
  });

  console.log('✅ Users created');

  // Create categories
  const appetizers = await prisma.category.create({
    data: {
      name: 'Appetizers',
      description: 'Start your meal with our delicious starters',
      displayOrder: 1,
      isActive: true,
      tenantId: tenant.id,
    },
  });

  const mains = await prisma.category.create({
    data: {
      name: 'Main Courses',
      description: 'Our signature main dishes',
      displayOrder: 2,
      isActive: true,
      tenantId: tenant.id,
    },
  });

  const desserts = await prisma.category.create({
    data: {
      name: 'Desserts',
      description: 'Sweet endings to your meal',
      displayOrder: 3,
      isActive: true,
      tenantId: tenant.id,
    },
  });

  const beverages = await prisma.category.create({
    data: {
      name: 'Beverages',
      description: 'Refreshing drinks',
      displayOrder: 4,
      isActive: true,
      tenantId: tenant.id,
    },
  });

  console.log('✅ Categories created');

  // Create products
  const products = await prisma.product.createMany({
    data: [
      // Appetizers
      {
        name: 'Caesar Salad',
        description: 'Fresh romaine lettuce with Caesar dressing and croutons',
        price: 8.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 50,
        categoryId: appetizers.id,
        tenantId: tenant.id,
      },
      {
        name: 'Garlic Bread',
        description: 'Toasted bread with garlic butter',
        price: 5.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 30,
        categoryId: appetizers.id,
        tenantId: tenant.id,
      },
      {
        name: 'Buffalo Wings',
        description: 'Spicy chicken wings with ranch dressing',
        price: 12.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 25,
        categoryId: appetizers.id,
        tenantId: tenant.id,
      },
      // Main Courses
      {
        name: 'Grilled Salmon',
        description: 'Fresh Atlantic salmon with vegetables',
        price: 24.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 15,
        categoryId: mains.id,
        tenantId: tenant.id,
      },
      {
        name: 'Beef Burger',
        description: 'Premium beef patty with cheese and fries',
        price: 15.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 40,
        categoryId: mains.id,
        tenantId: tenant.id,
      },
      {
        name: 'Pasta Carbonara',
        description: 'Classic Italian pasta with creamy sauce',
        price: 16.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 35,
        categoryId: mains.id,
        tenantId: tenant.id,
      },
      {
        name: 'Chicken Tikka Masala',
        description: 'Marinated chicken in spicy tomato sauce',
        price: 18.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 20,
        categoryId: mains.id,
        tenantId: tenant.id,
      },
      // Desserts
      {
        name: 'Chocolate Lava Cake',
        description: 'Warm chocolate cake with molten center',
        price: 7.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 22,
        categoryId: desserts.id,
        tenantId: tenant.id,
      },
      {
        name: 'Tiramisu',
        description: 'Classic Italian coffee-flavored dessert',
        price: 8.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 18,
        categoryId: desserts.id,
        tenantId: tenant.id,
      },
      {
        name: 'Ice Cream Sundae',
        description: 'Three scoops with toppings',
        price: 6.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 50,
        categoryId: desserts.id,
        tenantId: tenant.id,
      },
      // Beverages
      {
        name: 'Coca Cola',
        description: 'Refreshing soft drink',
        price: 2.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 100,
        categoryId: beverages.id,
        tenantId: tenant.id,
      },
      {
        name: 'Fresh Orange Juice',
        description: 'Freshly squeezed orange juice',
        price: 4.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 30,
        categoryId: beverages.id,
        tenantId: tenant.id,
      },
      {
        name: 'Coffee',
        description: 'Freshly brewed coffee',
        price: 3.99,
        isAvailable: true,
        stockTracked: false,
        currentStock: 0,
        categoryId: beverages.id,
        tenantId: tenant.id,
      },
    ],
  });

  console.log('✅ Products created');

  // Create tables
  await prisma.table.createMany({
    data: [
      {
        number: '1',
        capacity: 2,
        section: 'Main Hall',
        status: 'AVAILABLE',
        tenantId: tenant.id,
      },
      {
        number: '2',
        capacity: 4,
        section: 'Main Hall',
        status: 'AVAILABLE',
        tenantId: tenant.id,
      },
      {
        number: '3',
        capacity: 4,
        section: 'Main Hall',
        status: 'AVAILABLE',
        tenantId: tenant.id,
      },
      {
        number: '4',
        capacity: 6,
        section: 'Main Hall',
        status: 'AVAILABLE',
        tenantId: tenant.id,
      },
      {
        number: '5',
        capacity: 2,
        section: 'Terrace',
        status: 'AVAILABLE',
        tenantId: tenant.id,
      },
      {
        number: '6',
        capacity: 4,
        section: 'Terrace',
        status: 'AVAILABLE',
        tenantId: tenant.id,
      },
      {
        number: '7',
        capacity: 8,
        section: 'Private Room',
        status: 'AVAILABLE',
        tenantId: tenant.id,
      },
    ],
  });

  console.log('✅ Tables created');

  // Default credentials are intentionally NOT echoed: this script runs in
  // CI pipelines whose logs are often retained for weeks, and leaking
  // working admin/waiter/kitchen passwords there is a real PII surface
  // even for a "dev" seed (the same DB sometimes gets promoted by accident).
  // Anyone seeding locally can read the constants in this file directly.
  console.log(`
  ========================================
  🎉 Database seeded successfully!
  Default users created: admin@restaurant.com, waiter@restaurant.com, kitchen@restaurant.com
  Passwords are NOT logged — see seed.ts source or your secret store.
  ========================================
  `);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
