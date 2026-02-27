import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdapterFactory } from '../adapters/adapter-factory';
import { DeliveryConfigService } from './delivery-config.service';
import { DeliveryLogService } from './delivery-log.service';
import { PlatformLogDirection, PlatformLogAction } from '../constants/platform.enum';

@Injectable()
export class DeliveryAuthService {
  private readonly logger = new Logger(DeliveryAuthService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private configService: DeliveryConfigService,
    private logService: DeliveryLogService,
  ) {}

  async refreshToken(configId: string) {
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { id: configId },
    });

    if (!config || !config.isEnabled) return;

    const adapter = this.adapterFactory.getAdapter(config.platform);

    try {
      const { token, expiresAt } = await adapter.authenticate(config);
      await this.configService.updateToken(config.id, token, expiresAt);

      await this.logService.log({
        tenantId: config.tenantId,
        platform: config.platform,
        direction: PlatformLogDirection.OUTBOUND,
        action: PlatformLogAction.AUTH_REFRESH,
        success: true,
      });

      this.logger.log(
        `Token refreshed for ${config.platform} (tenant: ${config.tenantId})`,
      );
    } catch (error: any) {
      await this.configService.recordError(config.id, error.message);

      await this.logService.log({
        tenantId: config.tenantId,
        platform: config.platform,
        direction: PlatformLogDirection.OUTBOUND,
        action: PlatformLogAction.AUTH_REFRESH,
        success: false,
        error: error.message,
      });

      this.logger.error(
        `Token refresh failed for ${config.platform} (tenant: ${config.tenantId}): ${error.message}`,
      );
    }
  }

  async refreshExpiringTokens() {
    // Find configs with tokens expiring in the next 10 minutes
    const expiringConfigs = await this.prisma.deliveryPlatformConfig.findMany({
      where: {
        isEnabled: true,
        tokenExpiresAt: {
          lte: new Date(Date.now() + 10 * 60 * 1000),
        },
      },
    });

    for (const config of expiringConfigs) {
      await this.refreshToken(config.id);
    }

    return expiringConfigs.length;
  }

  async ensureValidToken(configId: string) {
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { id: configId },
    });

    if (!config) return null;

    // If token is still valid (more than 2 minutes left), return it
    if (
      config.accessToken &&
      config.tokenExpiresAt &&
      config.tokenExpiresAt > new Date(Date.now() + 2 * 60 * 1000)
    ) {
      return config;
    }

    // Token expired or about to expire - refresh
    await this.refreshToken(configId);

    return this.prisma.deliveryPlatformConfig.findUnique({
      where: { id: configId },
    });
  }
}
