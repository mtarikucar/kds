import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function attachTestImage() {
  console.log('Attaching test image to a product...\n');

  try {
    // Get first unused image
    const unusedImage = await prisma.productImage.findFirst({
      where: {
        productId: null,
      },
    });

    if (!unusedImage) {
      console.log('No unused images found');
      return;
    }

    // Get first product
    const product = await prisma.product.findFirst();

    if (!product) {
      console.log('No products found');
      return;
    }

    console.log(`Attaching image "${unusedImage.filename}" to product "${product.name}"...`);

    // Attach image to product
    await prisma.productImage.update({
      where: { id: unusedImage.id },
      data: {
        productId: product.id,
        order: 0,
      },
    });

    console.log('✓ Image attached successfully!\n');

    // Verify
    const updatedProduct = await prisma.product.findUnique({
      where: { id: product.id },
      include: {
        images: {
          orderBy: { order: 'asc' },
        },
      },
    });

    console.log('Product now has', updatedProduct?.images.length, 'image(s):');
    updatedProduct?.images.forEach((img, idx) => {
      console.log(`  ${idx + 1}. ${img.filename}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

attachTestImage();
