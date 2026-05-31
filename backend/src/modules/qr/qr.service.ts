import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQrSettingsDto } from './dto/create-qr-settings.dto';
import { UpdateQrSettingsDto } from './dto/update-qr-settings.dto';
import * as QRCode from 'qrcode';

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

  async getSettings(tenantId: string) {
    let settings = await this.prisma.qrMenuSettings.findUnique({
      where: { tenantId },
    });

    // Create default settings if they don't exist
    if (!settings) {
      settings = await this.prisma.qrMenuSettings.create({
        data: { tenantId },
      });
    }

    return settings;
  }

  async createSettings(tenantId: string, dto: CreateQrSettingsDto) {
    const existingSettings = await this.prisma.qrMenuSettings.findUnique({
      where: { tenantId },
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

    return this.prisma.qrMenuSettings.update({
      where: { tenantId },
      data: dto,
    });
  }

  async deleteSettings(tenantId: string) {
    const settings = await this.prisma.qrMenuSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      throw new NotFoundException('QR settings not found');
    }

    return this.prisma.qrMenuSettings.delete({
      where: { tenantId },
    });
  }

  async getQrCodes(tenantId: string, baseUrl: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    // Validate subdomain before embedding it into the QR URL. Tenants module
    // should enforce this at write time, but do a defensive check here so a
    // historical bad-value row doesn't produce a QR that redirects off-host.
    const hasValidSubdomain = !!tenant.subdomain && SUBDOMAIN_REGEX.test(tenant.subdomain);

    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      orderBy: { number: 'asc' },
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
          const hostParts = url.hostname.split('.');
          const isStaging = hostParts.includes('staging');

          // Build subdomain URL
          // For staging: {subdomain}.staging.hummytummy.com
          // For production: {subdomain}.hummytummy.com
          let subdomainHost: string;
          if (isStaging) {
            // staging.hummytummy.com -> {subdomain}.staging.hummytummy.com
            subdomainHost = `${tenant.subdomain}.${url.hostname}`;
          } else if (url.hostname === 'localhost' || url.hostname.includes('localhost')) {
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
        dark: settings.primaryColor || '#3B82F6',
        light: '#FFFFFF',
      },
    });

    qrCodes.push({
      id: `tenant-${tenantId}`,
      type: 'TENANT',
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
            dark: settings.primaryColor || '#3B82F6',
            light: '#FFFFFF',
          },
        });

        qrCodes.push({
          id: `table-${table.id}`,
          type: 'TABLE',
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
        dark: options?.color || '#3B82F6',
        light: '#FFFFFF',
      },
    });

    return {
      url,
      qrDataUrl,
    };
  }
}
