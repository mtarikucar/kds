import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SuperAdminGuard } from "../superadmin/guards/superadmin.guard";
import { SuperAdminRoute } from "../superadmin/decorators/superadmin.decorator";
import { CurrentSuperAdmin } from "../superadmin/decorators/current-superadmin.decorator";
import { SuperAdminAuditService } from "../superadmin/services/superadmin-audit.service";
import { AuditAction, EntityType } from "../superadmin/dto/audit-filter.dto";
import { PrismaService } from "../../prisma/prisma.service";
import { TenantMarketplaceService } from "./tenant-marketplace.service";
import { AddOnCatalogService } from "./addon-catalog.service";
import { PlanProjectorService } from "../entitlements/plan-projector.service";
import { LicensingService } from "../licensing/licensing.service";
import { CreditService } from "../credits/credit.service";
import { CompProductDto } from "./dto/comp.dto";
import { daysBetweenUtc } from "../licensing/anniversary";

/**
 * Operator-side entitlement management for the à-la-carte catalog.
 *
 * Two things live here that the panel could not do before: see what a tenant
 * actually owns, and give a tenant a product without charging for it.
 *
 * The comp path matters more than it looks. Before this, the only lever an
 * operator had was `Tenant.featureOverrides`, and that lever is a trap — the
 * projector turns every key it carries into `{__replace:false}` semantics for
 * suppression, so an override written today can permanently outrank a product
 * the tenant BUYS tomorrow. A comp instead mints an ordinary ownership row:
 * it expires on the anniversary like every other line, shows up in the
 * tenant's own list, carries who granted it and why, and loses cleanly to a
 * later purchase of the same code (which just renews the row).
 */
@ApiTags("SuperAdmin · Entitlements")
@ApiBearerAuth()
@SuperAdminRoute()
@UseGuards(SuperAdminGuard)
@Controller("v1/superadmin/marketplace")
export class SuperadminEntitlementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantMarketplace: TenantMarketplaceService,
    private readonly catalog: AddOnCatalogService,
    private readonly projector: PlanProjectorService,
    private readonly licensing: LicensingService,
    private readonly credits: CreditService,
    private readonly audit: SuperAdminAuditService,
  ) {}

  @Get("tenants/:tenantId/licensing")
  @ApiOperation({
    summary: "Licence state, owned products and credit balances for a tenant",
  })
  async tenantLicensing(@Param("tenantId") tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, licenseAnchorAt: true },
    });
    if (!tenant) throw new BadRequestException("Tenant not found");

    const now = new Date();
    const [ctx, owned, balances] = await Promise.all([
      this.licensing.loadContext(tenantId, now),
      this.prisma.tenantAddOn.findMany({
        where: { tenantId },
        include: {
          addOn: {
            select: {
              code: true,
              name: true,
              kind: true,
              priceCents: true,
              currency: true,
              requiresLicense: true,
            },
          },
        },
        orderBy: [{ status: "asc" }, { activatedAt: "desc" }],
      }),
      this.credits.balances(tenantId),
    ]);

    const anniversaryAt = this.licensing.nextAnniversaryFor(
      ctx.anchorAt,
      now,
      ctx.tz,
    );

    return {
      tenant: { id: tenant.id, name: tenant.name },
      license: {
        // hasLicense comes from the live entitlement context, not from the
        // presence of an anchor: an anchor is permanent, a licence lapses.
        active: ctx.hasLicense,
        anchorAt: ctx.anchorAt?.toISOString() ?? null,
        anniversaryAt: anniversaryAt?.toISOString() ?? null,
        daysRemaining: anniversaryAt
          ? daysBetweenUtc(now, anniversaryAt)
          : null,
      },
      owned: owned.map((o) => ({
        id: o.id,
        code: o.addOn.code,
        name: o.addOn.name,
        kind: o.addOn.kind,
        quantity: o.quantity,
        status: o.status,
        origin: o.origin,
        compReason: o.compReason,
        periodEnd: o.currentPeriodEnd?.toISOString() ?? null,
        chargedCents: o.chargedCents,
        listCents: o.addOn.priceCents * o.quantity,
        currency: o.addOn.currency,
        // Surfaced so the panel can explain a product that is owned but dark.
        suppressedByLicence: o.addOn.requiresLicense && !ctx.hasLicense,
      })),
      credits: Object.fromEntries(balances.map((b) => [b.kind, b.remaining])),
    };
  }

  @Post("comp")
  @ApiOperation({ summary: "Grant a catalog product to a tenant for free" })
  async comp(
    @Body() dto: CompProductDto,
    @CurrentSuperAdmin() actor: { id: string; email: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
      select: { id: true, name: true },
    });
    if (!tenant) throw new BadRequestException("Tenant not found");

    const addOn = await this.catalog.findByCodeOrThrow(dto.addOnCode);
    const comp = { actorId: actor.id, reason: dto.reason };

    // Credit packs are a balance, not an entitlement — they mint a lot and
    // never an ownership row. purchase() rejects them outright, so route by
    // kind rather than letting the operator hit a confusing 400.
    const result =
      addOn.kind === "credit"
        ? await this.tenantMarketplace.purchaseCredits(
            dto.tenantId,
            { addOnCode: dto.addOnCode, quantity: dto.quantity ?? 1 },
            undefined,
            { comp },
          )
        : await this.tenantMarketplace.purchase(
            dto.tenantId,
            {
              addOnCode: dto.addOnCode,
              quantity: dto.quantity ?? 1,
              branchId: dto.branchId,
            },
            undefined,
            { comp },
          );

    // purchase() emits AddOnPurchased and lets the projector catch up
    // asynchronously. An operator who just comped a product then reloads the
    // tenant expects to see it live, so project inline — it is idempotent, and
    // waiting on the event rail here would show a stale panel.
    if (addOn.kind !== "credit") {
      await this.projector.projectTenant(dto.tenantId);
    }

    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: EntityType.ENTITLEMENT,
      entityId: dto.addOnCode,
      actorId: actor.id,
      actorEmail: actor.email,
      newData: {
        addOnCode: dto.addOnCode,
        quantity: dto.quantity ?? 1,
        kind: addOn.kind,
        listCents: addOn.priceCents,
      },
      metadata: { reason: dto.reason, origin: "comp" },
      targetTenantId: tenant.id,
      targetTenantName: tenant.name,
    });

    return {
      ok: true,
      kind: addOn.kind,
      result,
      // A requiresLicense product comped to an unlicensed tenant is owned but
      // dark. Saying so here stops the operator concluding the comp failed.
      warning:
        addOn.requiresLicense && addOn.kind !== "license"
          ? await this.licenceWarning(dto.tenantId)
          : null,
    };
  }

  @Delete("comp/:tenantAddOnId")
  @ApiOperation({
    summary: "Revoke a comped product (immediate; leaves paid rows alone)",
  })
  async revokeComp(
    @Param("tenantAddOnId") tenantAddOnId: string,
    @Query("tenantId") tenantId: string,
    @CurrentSuperAdmin() actor: { id: string; email: string },
  ) {
    if (!tenantId) throw new BadRequestException("tenantId is required");

    const row = await this.prisma.tenantAddOn.findFirst({
      where: { id: tenantAddOnId, tenantId },
      include: { addOn: { select: { code: true } } },
    });
    if (!row) throw new BadRequestException("Add-on not found for this tenant");

    // Refuse to revoke something the tenant paid for. Taking away a purchase
    // is a refund decision, not a panel click — and the refund itself has to
    // happen on the payment rail first.
    if (row.origin !== "comp") {
      throw new BadRequestException(
        `"${row.addOn.code}" was purchased, not comped. Cancel it through the tenant's own billing flow.`,
      );
    }

    const cancelled = await this.tenantMarketplace.cancel(
      tenantId,
      tenantAddOnId,
      true,
    );
    await this.projector.projectTenant(tenantId);

    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: EntityType.ENTITLEMENT,
      entityId: row.addOn.code,
      actorId: actor.id,
      actorEmail: actor.email,
      previousData: { status: row.status, origin: row.origin },
      metadata: { revokedComp: true },
      targetTenantId: tenantId,
    });

    return cancelled;
  }

  private async licenceWarning(tenantId: string): Promise<string | null> {
    const ctx = await this.licensing.loadContext(tenantId, new Date());
    return ctx.hasLicense
      ? null
      : "Tenant has no active licence — this product is owned but its grants stay suppressed until a licence is active.";
  }
}
