import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePlatformConfigDto } from '../dto/create-platform-config.dto';
import { UpdatePlatformConfigDto } from '../dto/update-platform-config.dto';
import { AdapterFactory } from '../adapters/adapter-factory';
import {
  decryptJson,
  decryptString,
  encryptJson,
  encryptString,
  isEncryptedPayload,
} from '../../../common/helpers/encryption.helper';

// Error count at which we auto-disable a config so we stop spamming
// the platform / log table. The admin has to re-enable explicitly.
const CIRCUIT_BREAKER_THRESHOLD = 10;

type StoredCredentials = Record<string, unknown>;

@Injectable()
export class DeliveryConfigService {
  private readonly logger = new Logger(DeliveryConfigService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
  ) {}

  /**
   * Convert an on-disk config row into the shape adapters expect —
   * decrypts credentials + accessToken in memory. NEVER serialize this
   * to the client.
   */
  private decryptConfig<T extends { credentials?: unknown; accessToken?: string | null }>(
    config: T,
  ): T & { credentials?: StoredCredentials | null } {
    const result: any = { ...config };
    if (isEncryptedPayload(config.credentials)) {
      result.credentials = decryptJson<StoredCredentials>(config.credentials);
    }
    if (typeof config.accessToken === 'string' && config.accessToken) {
      result.accessToken = decryptString(config.accessToken);
    }
    return result;
  }

  private stripSensitiveFields(config: any) {
    const { credentials, accessToken, ...safe } = config;
    return {
      ...safe,
      hasCredentials: !!credentials,
      hasAccessToken: !!accessToken,
    };
  }

  async findAll(tenantId: string) {
    const configs = await this.prisma.deliveryPlatformConfig.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { platform: 'asc' },
    });
    return configs.map((c) => this.stripSensitiveFields(c));
  }

  async findOne(tenantId: string, platform: string) {
    const config = await this.prisma.deliveryPlatformConfig.findFirst({
      where: { tenantId, platform, deletedAt: null },
    });
    if (!config) {
      throw new NotFoundException(`Configuration for ${platform} not found`);
    }
    return this.stripSensitiveFields(config);
  }

  async findOneInternal(tenantId: string, platform: string) {
    const config = await this.prisma.deliveryPlatformConfig.findFirst({
      where: { tenantId, platform, deletedAt: null },
    });
    if (!config) {
      throw new NotFoundException(`Configuration for ${platform} not found`);
    }
    return this.decryptConfig(config);
  }

  async findEnabledByPlatform(platform: string) {
    const configs = await this.prisma.deliveryPlatformConfig.findMany({
      where: { platform, isEnabled: true, deletedAt: null },
    });
    return configs.map((c) => this.decryptConfig(c));
  }

  async findByRemoteRestaurantId(platform: string, remoteId: string) {
    const config = await this.prisma.deliveryPlatformConfig.findFirst({
      where: {
        platform,
        remoteRestaurantId: remoteId,
        isEnabled: true,
        deletedAt: null,
      },
    });
    return config ? this.decryptConfig(config) : null;
  }

  async create(tenantId: string, dto: CreatePlatformConfigDto) {
    const existing = await this.prisma.deliveryPlatformConfig.findFirst({
      where: { tenantId, platform: dto.platform, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(
        `Configuration for ${dto.platform} already exists. Use update instead.`,
      );
    }

    try {
      return await this.prisma.deliveryPlatformConfig.create({
        data: {
          tenantId,
          platform: dto.platform,
          credentials: dto.credentials
            ? (encryptJson(dto.credentials) as any)
            : undefined,
          remoteRestaurantId: dto.remoteRestaurantId,
          autoAccept: dto.autoAccept ?? false,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // DB-level @@unique([platform, remoteRestaurantId]) — replaces
        // the prior cross-tenant leak where disabled configs could
        // collide with enabled ones.
        throw new ConflictException(
          `Remote restaurant ID is already registered for ${dto.platform}`,
        );
      }
      throw err;
    }
  }

  async update(tenantId: string, platform: string, dto: UpdatePlatformConfigDto) {
    const config = await this.prisma.deliveryPlatformConfig.findFirst({
      where: { tenantId, platform, deletedAt: null },
    });
    if (!config) {
      throw new NotFoundException(`Configuration for ${platform} not found`);
    }

    const data: Prisma.DeliveryPlatformConfigUpdateInput = {};
    if (dto.isEnabled !== undefined) data.isEnabled = dto.isEnabled;
    if (dto.remoteRestaurantId !== undefined) {
      data.remoteRestaurantId = dto.remoteRestaurantId;
    }
    if (dto.autoAccept !== undefined) data.autoAccept = dto.autoAccept;
    if (dto.notifySound !== undefined) data.notifySound = dto.notifySound;

    // Rotating credentials invalidates any cached access token — keep
    // them in sync or callers will use the stale token for up to the
    // 10-minute refresh window.
    if (dto.credentials !== undefined) {
      data.credentials = dto.credentials
        ? (encryptJson(dto.credentials) as any)
        : Prisma.JsonNull;
      data.accessToken = null;
      data.tokenExpiresAt = null;
      data.errorCount = 0;
      data.lastError = null;
      data.lastErrorAt = null;
    }

    try {
      return await this.prisma.deliveryPlatformConfig.update({
        where: { id: config.id },
        data,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Remote restaurant ID is already registered for ${platform}`,
        );
      }
      throw err;
    }
  }

  async testConnection(tenantId: string, platform: string) {
    const config = await this.findOneInternal(tenantId, platform);
    const adapter = this.adapterFactory.getAdapter(platform);
    return adapter.testConnection(config);
  }

  async toggleRestaurant(tenantId: string, platform: string, open: boolean) {
    const config = await this.findOneInternal(tenantId, platform);
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

  async updateToken(configId: string, token: string, expiresAt: Date) {
    return this.prisma.deliveryPlatformConfig.update({
      where: { id: configId },
      data: {
        accessToken: encryptString(token),
        tokenExpiresAt: expiresAt,
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
      },
    });
  }

  /**
   * Record an error. When the running count passes the circuit-breaker
   * threshold we also auto-disable the config so we stop spamming the
   * platform and the log table, and surface a warning for the admin.
   */
  async recordError(configId: string, error: string) {
    const updated = await this.prisma.deliveryPlatformConfig.update({
      where: { id: configId },
      data: {
        lastError: error.slice(0, 500),
        lastErrorAt: new Date(),
        errorCount: { increment: 1 },
      },
    });
    if (updated.errorCount >= CIRCUIT_BREAKER_THRESHOLD && updated.isEnabled) {
      this.logger.warn(
        `Auto-disabling ${updated.platform} config ${configId} after ${updated.errorCount} errors`,
      );
      await this.prisma.deliveryPlatformConfig.update({
        where: { id: configId },
        data: { isEnabled: false },
      });
    }
    return updated;
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

  /**
   * Soft delete — outbound syncs for pending orders keep working until
   * the scheduler next polls. A later hard-purge job can drop rows
   * older than N days.
   */
  async delete(tenantId: string, platform: string) {
    const config = await this.prisma.deliveryPlatformConfig.findFirst({
      where: { tenantId, platform, deletedAt: null },
    });
    if (!config) {
      throw new NotFoundException(`Configuration for ${platform} not found`);
    }
    return this.prisma.deliveryPlatformConfig.update({
      where: { id: config.id },
      data: { deletedAt: new Date(), isEnabled: false },
    });
  }
}
