import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixProductImages() {
  console.log('Starting product images fix...');

  try {
    // Find all product images with empty string productId
    const brokenImages = await prisma.$queryRaw`
      SELECT id, "productId", filename
      FROM product_images
      WHERE "productId" = ''
    `;

    console.log(`Found ${(brokenImages as any[]).length} images with empty string productId`);

    if ((brokenImages as any[]).length > 0) {
      // Update them to null
      const result = await prisma.$executeRaw`
        UPDATE product_images
        SET "productId" = NULL
        WHERE "productId" = ''
      `;

      console.log(`Updated ${result} images to have NULL productId`);
    }

    // Check current state
    const allImages = await prisma.productImage.findMany({
      select: {
        id: true,
        filename: true,
        productId: true,
      },
    });

    console.log('\nCurrent product images state:');
    allImages.forEach((img) => {
      console.log(`- ${img.filename}: productId=${img.productId || 'NULL'}`);
    });

    console.log('\nFix completed successfully!');
  } catch (error) {
    console.error('Error fixing product images:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixProductImages();
