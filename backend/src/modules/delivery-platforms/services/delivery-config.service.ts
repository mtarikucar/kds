import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePlatformConfigDto } from '../dto/create-platform-config.dto';
import { UpdatePlatformConfigDto } from '../dto/update-platform-config.dto';
import { AdapterFactory } from '../adapters/adapter-factory';

@Injectable()
export class DeliveryConfigService {
  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.deliveryPlatformConfig.findMany({
      where: { tenantId },
      orderBy: { platform: 'asc' },
    });
  }

  async findOne(tenantId: string, platform: string) {
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform } },
    });
    if (!config) {
      throw new NotFoundException(
        `Configuration for ${platform} not found`,
      );
    }
    return config;
  }

  async findEnabledByPlatform(platform: string) {
    return this.prisma.deliveryPlatformConfig.findMany({
      where: { platform, isEnabled: true },
    });
  }

  async findByRemoteRestaurantId(platform: string, remoteId: string) {
    return this.prisma.deliveryPlatformConfig.findFirst({
      where: { platform, remoteRestaurantId: remoteId, isEnabled: true },
    });
  }

  async create(tenantId: string, dto: CreatePlatformConfigDto) {
    const existing = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform: dto.platform } },
    });

    if (existing) {
      throw new ConflictException(
        `Configuration for ${dto.platform} already exists. Use update instead.`,
      );
    }

    return this.prisma.deliveryPlatformConfig.create({
      data: {
        tenantId,
        platform: dto.platform,
        credentials: dto.credentials || undefined,
        remoteRestaurantId: dto.remoteRestaurantId,
        autoAccept: dto.autoAccept ?? true,
      },
    });
  }

  async update(tenantId: string, platform: string, dto: UpdatePlatformConfigDto) {
    const config = await this.findOne(tenantId, platform);

    const data: any = {};
    if (dto.isEnabled !== undefined) data.isEnabled = dto.isEnabled;
    if (dto.credentials !== undefined) data.credentials = dto.credentials;
    if (dto.remoteRestaurantId !== undefined) data.remoteRestaurantId = dto.remoteRestaurantId;
    if (dto.autoAccept !== undefined) data.autoAccept = dto.autoAccept;
    if (dto.notifySound !== undefined) data.notifySound = dto.notifySound;

    return this.prisma.deliveryPlatformConfig.update({
      where: { id: config.id },
      data,
    });
  }

  async testConnection(tenantId: string, platform: string) {
    const config = await this.findOne(tenantId, platform);
    const adapter = this.adapterFactory.getAdapter(platform);
    return adapter.testConnection(config);
  }

  async toggleRestaurant(tenantId: string, platform: string, open: boolean) {
    const config = await this.findOne(tenantId, platform);
    const adapter = this.adapterFactory.getAdapter(platform);

    if (open && adapter.openRestaurant) {
      await adapter.openRestaurant(config);
    } else if (!open && adapter.closeRestaurant) {
      await adapter.closeRestaurant(config);
    }

    return this.prisma.deliveryPlatformConfig.update({
      where: { id: config.id },
      data: { restaurantOpen: open },
    });
  }

  async updateToken(
    configId: string,
    token: string,
    expiresAt: Date,
  ) {
    return this.prisma.deliveryPlatformConfig.update({
      where: { id: configId },
      data: {
        accessToken: token,
        tokenExpiresAt: expiresAt,
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
      },
    });
  }

  async recordError(configId: string, error: string) {
    return this.prisma.deliveryPlatformConfig.update({
      where: { id: configId },
      data: {
        lastError: error,
        lastErrorAt: new Date(),
        errorCount: { increment: 1 },
      },
    });
  }

  async resetErrorCount(configId: string) {
    return this.prisma.deliveryPlatformConfig.update({
      where: { id: configId },
      data: { errorCount: 0, lastError: null, lastErrorAt: null },
    });
  }

  async updateLastPollTime(configId: string) {
    return this.prisma.deliveryPlatformConfig.update({
      where: { id: configId },
      data: { lastOrderPollAt: new Date() },
    });
  }

  async delete(tenantId: string, platform: string) {
    const config = await this.findOne(tenantId, platform);
    return this.prisma.deliveryPlatformConfig.delete({
      where: { id: config.id },
    });
  }
}
