import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('Applying migration: add_product_to_image_junction_table\n');

  try {
    // 1. Create the junction table
    console.log('1. Creating product_to_images table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "product_to_images" (
        "id" TEXT NOT NULL,
        "order" INTEGER NOT NULL DEFAULT 0,
        "productId" TEXT NOT NULL,
        "imageId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "product_to_images_pkey" PRIMARY KEY ("id")
      )
    `);
    console.log('✓ Table created\n');

    // 2. Create indexes
    console.log('2. Creating indexes...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_to_images_productId_order_idx"
      ON "product_to_images"("productId", "order")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "product_to_images_imageId_idx"
      ON "product_to_images"("imageId")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "product_to_images_productId_imageId_key"
      ON "product_to_images"("productId", "imageId")
    `);
    console.log('✓ Indexes created\n');

    // 3. Add foreign keys
    console.log('3. Adding foreign keys...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "product_to_images"
      DROP CONSTRAINT IF EXISTS "product_to_images_productId_fkey"
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "product_to_images"
      ADD CONSTRAINT "product_to_images_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "product_to_images"
      DROP CONSTRAINT IF EXISTS "product_to_images_imageId_fkey"
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "product_to_images"
      ADD CONSTRAINT "product_to_images_imageId_fkey"
      FOREIGN KEY ("imageId") REFERENCES "product_images"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
    `);
    console.log('✓ Foreign keys added\n');

    // 4. Migrate existing data
    console.log('4. Migrating existing product-image relationships...');
    const result = await prisma.$executeRawUnsafe(`
      INSERT INTO "product_to_images" ("id", "order", "productId", "imageId", "createdAt")
      SELECT
        gen_random_uuid(),
        COALESCE("order", 0),
        "productId",
        "id",
        "createdAt"
      FROM "product_images"
      WHERE "productId" IS NOT NULL
      ON CONFLICT ("productId", "imageId") DO NOTHING
    `);
    console.log(`✓ Migrated ${result} relationships\n`);

    // 5. Drop old columns
    console.log('5. Dropping old columns from product_images...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "product_images" DROP COLUMN IF EXISTS "productId"
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "product_images" DROP COLUMN IF EXISTS "order"
    `);
    console.log('✓ Old columns dropped\n');

    console.log('✓ Migration completed successfully!\n');

    // Verify
    const junctionCount = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM product_to_images`;
    console.log('ProductToImage records:', junctionCount);

  } catch (error) {
    console.error('Error applying migration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

applyMigration();
