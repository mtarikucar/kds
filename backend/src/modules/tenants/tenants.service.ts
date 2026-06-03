import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EntitlementService } from "../entitlements/entitlement.service";
import { UpdateTenantSettingsDto } from "./dto/update-tenant-settings.dto";
import { TenantStatus } from "../../common/constants/subscription.enum";
import {
  isSubdomainQuarantined,
  reserveSubdomain,
} from "../../common/helpers/subdomain.helper";

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
  // KDV-compliant Turkish invoicing requires the tenant's tax ID
  // (Vergi No / TC Kimlik). Snapshotted onto invoices at issuance.
  taxId: true,
} as const;

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    // v2.8.90: subdomain change permission now reads the engine's
    // customBranding view so customBranding granted via add-on
    // (`custom_branding_pack` or admin override) is honoured.
    // Pre-v2.8.90 it read tenant.currentPlan.customBranding directly,
    // missing both override and add-on paths.
    private entitlements: EntitlementService,
  ) {}

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
      orderBy: { name: "asc" },
    });
  }

  private async validateSubdomainChangePermission(
    tenantId: string,
    currentSubdomain: string | null,
    newSubdomain: string | null | undefined,
  ): Promise<void> {
    if (newSubdomain === currentSubdomain) return;
    if (!newSubdomain) return;

    // v2.8.90 — engine-routed. Falls back to the plan column if the
    // engine has no grants for this tenant yet (projector race).
    const engineSet = await this.entitlements.getForTenant(tenantId, null);
    const engineCustomBranding = engineSet.features["feature.customBranding"];
    let hasCustomBranding: boolean;
    if (typeof engineCustomBranding === "boolean") {
      hasCustomBranding = engineCustomBranding;
    } else {
      const tenantWithPlan = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { currentPlan: true },
      });
      hasCustomBranding = tenantWithPlan?.currentPlan?.customBranding ?? false;
    }

    if (!hasCustomBranding) {
      throw new ForbiddenException(
        "Custom subdomain is a Pro feature. Upgrade your plan or buy the add-on to set or change your subdomain.",
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

  async updateSettings(
    tenantId: string,
    updateDto: UpdateTenantSettingsDto,
    actorUserId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    // A suspended/deleted tenant must not be able to keep editing
    // customer-visible settings (subdomain, social links, etc.).
    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException("Tenant is not active");
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
        throw new ConflictException("Subdomain already in use");
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
          await reserveSubdomain(tx, tenant.subdomain, "subdomain_changed");
        }
        const updated = await tx.tenant.update({
          where: { id: tenantId },
          data: updateDto,
          select: SETTINGS_SELECT,
        });

        // Audit trail for forensic "who changed the subdomain / branding
        // / billing email" questions. We store the set of changed field
        // names rather than full values — some fields are sensitive
        // (taxId, billingEmail) and audit logs are retained for months.
        if (actorUserId) {
          await tx.userActivity.create({
            data: {
              userId: actorUserId,
              tenantId,
              action: "TENANT_SETTINGS_UPDATED",
              metadata: {
                changedFields: Object.keys(updateDto),
              },
            },
          });
        }

        return updated;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Subdomain already in use");
      }
      throw err;
    }
  }
}
