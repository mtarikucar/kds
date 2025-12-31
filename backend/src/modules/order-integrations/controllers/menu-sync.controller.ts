import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformType } from '../constants';
import { PlatformProviderFactory } from '../services/platform-provider.factory';
import {
  TriggerMenuSyncDto,
  TriggerAvailabilitySyncDto,
  TriggerPriceSyncDto,
  SetRestaurantStatusDto,
} from '../dto';
import { ProductSyncData, CategorySyncData } from '../interfaces';
import { IntegrationType } from '../../../common/constants/integration-types.enum';

@Controller('admin/integrations/sync')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class MenuSyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: PlatformProviderFactory,
  ) {}

  /**
   * Get sync status for a platform
   */
  @Get(':platformType/status')
  async getSyncStatus(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
  ) {
    const tenantId = req.user.tenantId;

    const [settings, productMappings, recentLogs] = await Promise.all([
      this.prisma.integrationSettings.findFirst({
        where: {
          tenantId,
          integrationType: IntegrationType.DELIVERY_APP,
          provider: platformType,
        },
      }),
      this.prisma.platformProductMapping.count({
        where: { tenantId, platformType, isEnabled: true },
      }),
      this.prisma.integrationSyncLog.findMany({
        where: { tenantId, platformType },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
    ]);

    const lastSync = recentLogs[0];

    return {
      platformType,
      isEnabled: settings?.isEnabled ?? false,
      isConfigured: settings?.isConfigured ?? false,
      lastSyncedAt: settings?.lastSyncedAt,
      lastSyncStatus: lastSync?.status ?? null,
      lastSyncError: lastSync?.errorMessage ?? null,
      syncedProducts: productMappings,
      syncedModifiers: 0, // TODO: Add modifier mapping count
      pendingSync: 0, // TODO: Calculate pending changes
    };
  }

  /**
   * Trigger full menu sync
   */
  @Post(':platformType/menu')
  async syncMenu(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Body() dto: TriggerMenuSyncDto,
  ) {
    const tenantId = req.user.tenantId;

    // Get provider
    const provider = await this.providerFactory.getProviderForTenant(
      platformType,
      tenantId,
    );

    // Get mapped products
    const mappings = await this.prisma.platformProductMapping.findMany({
      where: {
        tenantId,
        platformType,
        isEnabled: true,
        ...(dto.productIds && { productId: { in: dto.productIds } }),
      },
      include: {
        product: {
          include: {
            category: true,
            modifierGroups: {
              include: {
                group: {
                  include: {
                    modifiers: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Transform to sync format
    const products: ProductSyncData[] = mappings.map((m) => ({
      productId: m.productId,
      platformProductId: m.platformProductId,
      name: m.product.name,
      description: m.product.description ?? undefined,
      price: Number(m.product.price) * Number(m.priceMultiplier),
      categoryId: m.platformCategoryId ?? undefined,
      isAvailable: m.product.isAvailable,
      modifierGroups: m.product.modifierGroups.map((pmg) => ({
        groupId: pmg.group.id,
        name: pmg.group.displayName,
        selectionType: pmg.group.selectionType as 'SINGLE' | 'MULTIPLE',
        minSelections: pmg.group.minSelections,
        maxSelections: pmg.group.maxSelections ?? undefined,
        isRequired: pmg.group.isRequired,
        modifiers: pmg.group.modifiers.map((mod) => ({
          modifierId: mod.id,
          name: mod.displayName,
          price: Number(mod.priceAdjustment),
          isAvailable: mod.isAvailable,
        })),
      })),
    }));

    // Get categories
    const categories = await this.prisma.category.findMany({
      where: { tenantId, isActive: true },
    });

    const categoryData: CategorySyncData[] = categories.map((c) => ({
      categoryId: c.id,
      name: c.name,
      displayOrder: c.displayOrder,
      isActive: c.isActive,
    }));

    // Sync to platform
    const result = await provider.syncMenu(products, categoryData);

    // Update sync timestamp
    await this.prisma.integrationSettings.updateMany({
      where: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: platformType,
      },
      data: { lastSyncedAt: new Date() },
    });

    return result;
  }

  /**
   * Sync product availability
   */
  @Post(':platformType/availability')
  async syncAvailability(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Body() dto: TriggerAvailabilitySyncDto,
  ) {
    const tenantId = req.user.tenantId;

    const provider = await this.providerFactory.getProviderForTenant(
      platformType,
      tenantId,
    );

    // Get mapped products
    const where: any = {
      tenantId,
      platformType,
      isEnabled: true,
      syncAvailability: true,
    };

    if (dto.productIds?.length) {
      where.productId = { in: dto.productIds };
    }

    const mappings = await this.prisma.platformProductMapping.findMany({
      where,
      include: { product: true },
    });

    const results = await Promise.all(
      mappings.map(async (m) => {
        try {
          await provider.syncProductAvailability(
            m.platformProductId,
            m.product.isAvailable,
          );
          return { productId: m.productId, success: true };
        } catch (error: any) {
          return { productId: m.productId, success: false, error: error.message };
        }
      }),
    );

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    return {
      synced: successful.length,
      failed: failed.length,
      errors: failed,
    };
  }

  /**
   * Sync product prices
   */
  @Post(':platformType/prices')
  async syncPrices(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Body() dto: TriggerPriceSyncDto,
  ) {
    const tenantId = req.user.tenantId;

    const provider = await this.providerFactory.getProviderForTenant(
      platformType,
      tenantId,
    );

    const where: any = {
      tenantId,
      platformType,
      isEnabled: true,
      syncPrice: true,
    };

    if (dto.productIds?.length) {
      where.productId = { in: dto.productIds };
    }

    const mappings = await this.prisma.platformProductMapping.findMany({
      where,
      include: { product: true },
    });

    const results = await Promise.all(
      mappings.map(async (m) => {
        try {
          const platformPrice =
            Number(m.product.price) * Number(m.priceMultiplier);
          await provider.syncProductPrice(m.platformProductId, platformPrice);
          return { productId: m.productId, success: true };
        } catch (error: any) {
          return { productId: m.productId, success: false, error: error.message };
        }
      }),
    );

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    return {
      synced: successful.length,
      failed: failed.length,
      errors: failed,
    };
  }

  /**
   * Set restaurant status (open/close)
   */
  @Post(':platformType/restaurant-status')
  async setRestaurantStatus(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Body() dto: SetRestaurantStatusDto,
  ) {
    const tenantId = req.user.tenantId;

    const provider = await this.providerFactory.getProviderForTenant(
      platformType,
      tenantId,
    );

    if (dto.isOpen) {
      await provider.setRestaurantOpen();
    } else {
      await provider.setRestaurantClosed(dto.closedReason);
    }

    return { success: true, isOpen: dto.isOpen };
  }

  /**
   * Get restaurant status
   */
  @Get(':platformType/restaurant-status')
  async getRestaurantStatus(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
  ) {
    const tenantId = req.user.tenantId;

    const provider = await this.providerFactory.getProviderForTenant(
      platformType,
      tenantId,
    );

    return provider.getRestaurantStatus();
  }
}
