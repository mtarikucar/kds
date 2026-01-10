import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // Helper method to transform product response
  private transformProductResponse(product: any) {
    if (!product) return null;

    // Transform productImages array to images array
    const images = product.productImages?.map((pti: any) => ({
      ...pti.image,
      order: pti.order,
    })) || [];

    // Transform modifierGroups from junction table format
    const modifierGroups = product.modifierGroups?.map((pmg: any) => ({
      ...pmg.group,
      displayOrder: pmg.displayOrder,
    })).sort((a: any, b: any) => a.displayOrder - b.displayOrder) || [];

    // Remove productImages and modifierGroups junction table, add transformed versions
    const { productImages, modifierGroups: _, ...rest } = product;
    return {
      ...rest,
      images,
      modifierGroups,
    };
  }

  async create(createProductDto: CreateProductDto, tenantId: string) {
    // Verify category exists and belongs to tenant
    const category = await this.prisma.category.findFirst({
      where: {
        id: createProductDto.categoryId,
        tenantId,
      },
    });

    if (!category) {
      throw new BadRequestException('Invalid category or category does not belong to your tenant');
    }

    // Create product first
    const product = await this.prisma.product.create({
      data: {
        name: createProductDto.name,
        description: createProductDto.description,
        price: createProductDto.price,
        image: createProductDto.image,
        isAvailable: createProductDto.isAvailable ?? true,
        stockTracked: createProductDto.stockTracked ?? false,
        currentStock: createProductDto.currentStock ?? 0,
        categoryId: createProductDto.categoryId,
        tenantId,
      },
      include: {
        category: true,
        productImages: {
          include: {
            image: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    // Attach images if provided
    if (createProductDto.imageIds && createProductDto.imageIds.length > 0) {
      await this.attachImagesToProduct(product.id, createProductDto.imageIds, tenantId);

      // Fetch updated product with images
      return this.findOne(product.id, tenantId);
    }

    return this.transformProductResponse(product);
  }

  async findAll(tenantId: string, categoryId?: string) {
    const where: any = { tenantId };
    if (categoryId) {
      where.categoryId = categoryId;
    }

    const products = await this.prisma.product.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        productImages: {
          include: {
            image: true,
          },
          orderBy: { order: 'asc' },
        },
        modifierGroups: {
          include: {
            group: {
              include: {
                modifiers: {
                  where: { isAvailable: true },
                  orderBy: { displayOrder: 'asc' },
                },
              },
            },
          },
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return products.map(product => this.transformProductResponse(product));
  }

  async findOne(id: string, tenantId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        category: true,
        productImages: {
          include: {
            image: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.transformProductResponse(product);
  }

  async update(id: string, updateProductDto: UpdateProductDto, tenantId: string) {
    // Check if product exists and belongs to tenant
    await this.findOne(id, tenantId);

    // If category is being updated, verify it exists and belongs to tenant
    if (updateProductDto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: {
          id: updateProductDto.categoryId,
          tenantId,
        },
      });

      if (!category) {
        throw new BadRequestException('Invalid category or category does not belong to your tenant');
      }
    }

    // Extract imageIds from DTO
    const { imageIds, ...productData } = updateProductDto;

    // Update product
    await this.prisma.product.update({
      where: { id },
      data: productData,
    });

    // Update images if provided
    if (imageIds !== undefined) {
      // Delete all current product-image links from junction table
      await this.prisma.productToImage.deleteMany({
        where: { productId: id },
      });

      // Attach new images if any
      if (imageIds.length > 0) {
        await this.attachImagesToProduct(id, imageIds, tenantId);
      }
    }

    // Return updated product with relations
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    // Check if product exists and belongs to tenant
    await this.findOne(id, tenantId);

    return this.prisma.product.delete({
      where: { id },
    });
  }

  async updateStock(id: string, quantity: number, tenantId: string) {
    // Check if product exists and belongs to tenant
    const product = await this.findOne(id, tenantId);

    if (!product.stockTracked) {
      throw new BadRequestException('Stock tracking is not enabled for this product');
    }

    const newStock = product.currentStock + quantity;

    if (newStock < 0) {
      throw new BadRequestException('Insufficient stock');
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: {
        currentStock: newStock,
        isAvailable: newStock > 0,
      },
      include: {
        category: true,
        productImages: {
          include: {
            image: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    return this.transformProductResponse(updatedProduct);
  }

  // Image management methods
  private async attachImagesToProduct(
    productId: string,
    imageIds: string[],
    tenantId: string,
  ): Promise<void> {
    // Verify all images exist and belong to tenant
    for (const imageId of imageIds) {
      const image = await this.prisma.productImage.findFirst({
        where: {
          id: imageId,
          tenantId,
        },
      });

      if (!image) {
        throw new BadRequestException(`Image ${imageId} not found or does not belong to your tenant`);
      }
    }

    // Attach images with proper ordering using junction table
    for (let i = 0; i < imageIds.length; i++) {
      // Use upsert to handle duplicates gracefully
      await this.prisma.productToImage.upsert({
        where: {
          productId_imageId: {
            productId,
            imageId: imageIds[i],
          },
        },
        update: {
          order: i,
        },
        create: {
          productId,
          imageId: imageIds[i],
          order: i,
        },
      });
    }
  }

  async getProductImages(productId: string, tenantId: string) {
    // Verify product exists and belongs to tenant
    await this.findOne(productId, tenantId);

    const productToImages = await this.prisma.productToImage.findMany({
      where: {
        productId,
        image: {
          tenantId,
        },
      },
      include: {
        image: true,
      },
      orderBy: { order: 'asc' },
    });

    return productToImages.map(pti => ({
      ...pti.image,
      order: pti.order,
    }));
  }

  async reorderProductImages(
    productId: string,
    imageIds: string[],
    tenantId: string,
  ) {
    // Verify product exists and belongs to tenant
    const product = await this.findOne(productId, tenantId);

    // Verify all images belong to this product via junction table
    const existingLinks = await this.prisma.productToImage.findMany({
      where: {
        productId,
        image: {
          tenantId,
        },
      },
      include: {
        image: true,
      },
    });

    if (existingLinks.length !== imageIds.length) {
      throw new BadRequestException('Image count mismatch');
    }

    // Update order for each image in junction table
    for (let i = 0; i < imageIds.length; i++) {
      const link = existingLinks.find(l => l.imageId === imageIds[i]);
      if (!link) {
        throw new BadRequestException(`Image ${imageIds[i]} does not belong to this product`);
      }

      await this.prisma.productToImage.update({
        where: {
          productId_imageId: {
            productId,
            imageId: imageIds[i],
          },
        },
        data: { order: i },
      });
    }

    return this.getProductImages(productId, tenantId);
  }

  async removeImageFromProduct(
    productId: string,
    imageId: string,
    tenantId: string,
  ) {
    // Verify product exists and belongs to tenant
    await this.findOne(productId, tenantId);

    // Verify link exists in junction table
    const link = await this.prisma.productToImage.findUnique({
      where: {
        productId_imageId: {
          productId,
          imageId,
        },
      },
      include: {
        image: true,
      },
    });

    if (!link || link.image.tenantId !== tenantId) {
      throw new NotFoundException('Image not found on this product');
    }

    // Delete the link from junction table (image stays in library for reuse)
    await this.prisma.productToImage.delete({
      where: {
        productId_imageId: {
          productId,
          imageId,
        },
      },
    });

    // Reorder remaining images in junction table
    const remainingLinks = await this.prisma.productToImage.findMany({
      where: {
        productId,
        image: {
          tenantId,
        },
      },
      orderBy: { order: 'asc' },
    });

    for (let i = 0; i < remainingLinks.length; i++) {
      await this.prisma.productToImage.update({
        where: {
          productId_imageId: {
            productId,
            imageId: remainingLinks[i].imageId,
          },
        },
        data: { order: i },
      });
    }

    return this.getProductImages(productId, tenantId);
  }
}
