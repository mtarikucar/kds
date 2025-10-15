const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create subscription plans
  const freePlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'FREE' },
    update: {},
    create: {
      name: 'FREE',
      displayName: 'Free Plan',
      description: 'Perfect for small restaurants getting started',
      monthlyPrice: 0,
      yearlyPrice: 0,
      currency: 'USD',
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
      isActive: true,
    },
  });

  const basicPlan = await prisma.subscriptionPlan.upsert({
    where: { name: 'BASIC' },
    update: {},
    create: {
      name: 'BASIC',
      displayName: 'Basic Plan',
      description: 'Great for growing restaurants',
      monthlyPrice: 29.99,
      yearlyPrice: 299.99,
      currency: 'USD',
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
      isActive: true,
    },
  });

  console.log('✅ Subscription plans created');

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Demo Restaurant',
      subdomain: 'demo',
      status: 'ACTIVE',
      currentPlanId: freePlan.id,
    },
  });

  console.log('✅ Tenant created:', tenant.name);

  // Create users
  const hashedPassword = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@restaurant.com',
      password: hashedPassword,
      firstName: 'John',
      lastName: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      tenantId: tenant.id,
    },
  });

  const waiter = await prisma.user.create({
    data: {
      email: 'waiter@restaurant.com',
      password: hashedPassword,
      firstName: 'Jane',
      lastName: 'Waiter',
      role: 'WAITER',
      status: 'ACTIVE',
      tenantId: tenant.id,
    },
  });

  const kitchen = await prisma.user.create({
    data: {
      email: 'kitchen@restaurant.com',
      password: hashedPassword,
      firstName: 'Mike',
      lastName: 'Chef',
      role: 'KITCHEN',
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
    ],
  });

  console.log('✅ Tables created');

  console.log(`
  ========================================
  🎉 Database seeded successfully!
  ========================================

  Default Login Credentials:

  Admin:
    Email: admin@restaurant.com
    Password: password123

  Waiter:
    Email: waiter@restaurant.com
    Password: password123

  Kitchen:
    Email: kitchen@restaurant.com
    Password: password123

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
