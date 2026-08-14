import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { UserRole } from "../src/common/constants/roles.enum";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ==========================================================================
  // NO SUBSCRIPTION PLANS ARE SEEDED — deliberately.
  // ==========================================================================
  //
  // This file used to recreate the retired tiered catalogue here: a TRIAL plan
  // with a 7-day countdown plus BASIC/PRO/BUSINESS at monthly prices, all
  // written with isActive=true and isPublic=true. None of that exists as a
  // product any more. The core (POS/adisyon, KDS, menü, masa+kat planı, QR
  // menü, sipariş, kasa, temel raporlar, ekip+rol, müşteriler, cihaz+şube
  // paneli, özel marka+alan adı) is free and unlimited for every tenant, and
  // everything paid is an individual annual product bought à la carte.
  //
  //   pricing      → src/modules/marketplace/alacarte-catalog.const.ts
  //   free core    → src/modules/entitlements/free-baseline.const.ts
  //   why it went  → src/common/constants/subscription-plans.const.ts
  //
  // WHY REMOVING THEM IS SAFE (the FK question).
  //
  // `20260811140000_retire_subscription_rail` keeps the `subscription_plans`
  // TABLE alive because `subscriptions.planId` is a Restrict FK and the legacy
  // `invoices` hang off `subscriptions` — those are tax records VUK requires
  // retaining. That is an argument about databases that ALREADY hold such
  // rows: do not DELETE what old invoices point at. It says nothing about
  // seeding a new database. A freshly seeded DB has no subscriptions and no
  // invoices, so no FK references a plan row and the empty table satisfies
  // every constraint. Nothing else in the app needs one either: registration
  // creates no plan and no subscription (AuthProvisioningService
  // .provisionNewTenantWithAdmin), entitlements come from the free baseline,
  // and the two fixtures that DO want a plan row mint their own —
  // `prisma/seed-demo.ts` (e2e Sultanahmet) and `DemoService.seed` (the
  // in-app demo tenant, which correctly marks its row isActive/isPublic false).
  //
  // WHY RECREATING THEM WAS ACTIVELY WRONG.
  //
  // `SubscriptionService.getAvailablePlans` selects on exactly
  // `{ isActive: true, isPublic: true }` and is served by the PUBLIC route
  // `GET /subscriptions/plans`. Seeding the paid tiers with both flags true
  // therefore re-published the retired monthly price list on every freshly
  // seeded environment — undoing, one `npx prisma db seed` later, the very
  // flags `20260811120000_free_core` had just switched off. `start.sh`,
  // `start.bat`, README and SETUP all run this seed, so that was the default
  // state of every dev/staging stack.
  //
  // For the same reason the demo tenant below carries NO `currentPlanId` and
  // NO subscription row: that is what a real tenant registered through
  // `POST /auth/register` looks like, and it is what keeps the demo tenant
  // honest. `UsersService.createUser` still enforces `plan.maxUsers` when a
  // live subscription carries a plan, so a seeded subscription would give the
  // local demo tenant a user cap that no real tenant has.

  // Upsert tenant and users so re-running the seed against an existing
  // DB no longer hits @@unique constraints. The previous `create` calls
  // worked exactly once per database — every subsequent run blew up on
  // `subdomain` or `email` collision and required a manual reset.
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: "demo" },
    update: {},
    create: {
      name: "Demo Restaurant",
      subdomain: "demo",
      status: "ACTIVE",
      // No `currentPlanId` and no subscription row — see the header note.
      // The column is null on every tenant since `20260811120000_free_core`,
      // PlanProjectorService ignores it, and a real tenant created through
      // `POST /auth/register` never gets one. The demo tenant matches.
    },
  });

  console.log("✅ Tenant created:", tenant.name);

  // v3.0.0 — every tenant needs at least one branch. The strict
  // branch-scope schema requires Table.branchId, Order.branchId, etc.,
  // so seed must mint a default "Main" branch before any branch-scoped
  // row is created. Upsert keeps the seed idempotent against re-runs.
  const mainBranch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } },
    update: { isHeadquarters: true },
    create: {
      tenantId: tenant.id,
      name: "Main",
      code: "MAIN",
      timezone: "Europe/Istanbul",
      status: "active",
      // The MAIN branch is the tenant's "Merkez/HQ" — home for central devices.
      isHeadquarters: true,
    },
  });

  console.log("✅ Default branch created:", mainBranch.name);

  // Create users
  const hashedPassword = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@restaurant.com" },
    update: {},
    create: {
      email: "admin@restaurant.com",
      password: hashedPassword,
      firstName: "John",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: "ACTIVE",
      tenantId: tenant.id,
    },
  });

  const waiter = await prisma.user.upsert({
    where: { email: "waiter@restaurant.com" },
    update: {},
    create: {
      email: "waiter@restaurant.com",
      password: hashedPassword,
      firstName: "Jane",
      lastName: "Waiter",
      role: UserRole.WAITER,
      status: "ACTIVE",
      tenantId: tenant.id,
      // v3.0.0 — DB CHECK constraint requires hard-restricted roles
      // (WAITER/KITCHEN/COURIER) to carry a primaryBranchId.
      primaryBranchId: mainBranch.id,
    },
  });

  const kitchen = await prisma.user.upsert({
    where: { email: "kitchen@restaurant.com" },
    update: {},
    create: {
      email: "kitchen@restaurant.com",
      password: hashedPassword,
      firstName: "Mike",
      lastName: "Chef",
      role: UserRole.KITCHEN,
      status: "ACTIVE",
      tenantId: tenant.id,
      primaryBranchId: mainBranch.id,
    },
  });

  console.log("✅ Users created");

  // Create categories
  const appetizers = await prisma.category.create({
    data: {
      name: "Appetizers",
      description: "Start your meal with our delicious starters",
      displayOrder: 1,
      isActive: true,
      tenantId: tenant.id,
    },
  });

  const mains = await prisma.category.create({
    data: {
      name: "Main Courses",
      description: "Our signature main dishes",
      displayOrder: 2,
      isActive: true,
      tenantId: tenant.id,
    },
  });

  const desserts = await prisma.category.create({
    data: {
      name: "Desserts",
      description: "Sweet endings to your meal",
      displayOrder: 3,
      isActive: true,
      tenantId: tenant.id,
    },
  });

  const beverages = await prisma.category.create({
    data: {
      name: "Beverages",
      description: "Refreshing drinks",
      displayOrder: 4,
      isActive: true,
      tenantId: tenant.id,
    },
  });

  console.log("✅ Categories created");

  // Create products
  const products = await prisma.product.createMany({
    data: [
      // Appetizers
      {
        name: "Caesar Salad",
        description: "Fresh romaine lettuce with Caesar dressing and croutons",
        price: 8.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 50,
        categoryId: appetizers.id,
        tenantId: tenant.id,
      },
      {
        name: "Garlic Bread",
        description: "Toasted bread with garlic butter",
        price: 5.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 30,
        categoryId: appetizers.id,
        tenantId: tenant.id,
      },
      {
        name: "Buffalo Wings",
        description: "Spicy chicken wings with ranch dressing",
        price: 12.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 25,
        categoryId: appetizers.id,
        tenantId: tenant.id,
      },
      // Main Courses
      {
        name: "Grilled Salmon",
        description: "Fresh Atlantic salmon with vegetables",
        price: 24.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 15,
        categoryId: mains.id,
        tenantId: tenant.id,
      },
      {
        name: "Beef Burger",
        description: "Premium beef patty with cheese and fries",
        price: 15.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 40,
        categoryId: mains.id,
        tenantId: tenant.id,
      },
      {
        name: "Pasta Carbonara",
        description: "Classic Italian pasta with creamy sauce",
        price: 16.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 35,
        categoryId: mains.id,
        tenantId: tenant.id,
      },
      {
        name: "Chicken Tikka Masala",
        description: "Marinated chicken in spicy tomato sauce",
        price: 18.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 20,
        categoryId: mains.id,
        tenantId: tenant.id,
      },
      // Desserts
      {
        name: "Chocolate Lava Cake",
        description: "Warm chocolate cake with molten center",
        price: 7.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 22,
        categoryId: desserts.id,
        tenantId: tenant.id,
      },
      {
        name: "Tiramisu",
        description: "Classic Italian coffee-flavored dessert",
        price: 8.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 18,
        categoryId: desserts.id,
        tenantId: tenant.id,
      },
      {
        name: "Ice Cream Sundae",
        description: "Three scoops with toppings",
        price: 6.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 50,
        categoryId: desserts.id,
        tenantId: tenant.id,
      },
      // Beverages
      {
        name: "Coca Cola",
        description: "Refreshing soft drink",
        price: 2.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 100,
        categoryId: beverages.id,
        tenantId: tenant.id,
      },
      {
        name: "Fresh Orange Juice",
        description: "Freshly squeezed orange juice",
        price: 4.99,
        isAvailable: true,
        stockTracked: true,
        currentStock: 30,
        categoryId: beverages.id,
        tenantId: tenant.id,
      },
      {
        name: "Coffee",
        description: "Freshly brewed coffee",
        price: 3.99,
        isAvailable: true,
        stockTracked: false,
        currentStock: 0,
        categoryId: beverages.id,
        tenantId: tenant.id,
      },
    ],
  });

  console.log("✅ Products created");

  // Create tables
  await prisma.table.createMany({
    data: [
      {
        number: "1",
        capacity: 2,
        section: "Main Hall",
        status: "AVAILABLE",
        tenantId: tenant.id,
        branchId: mainBranch.id,
      },
      {
        number: "2",
        capacity: 4,
        section: "Main Hall",
        status: "AVAILABLE",
        tenantId: tenant.id,
        branchId: mainBranch.id,
      },
      {
        number: "3",
        capacity: 4,
        section: "Main Hall",
        status: "AVAILABLE",
        tenantId: tenant.id,
        branchId: mainBranch.id,
      },
      {
        number: "4",
        capacity: 6,
        section: "Main Hall",
        status: "AVAILABLE",
        tenantId: tenant.id,
        branchId: mainBranch.id,
      },
      {
        number: "5",
        capacity: 2,
        section: "Terrace",
        status: "AVAILABLE",
        tenantId: tenant.id,
        branchId: mainBranch.id,
      },
      {
        number: "6",
        capacity: 4,
        section: "Terrace",
        status: "AVAILABLE",
        tenantId: tenant.id,
        branchId: mainBranch.id,
      },
      {
        number: "7",
        capacity: 8,
        section: "Private Room",
        status: "AVAILABLE",
        tenantId: tenant.id,
        branchId: mainBranch.id,
      },
    ],
  });

  console.log("✅ Tables created");

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
    console.error("❌ Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
