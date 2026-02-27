import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdapterFactory } from '../adapters/adapter-factory';
import { DeliveryLogService } from './delivery-log.service';
import { DeliveryAuthService } from './delivery-auth.service';
import { PlatformLogDirection, PlatformLogAction } from '../constants/platform.enum';

@Injectable()
export class DeliveryMenuSyncService {
  private readonly logger = new Logger(DeliveryMenuSyncService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private logService: DeliveryLogService,
    private authService: DeliveryAuthService,
  ) {}

  async syncMenuToPlatform(tenantId: string, platform: string) {
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform } },
    });

    if (!config?.isEnabled) return;

    const adapter = this.adapterFactory.getAdapter(platform);
    if (!adapter.syncMenu) {
      this.logger.warn(`${platform} does not support menu sync`);
      return;
    }

    try {
      const freshConfig = await this.authService.ensureValidToken(config.id);
      if (!freshConfig) return;

      // Get all mapped items for this platform
      const mappings = await this.prisma.menuItemMapping.findMany({
        where: { tenantId, platform },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              isAvailable: true,
            },
          },
        },
      });

      const items = mappings.map((m) => ({
        externalItemId: m.externalItemId,
        name: m.product.name,
        price: Number(m.product.price),
        isAvailable: m.product.isAvailable && m.isActive,
      }));

      await adapter.syncMenu(freshConfig, items);

      await this.prisma.deliveryPlatformConfig.update({
        where: { id: config.id },
        data: { lastMenuSyncAt: new Date() },
      });

      await this.logService.log({
        tenantId,
        platform,
        direction: PlatformLogDirection.OUTBOUND,
        action: PlatformLogAction.MENU_SYNC,
        success: true,
        request: { itemCount: items.length },
      });

      this.logger.log(
        `Menu synced to ${platform} for tenant ${tenantId}: ${items.length} items`,
      );
    } catch (error: any) {
      this.logger.error(
        `Menu sync failed for ${platform} (tenant ${tenantId}): ${error.message}`,
      );

      await this.logService.log({
        tenantId,
        platform,
        direction: PlatformLogDirection.OUTBOUND,
        action: PlatformLogAction.MENU_SYNC,
        success: false,
        error: error.message,
      });
    }
  }

  async updateItemAvailability(
    tenantId: string,
    platform: string,
    externalItemId: string,
    available: boolean,
  ) {
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform } },
    });

    if (!config?.isEnabled) return;

    const adapter = this.adapterFactory.getAdapter(platform);
    if (!adapter.updateItemAvailability) return;

    try {
      const freshConfig = await this.authService.ensureValidToken(config.id);
      if (!freshConfig) return;

      await adapter.updateItemAvailability(freshConfig, externalItemId, available);

      await this.logService.log({
        tenantId,
        platform,
        direction: PlatformLogDirection.OUTBOUND,
        action: PlatformLogAction.ITEM_AVAILABILITY,
        success: true,
        request: { externalItemId, available },
      });
    } catch (error: any) {
      this.logger.error(
        `Item availability update failed for ${platform}: ${error.message}`,
      );

      await this.logService.log({
        tenantId,
        platform,
        direction: PlatformLogDirection.OUTBOUND,
        action: PlatformLogAction.ITEM_AVAILABILITY,
        success: false,
        error: error.message,
        request: { externalItemId, available },
      });
    }
  }

  // Menu item mapping CRUD
  async getMappings(tenantId: string, platform?: string) {
    const where: any = { tenantId };
    if (platform) where.platform = platform;

    return this.prisma.menuItemMapping.findMany({
      where,
      include: {
        product: {
          select: { id: true, name: true, price: true, isAvailable: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createMapping(
    tenantId: string,
    productId: string,
    platform: string,
    externalItemId: string,
    externalData?: any,
  ) {
    return this.prisma.menuItemMapping.create({
      data: {
        tenantId,
        productId,
        platform,
        externalItemId,
        externalData: externalData || undefined,
        lastSyncedAt: new Date(),
      },
      include: {
        product: {
          select: { id: true, name: true, price: true, isAvailable: true },
        },
      },
    });
  }

  async deleteMapping(tenantId: string, mappingId: string) {
    return this.prisma.menuItemMapping.deleteMany({
      where: { id: mappingId, tenantId },
    });
  }
}
