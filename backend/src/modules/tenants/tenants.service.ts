import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { TenantStatus } from '../../common/constants/subscription.enum';
import {
  isSubdomainQuarantined,
  reserveSubdomain,
} from '../../common/helpers/subdomain.helper';

const SETTINGS_SELECT = {
  id: true,
  name: true,
  subdomain: true,
  currency: true,
  closingTime: true,
  timezone: true,
  reportEmailEnabled: true,
  reportEmails: true,
  latitude: true,
  longitude: true,
  locationRadius: true,
  wifiSsid: true,
  wifiPassword: true,
  socialInstagram: true,
  socialFacebook: true,
  socialTwitter: true,
  socialTiktok: true,
  socialYoutube: true,
  socialWhatsapp: true,
} as const;

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

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

  private async validateSubdomainChangePermission(
    tenantId: string,
    currentSubdomain: string | null,
    newSubdomain: string | null | undefined,
  ): Promise<void> {
    if (newSubdomain === currentSubdomain) return;
    if (!newSubdomain) return;

    const tenantWithPlan = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });

    const hasCustomBranding = tenantWithPlan?.currentPlan?.customBranding ?? false;

    if (!hasCustomBranding) {
      throw new ForbiddenException(
        'Custom subdomain is a Pro feature. Upgrade your plan to set or change your subdomain.',
      );
    }
  }

  async findSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: SETTINGS_SELECT,
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

    // A suspended/deleted tenant must not be able to keep editing
    // customer-visible settings (subdomain, social links, etc.).
    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException('Tenant is not active');
    }

    if (updateDto.subdomain !== undefined) {
      await this.validateSubdomainChangePermission(
        tenantId,
        tenant.subdomain,
        updateDto.subdomain,
      );

      if (
        updateDto.subdomain &&
        updateDto.subdomain !== tenant.subdomain &&
        (await isSubdomainQuarantined(this.prisma, updateDto.subdomain))
      ) {
        throw new ConflictException('Subdomain already in use');
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // If a different subdomain is being set and one currently exists,
        // quarantine the outgoing subdomain to block takeover.
        if (
          updateDto.subdomain !== undefined &&
          tenant.subdomain &&
          updateDto.subdomain !== tenant.subdomain
        ) {
          await reserveSubdomain(tx, tenant.subdomain, 'subdomain_changed');
        }
        return tx.tenant.update({
          where: { id: tenantId },
          data: updateDto,
          select: SETTINGS_SELECT,
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Subdomain already in use');
      }
      throw err;
    }
  }
}
