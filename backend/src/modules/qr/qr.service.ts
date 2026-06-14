import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateQrSettingsDto } from "./dto/create-qr-settings.dto";
import { UpdateQrSettingsDto } from "./dto/update-qr-settings.dto";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import * as QRCode from "qrcode";

// Cap on per-request QR generation. Each PNG takes ~500ms of synchronous
// CPU; a tenant with 10k tables could DOS the Node process. Legitimate
// tenants never hit this; chains with >500 physical tables should request
// per-section in a future UI.
const MAX_TABLES_PER_REQUEST = 500;

// Valid-subdomain regex. Matches DNS labels (RFC 1035-ish): lowercase ASCII
// alphanumerics and hyphens, must start/end with alphanumeric, 3-63 chars.
// Rejects `/`, `?`, `@`, extra dots, uppercase, and control chars so a
// malicious subdomain like `evil.com#` cannot escape the host.
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

@Injectable()
export class QrService {
  constructor(private prisma: PrismaService) {}

  // v3.0.1 — findFirst pattern (see branch-scope.ts loadBranchSettings
  // note). Prisma's findUnique/upsert/delete on a compound-unique key
  // reject `branchId: null` at runtime even when the DB allows it.
  async getSettings(tenantId: string) {
    const existing = await this.prisma.qrMenuSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) return existing;
    try {
      return await this.prisma.qrMenuSettings.create({ data: { tenantId } });
    } catch (e: any) {
      if (e?.code === "P2002") {
        const row = await this.prisma.qrMenuSettings.findFirst({
          where: { tenantId, branchId: null },
        });
        if (row) return row;
      }
      throw e;
    }
  }

  async createSettings(tenantId: string, dto: CreateQrSettingsDto) {
    const existingSettings = await this.prisma.qrMenuSettings.findFirst({
      where: { tenantId, branchId: null },
    });

    if (existingSettings) {
      // Update if already exists
      return this.updateSettings(tenantId, dto);
    }

    return this.prisma.qrMenuSettings.create({
      data: {
        tenantId,
        ...dto,
      },
    });
  }

  async updateSettings(tenantId: string, dto: UpdateQrSettingsDto) {
    // Ensure settings exist
    await this.getSettings(tenantId);

    const updated = await this.prisma.qrMenuSettings.updateMany({
      where: { tenantId, branchId: null },
      data: dto,
    });
    if (updated.count === 0) {
      throw new NotFoundException("QR settings not found");
    }
    return this.prisma.qrMenuSettings.findFirstOrThrow({
      where: { tenantId, branchId: null },
    });
  }

  async deleteSettings(tenantId: string) {
    const settings = await this.prisma.qrMenuSettings.findFirst({
      where: { tenantId, branchId: null },
    });

    if (!settings) {
      throw new NotFoundException("QR settings not found");
    }

    const deleted = await this.prisma.qrMenuSettings.deleteMany({
      where: { tenantId, branchId: null },
    });
    return { count: deleted.count };
  }

  async getQrCodes(scope: BranchScope, baseUrl: string) {
    const tenantId = scope.tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("Tenant not found");

    // Validate subdomain before embedding it into the QR URL. Tenants module
    // should enforce this at write time, but do a defensive check here so a
    // historical bad-value row doesn't produce a QR that redirects off-host.
    const hasValidSubdomain =
      !!tenant.subdomain && SUBDOMAIN_REGEX.test(tenant.subdomain);

    // Branch-scoped: physical tables belong to one branch, so the table
    // QR sheet must only list THIS branch's tables. Pre-fix this filtered
    // by tenantId only, so a MANAGER printing QR codes for branch A got
    // every branch's tables (and per-table deep links into branches they
    // can't manage). QrMenuSettings stays tenant-wide (see getSettings).
    const tables = await this.prisma.table.findMany({
      where: { ...branchScope(scope) },
      orderBy: { number: "asc" },
      take: MAX_TABLES_PER_REQUEST + 1,
    });
    if (tables.length > MAX_TABLES_PER_REQUEST) {
      throw new BadRequestException(
        `QR generation capped at ${MAX_TABLES_PER_REQUEST} tables per request`,
      );
    }

    // Get settings
    const settings = await this.getSettings(tenantId);

    const qrCodes = [];

    // Generate subdomain-based URL if tenant has a validated subdomain,
    // otherwise fall back to the path-based URL.
    const generateMenuUrl = (tableId?: string): string => {
      if (hasValidSubdomain) {
        // Parse baseUrl to get domain parts
        try {
          const url = new URL(baseUrl);
          const hostParts = url.hostname.split(".");
          const isStaging = hostParts.includes("staging");

          // Build subdomain URL
          // For staging: {subdomain}.staging.hummytummy.com
          // For production: {subdomain}.hummytummy.com
          let subdomainHost: string;
          if (isStaging) {
            // staging.hummytummy.com -> {subdomain}.staging.hummytummy.com
            subdomainHost = `${tenant.subdomain}.${url.hostname}`;
          } else if (
            url.hostname === "localhost" ||
            url.hostname.includes("localhost")
          ) {
            // Local dev: use path-based URL
            return tableId
              ? `${baseUrl}/qr-menu/${tenantId}?tableId=${tableId}`
              : `${baseUrl}/qr-menu/${tenantId}`;
          } else {
            // Production: hummytummy.com -> {subdomain}.hummytummy.com
            subdomainHost = `${tenant.subdomain}.${url.hostname}`;
          }

          const subdomainUrl = `${url.protocol}//${subdomainHost}`;
          return tableId ? `${subdomainUrl}?tableId=${tableId}` : subdomainUrl;
        } catch {
          // Fallback to path-based URL if parsing fails
          return tableId
            ? `${baseUrl}/qr-menu/${tenantId}?tableId=${tableId}`
            : `${baseUrl}/qr-menu/${tenantId}`;
        }
      }

      // Fallback to path-based URL
      return tableId
        ? `${baseUrl}/qr-menu/${tenantId}?tableId=${tableId}`
        : `${baseUrl}/qr-menu/${tenantId}`;
    };

    // Tenant-wide QR code
    const tenantUrl = generateMenuUrl();
    const tenantQrDataUrl = await QRCode.toDataURL(tenantUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: settings.primaryColor || "#3B82F6",
        light: "#FFFFFF",
      },
    });

    qrCodes.push({
      id: `tenant-${tenantId}`,
      type: "TENANT",
      url: tenantUrl,
      qrDataUrl: tenantQrDataUrl,
      label: tenant.name,
    });

    // Table-specific QR codes (if enabled)
    if (settings.enableTableQR) {
      for (const table of tables) {
        const tableUrl = generateMenuUrl(table.id);
        const tableQrDataUrl = await QRCode.toDataURL(tableUrl, {
          width: 400,
          margin: 2,
          color: {
            dark: settings.primaryColor || "#3B82F6",
            light: "#FFFFFF",
          },
        });

        qrCodes.push({
          id: `table-${table.id}`,
          type: "TABLE",
          url: tableUrl,
          qrDataUrl: tableQrDataUrl,
          tableId: table.id,
          tableNumber: table.number,
          label: `Table ${table.number}`,
        });
      }
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
      },
      settings,
      qrCodes,
    };
  }

  async generateQrCode(url: string, options?: { color?: string }) {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: {
        dark: options?.color || "#3B82F6",
        light: "#FFFFFF",
      },
    });

    return {
      url,
      qrDataUrl,
    };
  }
}
