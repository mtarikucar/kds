import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';
import {
  decryptJson,
  encryptJson,
  isEncryptedPayload,
} from '../../../common/helpers/encryption.helper';

// Integration types whose `config` JSON carries sensitive credentials
// (API keys, webhook secrets, OAuth tokens). Every one of these uses the
// envelope-encrypted wire format on disk; decryption happens only at the
// adapter boundary. Hardware integrations (printers / cash drawers) store
// serial-port / device-config data which is not sensitive and keeps the
// plain JSON shape for the desktop-app consumer.
const SENSITIVE_INTEGRATION_TYPES = new Set([
  'PAYMENT_GATEWAY',
  'THIRD_PARTY_API',
  'DELIVERY_APP',
  'ACCOUNTING',
  'CRM',
]);

// Fields the tenant-facing list/find endpoints MUST NOT surface in plaintext
// even for ADMIN role. A MANAGER-scoped UI would otherwise see provider
// credentials on screen. When redacted, a marker string replaces the value.
const SENSITIVE_KEY_PATTERNS = [
  /api.?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /client.?secret/i,
  /private.?key/i,
];
const REDACTED = '***REDACTED***';

function redactSensitiveKeys(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveKeys);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((re) => re.test(k));
    if (isSensitive && typeof v === 'string' && v.length > 0) {
      result[k] = REDACTED;
    } else if (v && typeof v === 'object') {
      result[k] = redactSensitiveKeys(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private prisma: PrismaService) {}

  private isSensitive(integrationType: string): boolean {
    return SENSITIVE_INTEGRATION_TYPES.has(integrationType);
  }

  /**
   * Transparent decrypt — callers get the plaintext config. Used by
   * adapter-side code (StripeAdapter, IyzicoAdapter, etc.) that needs
   * real credentials. NEVER returned to HTTP responses without first
   * routing through `toPublicView`.
   */
  private decryptConfig(row: any): any {
    if (!row) return row;
    if (!this.isSensitive(row.integrationType)) return row;
    const config = row.config;
    if (isEncryptedPayload(config)) {
      try {
        row.config = decryptJson(config);
      } catch (err: any) {
        this.logger.error(
          `Failed to decrypt integration ${row.id}: ${err.message}`,
        );
        row.config = {};
      }
    }
    return row;
  }

  /**
   * Redacted shape for HTTP responses. For sensitive integration types the
   * config is returned with api-key/secret/token fields replaced by
   * `***REDACTED***`. Non-sensitive hardware rows are returned verbatim.
   */
  private toPublicView(row: any): any {
    if (!row) return row;
    const decrypted = this.decryptConfig({ ...row });
    if (this.isSensitive(row.integrationType)) {
      decrypted.config = redactSensitiveKeys(decrypted.config);
    }
    return decrypted;
  }

  async findAll(tenantId: string) {
    const rows = await this.prisma.integrationSettings.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toPublicView(r));
  }

  async findByType(tenantId: string, integrationType: string) {
    const rows = await this.prisma.integrationSettings.findMany({
      where: { tenantId, integrationType },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toPublicView(r));
  }

  async findOne(id: string, tenantId: string) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id, tenantId },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    return this.toPublicView(integration);
  }

  /**
   * Internal API for adapter-side code that needs decrypted credentials.
   * Never call from controllers.
   */
  async findOneWithSecrets(id: string, tenantId: string) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id, tenantId },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    return this.decryptConfig(integration);
  }

  async create(tenantId: string, createDto: CreateIntegrationDto) {
    const existing = await this.prisma.integrationSettings.findUnique({
      where: {
        tenantId_integrationType_provider: {
          tenantId,
          integrationType: createDto.integrationType,
          provider: createDto.provider,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'Integration with this type and provider already exists',
      );
    }

    const configToStore = this.isSensitive(createDto.integrationType)
      ? (encryptJson(createDto.config) as any)
      : (createDto.config as any);

    const created = await this.prisma.integrationSettings.create({
      data: {
        tenantId,
        integrationType: createDto.integrationType,
        provider: createDto.provider,
        name: createDto.name,
        config: configToStore,
        isEnabled: createDto.isEnabled ?? false,
        isConfigured: true,
        notes: createDto.notes,
      },
    });
    return this.toPublicView(created);
  }

  async update(id: string, tenantId: string, updateDto: UpdateIntegrationDto) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id, tenantId },
    });
    if (!integration) throw new NotFoundException('Integration not found');

    const data: any = { ...updateDto };
    if (updateDto.config !== undefined) {
      data.config = this.isSensitive(integration.integrationType)
        ? (encryptJson(updateDto.config) as any)
        : (updateDto.config as any);
    }

    const updated = await this.prisma.integrationSettings.update({
      where: { id: integration.id },
      data,
    });
    return this.toPublicView(updated);
  }

  async delete(id: string, tenantId: string) {
    const result = await this.prisma.integrationSettings.deleteMany({
      where: { id, tenantId },
    });
    if (result.count !== 1) throw new NotFoundException('Integration not found');
    return { id, deleted: true };
  }

  async toggleStatus(id: string, tenantId: string, isEnabled: boolean) {
    const result = await this.prisma.integrationSettings.updateMany({
      where: { id, tenantId },
      data: { isEnabled },
    });
    if (result.count !== 1) throw new NotFoundException('Integration not found');
    const row = await this.prisma.integrationSettings.findFirst({
      where: { id, tenantId },
    });
    return this.toPublicView(row);
  }

  async updateLastSync(id: string, tenantId: string) {
    const result = await this.prisma.integrationSettings.updateMany({
      where: { id, tenantId },
      data: { lastSyncedAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException('Integration not found');
  }

  async getHardwareConfig(tenantId: string) {
    const hardwareTypes = [
      'THERMAL_PRINTER',
      'CASH_DRAWER',
      'RESTAURANT_PAGER',
      'BARCODE_READER',
      'CUSTOMER_DISPLAY',
      'KITCHEN_DISPLAY',
      'SCALE_DEVICE',
    ];
    const integrations = await this.prisma.integrationSettings.findMany({
      where: {
        tenantId,
        integrationType: { in: hardwareTypes },
        isEnabled: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      devices: integrations.map((integration) => ({
        id: integration.id,
        name: integration.provider,
        device_type: integration.integrationType,
        enabled: integration.isEnabled,
        auto_connect: (integration.config as any)?.auto_connect ?? true,
        connection: {
          connection_type: (integration.config as any)?.connection_type || 'Serial',
          config: (integration.config as any)?.connection_config || {},
        },
        settings: (integration.config as any)?.device_settings || {},
      })),
    };
  }

  async updateDeviceStatus(
    deviceId: string,
    tenantId: string,
    statusData: Record<string, unknown>,
  ) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id: deviceId, tenantId },
    });
    if (!integration) throw new NotFoundException('Integration not found');

    if (this.isSensitive(integration.integrationType)) {
      // Refuse to merge arbitrary client data into an encrypted credentials
      // blob — previously any WAITER could write keys into a stripe config.
      throw new BadRequestException(
        'updateDeviceStatus is only available for hardware integrations',
      );
    }

    const currentConfig = (integration.config as any) || {};
    const updatedConfig = {
      ...currentConfig,
      device_status: {
        ...statusData,
        last_updated: new Date(),
      },
    };

    await this.prisma.integrationSettings.update({
      where: { id: integration.id },
      data: {
        config: updatedConfig as any,
        lastSyncedAt: new Date(),
      },
    });
    return { success: true };
  }

  async reportDeviceEvent(
    deviceId: string,
    tenantId: string,
    eventData: Record<string, unknown>,
  ) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id: deviceId, tenantId },
    });
    if (!integration) throw new NotFoundException('Integration not found');

    // Log at debug, redacted. Previously console.log dumped full event
    // payloads which often included PII (order detail, customer data).
    this.logger.debug(
      `Hardware event for ${integration.provider}: ${Object.keys(eventData).length} fields`,
    );

    await this.prisma.integrationSettings.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date() },
    });
    return { success: true };
  }
}
