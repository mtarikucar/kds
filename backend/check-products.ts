import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkProducts() {
  console.log('Checking products and their images...\n');

  try {
    const products = await prisma.product.findMany({
      include: {
        images: {
          orderBy: { order: 'asc' },
        },
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    console.log(`Found ${products.length} products:\n`);

    products.forEach((product) => {
      console.log(`Product: ${product.name} (ID: ${product.id})`);
      console.log(`  Category: ${product.category.name}`);
      console.log(`  Images: ${product.images.length}`);
      if (product.images.length > 0) {
        product.images.forEach((img, idx) => {
          console.log(`    ${idx + 1}. ${img.filename} (order: ${img.order})`);
        });
      } else {
        console.log(`    No images attached`);
      }
      console.log('');
    });

    // Check unused images
    const unusedImages = await prisma.productImage.findMany({
      where: {
        productId: null,
      },
    });

    console.log(`\nUnused images (${unusedImages.length}):`);
    unusedImages.forEach((img) => {
      console.log(`  - ${img.filename} (ID: ${img.id})`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkProducts();
