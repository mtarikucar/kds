import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function applyMigration() {
  console.log('Applying migration: add_product_to_image_junction_table\n');

  try {
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'prisma/migrations/20251015000000_add_product_to_image_junction_table/migration.sql'),
      'utf-8'
    );

    // Split by semicolons and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 80)}...`);
      await prisma.$executeRawUnsafe(statement);
      console.log('✓ Success\n');
    }

    console.log('✓ Migration applied successfully!\n');

    // Verify
    const junctionCount = await prisma.$queryRaw`SELECT COUNT(*) FROM product_to_images`;
    console.log('ProductToImage records:', junctionCount);

  } catch (error) {
    console.error('Error applying migration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

applyMigration();
