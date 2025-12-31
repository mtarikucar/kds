import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformType } from '../constants';
import {
  CreateProductMappingDto,
  UpdateProductMappingDto,
  BulkProductMappingDto,
  ProductMappingQueryDto,
} from '../dto';

@Controller('admin/integrations/mappings')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class ProductMappingController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List product mappings for a platform
   */
  @Get(':platformType/products')
  async listProductMappings(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Query() query: ProductMappingQueryDto,
  ) {
    const tenantId = req.user.tenantId;

    const where: any = { tenantId, platformType };

    if (query.isEnabled !== undefined) {
      where.isEnabled = query.isEnabled;
    }

    const [mappings, total] = await Promise.all([
      this.prisma.platformProductMapping.findMany({
        where,
        include: {
          product: {
            include: {
              category: true,
            },
          },
        },
        take: query.limit || 50,
        skip: query.offset || 0,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.platformProductMapping.count({ where }),
    ]);

    return { mappings, total };
  }

  /**
   * Get unmapped products for a platform
   */
  @Get(':platformType/unmapped')
  async getUnmappedProducts(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Query() query: ProductMappingQueryDto,
  ) {
    const tenantId = req.user.tenantId;

    // Get all mapped product IDs
    const mappedProductIds = await this.prisma.platformProductMapping.findMany({
      where: { tenantId, platformType },
      select: { productId: true },
    });

    const mappedIds = mappedProductIds.map((m) => m.productId);

    // Get products that aren't mapped
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        id: { notIn: mappedIds },
        isAvailable: true,
      },
      include: {
        category: true,
      },
      take: query.limit || 50,
      skip: query.offset || 0,
    });

    const total = await this.prisma.product.count({
      where: {
        tenantId,
        id: { notIn: mappedIds },
        isAvailable: true,
      },
    });

    return { products, total };
  }

  /**
   * Create a product mapping
   */
  @Post(':platformType/products')
  async createProductMapping(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Body() dto: CreateProductMappingDto,
  ) {
    const tenantId = req.user.tenantId;

    // Verify product exists
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const mapping = await this.prisma.platformProductMapping.create({
      data: {
        tenantId,
        platformType,
        productId: dto.productId,
        platformProductId: dto.platformProductId,
        platformCategoryId: dto.platformCategoryId,
        syncPrice: dto.syncPrice ?? true,
        syncAvailability: dto.syncAvailability ?? true,
        priceMultiplier: dto.priceMultiplier ?? 1.0,
      },
      include: { product: true },
    });

    return mapping;
  }

  /**
   * Bulk create product mappings
   */
  @Post(':platformType/products/bulk')
  async bulkCreateMappings(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Body() dto: BulkProductMappingDto,
  ) {
    const tenantId = req.user.tenantId;

    const results = await Promise.all(
      dto.mappings.map(async (mapping) => {
        try {
          return await this.prisma.platformProductMapping.create({
            data: {
              tenantId,
              platformType,
              productId: mapping.productId,
              platformProductId: mapping.platformProductId,
              platformCategoryId: mapping.platformCategoryId,
              syncPrice: mapping.syncPrice ?? true,
              syncAvailability: mapping.syncAvailability ?? true,
              priceMultiplier: mapping.priceMultiplier ?? 1.0,
            },
          });
        } catch (error: any) {
          return { error: error.message, productId: mapping.productId };
        }
      }),
    );

    const successful = results.filter((r) => !('error' in r));
    const failed = results.filter((r) => 'error' in r);

    return {
      created: successful.length,
      failed: failed.length,
      errors: failed,
    };
  }

  /**
   * Update a product mapping
   */
  @Patch(':platformType/products/:id')
  async updateProductMapping(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Param('id') id: string,
    @Body() dto: UpdateProductMappingDto,
  ) {
    const tenantId = req.user.tenantId;

    const mapping = await this.prisma.platformProductMapping.findFirst({
      where: { id, tenantId, platformType },
    });

    if (!mapping) {
      throw new NotFoundException('Mapping not found');
    }

    return this.prisma.platformProductMapping.update({
      where: { id },
      data: dto,
      include: { product: true },
    });
  }

  /**
   * Delete a product mapping
   */
  @Delete(':platformType/products/:id')
  async deleteProductMapping(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenantId;

    const mapping = await this.prisma.platformProductMapping.findFirst({
      where: { id, tenantId, platformType },
    });

    if (!mapping) {
      throw new NotFoundException('Mapping not found');
    }

    await this.prisma.platformProductMapping.delete({ where: { id } });

    return { success: true };
  }
}
