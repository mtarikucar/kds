import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { TenantStatus } from '../../common/constants/subscription.enum';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async create(createTenantDto: CreateTenantDto) {
    // Check if subdomain is already in use
    if (createTenantDto.subdomain) {
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { subdomain: createTenantDto.subdomain },
      });

      if (existingTenant) {
        throw new ConflictException('Subdomain already in use');
      }
    }

    return this.prisma.tenant.create({
      data: {
        name: createTenantDto.name,
        subdomain: createTenantDto.subdomain,
        status: createTenantDto.status || TenantStatus.ACTIVE,
      },
    });
  }

  async findAll() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            users: true,
            products: true,
            orders: true,
          },
        },
      },
    });
  }

  async findAllPublic() {
    return this.prisma.tenant.findMany({
      where: {
        status: TenantStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
        subdomain: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            categories: true,
            products: true,
            tables: true,
            orders: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }

    return tenant;
  }

  async update(id: string, updateTenantDto: UpdateTenantDto) {
    // Check if tenant exists
    await this.findOne(id);

    // Check if subdomain is already in use by another tenant
    if (updateTenantDto.subdomain) {
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { subdomain: updateTenantDto.subdomain },
      });

      if (existingTenant && existingTenant.id !== id) {
        throw new ConflictException('Subdomain already in use');
      }
    }

    return this.prisma.tenant.update({
      where: { id },
      data: updateTenantDto,
    });
  }

  async remove(id: string) {
    // Check if tenant exists
    await this.findOne(id);

    return this.prisma.tenant.delete({
      where: { id },
    });
  }

  private async validateSubdomainChangePermission(
    tenantId: string,
    currentSubdomain: string | null,
    newSubdomain: string | null | undefined,
  ): Promise<void> {
    // Allow if not changing
    if (newSubdomain === currentSubdomain) return;

    // Allow removal (setting to null)
    if (!newSubdomain) return;

    // Check plan feature
    const tenantWithPlan = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });

    const hasCustomBranding =
      tenantWithPlan?.currentPlan?.customBranding ?? false;

    if (!hasCustomBranding) {
      throw new ForbiddenException(
        'Custom subdomain is a Pro feature. Upgrade your plan to set or change your subdomain.',
      );
    }
  }

  async findSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        subdomain: true,
        currency: true,
        closingTime: true,
        timezone: true,
        reportEmailEnabled: true,
        reportEmails: true,
        // Location settings for QR menu security
        latitude: true,
        longitude: true,
        locationRadius: true,
        // WiFi settings
        wifiSsid: true,
        wifiPassword: true,
        // Social media links
        socialInstagram: true,
        socialFacebook: true,
        socialTwitter: true,
        socialTiktok: true,
        socialYoutube: true,
        socialWhatsapp: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    return tenant;
  }

  async updateSettings(tenantId: string, updateDto: UpdateTenantSettingsDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    // Check subdomain change permission (Pro feature with grandfather rule)
    if (updateDto.subdomain !== undefined) {
      await this.validateSubdomainChangePermission(
        tenantId,
        tenant.subdomain,
        updateDto.subdomain,
      );

      // Check uniqueness if subdomain is being set (not null/removed)
      if (updateDto.subdomain) {
        const existingTenant = await this.prisma.tenant.findUnique({
          where: { subdomain: updateDto.subdomain },
        });

        if (existingTenant && existingTenant.id !== tenantId) {
          throw new ConflictException('Subdomain already in use');
        }
      }
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: updateDto,
      select: {
        id: true,
        name: true,
        subdomain: true,
        currency: true,
        closingTime: true,
        timezone: true,
        reportEmailEnabled: true,
        reportEmails: true,
        // Location settings for QR menu security
        latitude: true,
        longitude: true,
        locationRadius: true,
        // WiFi settings
        wifiSsid: true,
        wifiPassword: true,
        // Social media links
        socialInstagram: true,
        socialFacebook: true,
        socialTwitter: true,
        socialTiktok: true,
        socialYoutube: true,
        socialWhatsapp: true,
      },
    });
  }
}
