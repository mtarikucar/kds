import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function completeMigration() {
  console.log('Completing migration...\n');

  try {
    // 1. Migrate existing data (without order column since it was dropped)
    console.log('1. Migrating existing product-image relationships...');
    await prisma.$executeRawUnsafe(`
      INSERT INTO "product_to_images" ("id", "order", "productId", "imageId", "createdAt")
      SELECT
        gen_random_uuid(),
        0,
        "productId",
        "id",
        "createdAt"
      FROM "product_images"
      WHERE "productId" IS NOT NULL
      ON CONFLICT ("productId", "imageId") DO NOTHING
    `);
    console.log('✓ Data migrated\n');

    // 2. Drop productId column from product_images
    console.log('2. Dropping productId column from product_images...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "product_images" DROP COLUMN IF EXISTS "productId"
    `);
    console.log('✓ Column dropped\n');

    console.log('✓ Migration completed successfully!\n');

    // Verify
    const junctionCount = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM product_to_images`;
    console.log('ProductToImage records:', junctionCount);

    const imageColumns = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'product_images'
      ORDER BY ordinal_position
    `;
    console.log('\nproduct_images columns:', imageColumns);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

completeMigration();
