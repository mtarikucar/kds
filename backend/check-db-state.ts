import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDbState() {
  console.log('Checking database state...\n');

  try {
    // Check if product_images still has productId column
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'product_images'
      ORDER BY ordinal_position
    `;

    console.log('product_images columns:');
    console.log(columns);
    console.log('');

    // Check if product_to_images table exists
    const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'product_to_images'
      )
    `;
    console.log('product_to_images exists:', tableExists);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDbState();
