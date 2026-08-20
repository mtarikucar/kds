import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EntitlementService } from "../entitlements/entitlement.service";
import { isFreeBaselineFeature } from "../entitlements/free-baseline.const";
import { UpdateTenantSettingsDto } from "./dto/update-tenant-settings.dto";
import { TenantStatus } from "../../common/constants/subscription.enum";
import {
  isSubdomainQuarantined,
  reserveSubdomain,
} from "../../common/helpers/subdomain.helper";
import { resolveCountryProfile } from "../../common/country/country.service";

const SETTINGS_SELECT = {
  id: true,
  name: true,
  subdomain: true,
  currency: true,
  // Task 7's frontend currency formatter resolves the country profile from
  // this — currency alone can't tell it the display-decimals rule.
  countryCode: true,
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

    // v2.8.90 — engine-routed. The fallback used to read
    // `tenant.currentPlan.customBranding`, which the à-la-carte migration
    // turned into a guaranteed `false`: `20260811120000_free_core` nulled
    // every `currentPlanId`, so the projector race it was meant to cover
    // started denying the feature outright instead of covering for it.
    // Custom branding is unconditionally free now
    // (FREE_BASELINE_GRANTS), so the honest fallback is the baseline itself.
    const engineSet = await this.entitlements.getForTenant(tenantId, null);
    const engineCustomBranding = engineSet.features["feature.customBranding"];
    const hasCustomBranding =
      typeof engineCustomBranding === "boolean"
        ? engineCustomBranding
        : isFreeBaselineFeature("feature.customBranding");

    if (!hasCustomBranding) {
      // Reachable only when ops has suppressed a free-core capability for
      // this one tenant (`override:admin`), so there is nothing to sell.
      throw new ForbiddenException(
        "Custom subdomain is part of the free core, but it is currently disabled on this account. Please contact support.",
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

    // DERIVED, not stored — the product editor and the menu-import review
    // grid need the tenant's ACTUAL allowed tax band to offer as <option>s,
    // not a hardcoded Turkish one. Nothing new is written to the Tenant
    // row; COUNTRY_PROFILES (via resolveCountryProfile) stays the single
    // source of truth, mirroring @IsCountryTaxRate on the backend DTOs.
    const profile = resolveCountryProfile(tenant.countryCode);
    return {
      ...tenant,
      // DERIVED, overriding the raw `tenant.currency` column spread in
      // above — that column is a written MIRROR, never the truth (see
      // CountryService.currencyForTenant()). A stale/mismatched row must
      // not leak its old currency back to the client; the profile always
      // wins. `displayDecimals` has no column at all — UZS renders whole
      // (so'm) while storage stays x100 for every currency, always.
      currency: profile.currency,
      displayDecimals: profile.displayDecimals,
      taxRates: profile.taxRates,
      defaultTaxRate: profile.defaultTaxRate,
      // Serialized: RegExp doesn't survive JSON, so ship the pattern SOURCE
      // string. The frontend reconstructs it with `new RegExp(pattern)` —
      // see isValidTaxId() in frontend/src/hooks/useCountryProfile.ts.
      taxIdRules: profile.taxIdRules.map((r) => ({
        name: r.name,
        pattern: r.pattern.source,
        labelKey: r.labelKey,
      })),
    };
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

      // Pass the caller's tenantId: a quarantine row THIS tenant created by
      // renaming away is reclaimable by it (undo), while a name parked by
      // any other tenant still blocks for the full window.
      if (
        updateDto.subdomain &&
        updateDto.subdomain !== tenant.subdomain &&
        (await isSubdomainQuarantined(
          this.prisma,
          updateDto.subdomain,
          tenantId,
        ))
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
          // Stamp the owner so the same tenant can reclaim this name later.
          await reserveSubdomain(
            tx,
            tenant.subdomain,
            "subdomain_changed",
            tenantId,
          );
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
