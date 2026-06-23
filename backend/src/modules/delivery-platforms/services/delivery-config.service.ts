import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreatePlatformConfigDto } from "../dto/create-platform-config.dto";
import { UpdatePlatformConfigDto } from "../dto/update-platform-config.dto";
import { AdapterFactory } from "../adapters/adapter-factory";
import {
  decryptJson,
  decryptString,
  encryptJson,
  encryptString,
  isEncryptedPayload,
} from "../../../common/helpers/encryption.helper";
import { OutboxService } from "../../outbox/outbox.service";
import { captureSwallowedEmit } from "../../../common/observability/capture-swallowed-emit";

// Error count at which we auto-disable a config so we stop spamming
// the platform / log table. The admin has to re-enable explicitly.
const CIRCUIT_BREAKER_THRESHOLD = 10;

/**
 * Versioned domain-event emitted when the circuit breaker auto-disables a
 * delivery-platform config. NOTE: this string is intentionally kept local —
 * adding it to the central EventTypes registry is owned by the outbox module;
 * until then OutboxService.append only logs a (harmless) unregistered-type
 * warning for it. The event rides the SAME durable outbox/in-process bus every
 * other tenant signal uses, so a notification consumer can subscribe without
 * coupling to this module.
 */
export const DELIVERY_AUTO_DISABLED_EVENT =
  "delivery.platform.auto_disabled.v1";

type StoredCredentials = Record<string, unknown>;

@Injectable()
export class DeliveryConfigService {
  private readonly logger = new Logger(DeliveryConfigService.name);

  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    // OutboxModule is @Global; @Optional() so the many unit tests that build
    // this service bare keep working and a missing bus can never break the
    // circuit-breaker write path — the alert is best-effort.
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  /**
   * Convert an on-disk config row into the shape adapters expect —
   * decrypts credentials + accessToken in memory. NEVER serialize this
   * to the client.
   */
  private decryptConfig<
    T extends { credentials?: unknown; accessToken?: string | null },
  >(config: T): T & { credentials?: StoredCredentials | null } {
    const result: any = { ...config };
    if (isEncryptedPayload(config.credentials)) {
      result.credentials = decryptJson<StoredCredentials>(config.credentials);
    }
    if (typeof config.accessToken === "string" && config.accessToken) {
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
      orderBy: { platform: "asc" },
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
          environment: dto.environment ?? "production",
          // Scalar FK (this create uses the unchecked-input shape with a scalar
          // tenantId, so branchId must be scalar too). null/undefined leaves it
          // unset so the "first active branch" fallback applies.
          branchId: dto.branchId ?? undefined,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
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

  async update(
    tenantId: string,
    platform: string,
    dto: UpdatePlatformConfigDto,
  ) {
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
    if (dto.environment !== undefined) data.environment = dto.environment;
    // branchId is a nullable relation FK (onDelete: SetNull) — assigning null
    // clears the override and restores the "first active branch" fallback.
    if (dto.branchId !== undefined) {
      data.branch =
        dto.branchId === null
          ? { disconnect: true }
          : { connect: { id: dto.branchId } };
    }

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
      // Defence-in-depth: tenantId in the WHERE so a regression of the
      // pre-check above can't expose cross-tenant writes (B41-B45).
      const claim = await this.prisma.deliveryPlatformConfig.updateMany({
        where: { id: config.id, tenantId, deletedAt: null },
        data,
      });
      if (claim.count === 0) {
        throw new NotFoundException(`Configuration for ${platform} not found`);
      }
      return this.prisma.deliveryPlatformConfig.findUniqueOrThrow({
        where: { id: config.id },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
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

    // Defence-in-depth: tenantId in the WHERE (B41-B45).
    const claim = await this.prisma.deliveryPlatformConfig.updateMany({
      where: { id: config.id, tenantId, deletedAt: null },
      data: { restaurantOpen: open },
    });
    if (claim.count === 0) {
      throw new NotFoundException(`Configuration for ${platform} not found`);
    }
    return this.prisma.deliveryPlatformConfig.findUniqueOrThrow({
      where: { id: config.id },
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
      // Loud log: before this, the breaker tripped and orders SILENTLY
      // stopped — the operator had no signal until they noticed missing
      // orders. WARN here + the durable alert below close that gap.
      this.logger.warn(
        `Auto-disabling ${updated.platform} config ${configId} (tenant=${updated.tenantId}) after ${updated.errorCount} errors; last error: ${updated.lastError ?? "n/a"}`,
      );
      await this.prisma.deliveryPlatformConfig.update({
        where: { id: configId },
        data: { isEnabled: false },
      });
      // Best-effort tenant alert on the shared outbox/in-process bus. A
      // notification consumer surfaces this to the operator so they know to
      // fix credentials / re-enable. Idempotency key = config id + the
      // current error count so a retried recordError that re-enters this
      // branch can't double-notify (it can't today — isEnabled is already
      // false — but the key is cheap insurance).
      await this.outbox
        ?.append({
          type: DELIVERY_AUTO_DISABLED_EVENT,
          tenantId: updated.tenantId,
          payload: {
            tenantId: updated.tenantId,
            configId: updated.id,
            platform: updated.platform,
            branchId: updated.branchId,
            errorCount: updated.errorCount,
            lastError: updated.lastError,
            lastErrorAt: updated.lastErrorAt?.toISOString() ?? null,
          },
          idempotencyKey: `delivery-auto-disabled:${updated.id}:${updated.errorCount}`,
        })
        .catch(
          captureSwallowedEmit(this.logger, {
            module: "delivery-platforms",
            op: "auto-disable",
          }),
        );
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
    // Defence-in-depth: tenantId in the WHERE (B41-B45).
    const claim = await this.prisma.deliveryPlatformConfig.updateMany({
      where: { id: config.id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), isEnabled: false },
    });
    if (claim.count === 0) {
      throw new NotFoundException(`Configuration for ${platform} not found`);
    }
    return this.prisma.deliveryPlatformConfig.findUniqueOrThrow({
      where: { id: config.id },
    });
  }
}
