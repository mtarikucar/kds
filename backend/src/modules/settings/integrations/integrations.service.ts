import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreateIntegrationDto } from "./dto/create-integration.dto";
import { UpdateIntegrationDto } from "./dto/update-integration.dto";
import {
  decryptJson,
  encryptJson,
  isEncryptedPayload,
} from "../../../common/helpers/encryption.helper";

// Integration types whose `config` JSON carries sensitive credentials
// (API keys, webhook secrets, OAuth tokens). Every one of these uses the
// envelope-encrypted wire format on disk; decryption happens only at the
// adapter boundary. Hardware integrations (printers / cash drawers) store
// serial-port / device-config data which is not sensitive and keeps the
// plain JSON shape for the desktop-app consumer.
const SENSITIVE_INTEGRATION_TYPES = new Set([
  "PAYMENT_GATEWAY",
  "THIRD_PARTY_API",
  "DELIVERY_APP",
  "ACCOUNTING",
  "CRM",
]);

// Integration types whose credentials are STORED but NOT yet consumed by any
// production adapter. Building real adapters for each provider is out of
// scope here, so — to avoid fooling an operator into thinking a saved
// integration is actively running — every row of these types is reported
// with activationState "CONFIGURED_NOT_ACTIVE" (even when isEnabled=true).
// The day a real adapter ships for a provider, drop it from this set (or
// switch to a per-provider allow-list of wired adapters).
const ACTIVATION_NOT_WIRED_TYPES = new Set([
  "PAYMENT_GATEWAY",
  "THIRD_PARTY_API",
  "DELIVERY_APP",
  "ACCOUNTING",
  "CRM",
]);

// Honest activation states surfaced on the public view so the UI never
// renders a stored-but-inert integration as "working".
export const IntegrationActivationState = {
  // Credentials saved + no live adapter consuming them yet.
  CONFIGURED_NOT_ACTIVE: "CONFIGURED_NOT_ACTIVE",
  // A real adapter consumes this integration AND the operator enabled it.
  ACTIVE: "ACTIVE",
  // A real adapter exists but the operator has it switched off.
  DISABLED: "DISABLED",
} as const;

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
const REDACTED = "***REDACTED***";

function redactSensitiveKeys(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveKeys);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((re) => re.test(k));
    if (isSensitive && typeof v === "string" && v.length > 0) {
      result[k] = REDACTED;
    } else if (v && typeof v === "object") {
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
   * Compute the HONEST activation state for an integration row. Credential
   * integration types have no live adapter yet, so they are reported as
   * "configured, not yet active" regardless of the isEnabled toggle — the
   * toggle records operator intent, but nothing in production actually
   * consumes the stored credentials. Hardware/other types (consumed by the
   * Tauri desktop app) reflect their real enabled/disabled state.
   */
  private activationState(row: {
    integrationType: string;
    isEnabled: boolean;
  }): string {
    if (ACTIVATION_NOT_WIRED_TYPES.has(row.integrationType)) {
      return IntegrationActivationState.CONFIGURED_NOT_ACTIVE;
    }
    return row.isEnabled
      ? IntegrationActivationState.ACTIVE
      : IntegrationActivationState.DISABLED;
  }

  /**
   * Transparent decrypt — callers get the plaintext config.
   *
   * HONESTY NOTE: there is currently NO production adapter that consumes
   * these stored credentials (the credential integration types below have
   * no live integration wired yet — see ACTIVATION_NOT_WIRED_TYPES). This
   * helper exists so a future adapter can read the envelope-encrypted
   * config at its boundary; until one is built, `findOneWithSecrets` has no
   * runtime callers and these integrations are surfaced as "configured, not
   * yet active" rather than presented as working. NEVER returned to HTTP
   * responses without first routing through `toPublicView`.
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
    // Surface the honest activation state so the UI doesn't present a
    // stored-but-inert integration as "active/working".
    decrypted.activationState = this.activationState(row);
    return decrypted;
  }

  async findAll(tenantId: string) {
    const rows = await this.prisma.integrationSettings.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toPublicView(r));
  }

  async findByType(tenantId: string, integrationType: string) {
    const rows = await this.prisma.integrationSettings.findMany({
      where: { tenantId, integrationType },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toPublicView(r));
  }

  async findOne(id: string, tenantId: string) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id, tenantId },
    });
    if (!integration) throw new NotFoundException("Integration not found");
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
    if (!integration) throw new NotFoundException("Integration not found");
    return this.decryptConfig(integration);
  }

  async create(tenantId: string, createDto: CreateIntegrationDto) {
    // v3.0.1 — findFirst instead of findUnique on the compound key.
    // Prisma 6 rejects the (tenantId, branchId, integrationType, provider)
    // findUnique when branchId is null at the client-validation layer,
    // regardless of the DB constraint's NULLS NOT DISTINCT. findFirst
    // hits the same compound index and accepts the null. Same fix as
    // every settings.service in the v3.0.1 sweep — see
    // common/scoping/branch-scope.ts loadBranchSettings note.
    const existing = await this.prisma.integrationSettings.findFirst({
      where: {
        tenantId,
        branchId: null,
        integrationType: createDto.integrationType,
        provider: createDto.provider,
      },
    });
    if (existing) {
      throw new ConflictException(
        "Integration with this type and provider already exists",
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
    if (!integration) throw new NotFoundException("Integration not found");

    const data: any = { ...updateDto };
    if (updateDto.config !== undefined) {
      data.config = this.isSensitive(integration.integrationType)
        ? (encryptJson(updateDto.config) as any)
        : (updateDto.config as any);
    }

    // Compound WHERE (B41-B45 pattern, iter-31 onward). The findFirst
    // above already proves ownership, but a future refactor that drops
    // it shouldn't leak into a cross-tenant write.
    const claim = await this.prisma.integrationSettings.updateMany({
      where: { id: integration.id, tenantId },
      data,
    });
    if (claim.count === 0) throw new NotFoundException("Integration not found");
    const updated = await this.prisma.integrationSettings.findFirstOrThrow({
      where: { id: integration.id, tenantId },
    });
    return this.toPublicView(updated);
  }

  async delete(id: string, tenantId: string) {
    const result = await this.prisma.integrationSettings.deleteMany({
      where: { id, tenantId },
    });
    if (result.count !== 1)
      throw new NotFoundException("Integration not found");
    return { id, deleted: true };
  }

  async toggleStatus(id: string, tenantId: string, isEnabled: boolean) {
    const result = await this.prisma.integrationSettings.updateMany({
      where: { id, tenantId },
      data: { isEnabled },
    });
    if (result.count !== 1)
      throw new NotFoundException("Integration not found");
    const row = await this.prisma.integrationSettings.findFirst({
      where: { id, tenantId },
    });
    return this.toPublicView(row);
  }

  /**
   * Honest "sync" handler. Previously this stamped lastSyncedAt=now() which
   * IMPLIED a real sync had run — but no production adapter consumes these
   * stored credentials, so nothing was ever synced. We now refuse to fake a
   * success timestamp: the row is left untouched and the caller is told that
   * no live sync is wired for this integration. (The storage is preserved so
   * a future real adapter can flip this on.)
   */
  async requestSync(id: string, tenantId: string) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id, tenantId },
      select: { id: true, integrationType: true, isEnabled: true },
    });
    if (!integration) throw new NotFoundException("Integration not found");

    // No live adapter is wired for any of these credential integration types
    // yet — so do NOT stamp lastSyncedAt (that would be a fake success). Tell
    // the caller plainly that the sync is not connected.
    if (ACTIVATION_NOT_WIRED_TYPES.has(integration.integrationType)) {
      return {
        synced: false,
        activationState: IntegrationActivationState.CONFIGURED_NOT_ACTIVE,
        message:
          "This integration is configured but not yet active — no live sync is connected for this provider. Credentials are stored securely for when the integration is wired.",
      };
    }

    // For types that DO have a real consumer (none today; future-proofing the
    // contract), an actual sync would run here before recording the time.
    return {
      synced: false,
      activationState: this.activationState(integration),
      message: "No live sync is available for this integration type.",
    };
  }

  async getHardwareConfig(tenantId: string) {
    const hardwareTypes = [
      "THERMAL_PRINTER",
      "CASH_DRAWER",
      "RESTAURANT_PAGER",
      "BARCODE_READER",
      "CUSTOMER_DISPLAY",
      "KITCHEN_DISPLAY",
      "SCALE_DEVICE",
    ];
    const integrations = await this.prisma.integrationSettings.findMany({
      where: {
        tenantId,
        integrationType: { in: hardwareTypes },
        isEnabled: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      devices: integrations.map((integration) => ({
        id: integration.id,
        name: integration.provider,
        device_type: integration.integrationType,
        enabled: integration.isEnabled,
        auto_connect: (integration.config as any)?.auto_connect ?? true,
        connection: {
          connection_type:
            (integration.config as any)?.connection_type || "Serial",
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
    if (!integration) throw new NotFoundException("Integration not found");

    if (this.isSensitive(integration.integrationType)) {
      // Refuse to merge arbitrary client data into an encrypted credentials
      // blob — previously any WAITER could write keys into a stripe config.
      throw new BadRequestException(
        "updateDeviceStatus is only available for hardware integrations",
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

    // Compound WHERE — same defence-in-depth pattern as update() above.
    const claim = await this.prisma.integrationSettings.updateMany({
      where: { id: integration.id, tenantId },
      data: {
        config: updatedConfig as any,
        lastSyncedAt: new Date(),
      },
    });
    if (claim.count === 0) throw new NotFoundException("Integration not found");
    return { success: true };
  }

  async reportDeviceEvent(
    deviceId: string,
    tenantId: string,
    eventData: { event: string; data?: Record<string, unknown> },
  ) {
    const integration = await this.prisma.integrationSettings.findFirst({
      where: { id: deviceId, tenantId },
    });
    if (!integration) throw new NotFoundException("Integration not found");

    // Log at debug, redacted. Previously console.log dumped full event
    // payloads which often included PII (order detail, customer data).
    const dataKeys = eventData.data ? Object.keys(eventData.data).length : 0;
    this.logger.debug(
      `Hardware event for ${integration.provider}: type=${eventData.event} (${dataKeys} data fields)`,
    );

    // Compound WHERE — same defence-in-depth pattern as update() above.
    const claim = await this.prisma.integrationSettings.updateMany({
      where: { id: integration.id, tenantId },
      data: { lastSyncedAt: new Date() },
    });
    if (claim.count === 0) throw new NotFoundException("Integration not found");
    return { success: true };
  }
}
