import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { AdapterFactory } from "../adapters/adapter-factory";
import { DeliveryLogService } from "./delivery-log.service";
import { DeliveryAuthService } from "./delivery-auth.service";
import { DeliveryConfigService } from "./delivery-config.service";
import {
  PlatformLogDirection,
  PlatformLogAction,
} from "../constants/platform.enum";

@Injectable()
export class DeliveryMenuSyncService {
  private readonly logger = new Logger(DeliveryMenuSyncService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private logService: DeliveryLogService,
    private authService: DeliveryAuthService,
    private configService: DeliveryConfigService,
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

      // Increment the config-level error counter so the circuit breaker
      // (CIRCUIT_BREAKER_THRESHOLD=10 in delivery-config.service) can
      // auto-disable a config whose menu sync fails repeatedly. Without
      // this, a misconfigured platform that successfully issues auth
      // tokens but rejects every syncMenu call would loop forever — the
      // log table fills up but the config never auto-disables because
      // only the auth-refresh path was wired to recordError.
      await this.configService
        .recordError(config.id, `menu_sync: ${error.message}`)
        .catch((e) => this.logger.warn(`recordError failed: ${e.message}`));
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

      await adapter.updateItemAvailability(
        freshConfig,
        externalItemId,
        available,
      );

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

      // Same circuit-breaker bump as syncMenuToPlatform above.
      await this.configService
        .recordError(config.id, `item_availability: ${error.message}`)
        .catch((e) => this.logger.warn(`recordError failed: ${e.message}`));
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
      orderBy: { createdAt: "desc" },
    });
  }

  async createMapping(
    tenantId: string,
    productId: string,
    platform: string,
    externalItemId: string,
    externalData?: any,
  ) {
    // Tenant-scoped product check: without this, an admin in tenantA
    // could supply a tenantB productId and silently create a
    // cross-tenant mapping (FKs allow it since products are one global
    // table).
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException("Product not found in this tenant");
    }

    try {
      return await this.prisma.menuItemMapping.create({
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
    } catch (err) {
      // The schema has a unique on (tenantId, platform, externalItemId) so a
      // concurrent admin double-click previously surfaced as a raw P2002
      // → 500. Translate to a friendly ConflictException with guidance.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException(
          `Mapping for externalItemId="${externalItemId}" on ${platform} already exists`,
        );
      }
      throw err;
    }
  }

  async deleteMapping(tenantId: string, mappingId: string) {
    // The earlier deleteMany returned { count: 0 } silently when the id
    // didn't exist (or belonged to another tenant) — admin saw a 200
    // for a no-op. Surface a clean 404 so the UI can refresh the row.
    const result = await this.prisma.menuItemMapping.deleteMany({
      where: { id: mappingId, tenantId },
    });
    if (result.count === 0) {
      throw new NotFoundException("Menu item mapping not found");
    }
    return result;
  }
}
