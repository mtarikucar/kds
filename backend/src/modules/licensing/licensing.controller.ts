import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SkipBranchScope } from "../auth/decorators/skip-branch-scope.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { EntitlementService } from "../entitlements/entitlement.service";
import { featureKey } from "../entitlements/entitlement-keys.const";
import { CreditService } from "../credits/credit.service";
import { LicensingService } from "./licensing.service";
import { RenewalCycleService } from "./renewal-cycle.service";
import { TenantInvoiceService } from "../checkout/tenant-invoice.service";
import { anchorDateFor, daysBetweenUtc } from "./anniversary";

/**
 * Everything the SPA needs to render licence state, owned products, credits
 * and the upsell prices — in ONE request.
 *
 * It replaces three separate calls the frontend used to make on every page
 * load (`/subscriptions/plans`, `/subscriptions/current`,
 * `/subscriptions/effective-features`), and more importantly it makes the
 * price shown on an upsell come from the same catalog read as the price
 * charged at checkout. The old frontend derived upsell copy from a hardcoded
 * feature→plan table, which was a second source of pricing truth that nothing
 * kept in sync.
 */
@ApiTags("licensing")
@Controller("v1")
export class LicensingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly licensing: LicensingService,
    private readonly credits: CreditService,
    private readonly renewals: RenewalCycleService,
    private readonly tenantInvoices: TenantInvoiceService,
  ) {}

  @Get("me/licensing")
  @UseGuards(JwtAuthGuard)
  @SkipBranchScope()
  @ApiOperation({
    summary: "Licence state, owned products, credits and current offers",
  })
  async me(@Req() req: any, @Query("locale") locale = "tr") {
    const tenantId = req.user.tenantId;
    const now = new Date();

    const [ent, ctx, balances, owned, renewal, catalog] = await Promise.all([
      this.entitlements.getForTenant(tenantId, null),
      this.licensing.loadContext(tenantId, now),
      this.credits.balances(tenantId),
      this.prisma.tenantAddOn.findMany({
        where: { tenantId, status: { in: ["active", "past_due"] } },
        include: {
          addOn: {
            select: {
              code: true,
              name: true,
              kind: true,
              priceCents: true,
              currency: true,
              i18n: true,
            },
          },
        },
        orderBy: { activatedAt: "asc" },
      }),
      this.renewals.openFor(tenantId),
      this.prisma.marketplaceAddOn.findMany({
        where: { status: "published" },
        select: {
          code: true,
          name: true,
          kind: true,
          billing: true,
          priceCents: true,
          currency: true,
          grants: true,
          requiresLicense: true,
          i18n: true,
        },
      }),
    ]);

    const hasLicense = ent.features?.[featureKey("license")] === true;
    const anniversaryAt = this.licensing.nextAnniversaryFor(
      ctx.anchorAt,
      now,
      ctx.tz,
    );

    // Which of the four states the licence is in decides what the UI offers:
    // buy, nothing, renew-now, or renew-to-restore.
    const licenceRow = owned.find((o) => o.addOn.kind === "license");
    const status = !ctx.anchorAt
      ? "none"
      : hasLicense
        ? licenceRow?.status === "past_due"
          ? "grace"
          : "active"
        : "expired";

    const localized = (row: { name: string; i18n: unknown }) =>
      (row.i18n as Record<string, { name?: string }> | null)?.[locale]?.name ??
      row.name;

    return {
      entitlements: {
        features: ent.features,
        limits: ent.limits,
        integrations: ent.integrations,
        computedAt: ent.computedAt,
      },
      license: {
        status,
        anchorAt: ctx.anchorAt?.toISOString() ?? null,
        anniversaryAt: anniversaryAt?.toISOString() ?? null,
        daysRemaining: anniversaryAt
          ? daysBetweenUtc(anchorDateFor(now, ctx.tz), anniversaryAt)
          : null,
      },
      credits: Object.fromEntries(balances.map((b) => [b.kind, b.remaining])),
      owned: owned.map((o) => ({
        code: o.addOn.code,
        name: localized(o.addOn),
        kind: o.addOn.kind,
        quantity: o.quantity,
        pendingQuantity: o.pendingQuantity,
        status: o.status,
        periodEnd: o.currentPeriodEnd?.toISOString() ?? null,
        chargedCents: o.chargedCents,
        // What this line will cost at renewal — full list, not the prorated
        // slice they paid mid-year.
        renewalCents: o.addOn.priceCents * o.quantity,
        currency: o.addOn.currency,
        origin: o.origin,
      })),
      renewal: renewal
        ? {
            cycleId: renewal.id,
            anniversaryAt: renewal.anniversaryAt.toISOString(),
            graceEndsAt: renewal.graceEndsAt.toISOString(),
            totalCents: renewal.totalCents,
            currency: renewal.currency,
            daysLeft: daysBetweenUtc(now, renewal.anniversaryAt),
          }
        : null,
      // Every grant key → the cheapest product that provides it, priced for
      // THIS tenant today. The upsell price and the checkout price are the
      // same number because they come from the same read.
      offers: this.buildOffers(catalog, ctx, locale),
    };
  }

  @Get("me/invoices")
  @UseGuards(JwtAuthGuard)
  @SkipBranchScope()
  @ApiOperation({ summary: "Itemized à-la-carte invoices for this tenant" })
  async invoices(@Req() req: any) {
    // Reads tenant_invoices, not the legacy `invoices` archive: the two
    // coexist deliberately (that table holds tax records behind a NOT NULL
    // subscriptionId), and only one of them describes a purchase anybody can
    // still make.
    return {
      invoices: await this.tenantInvoices.listForTenant(req.user.tenantId),
    };
  }

  /**
   * The public price list.
   *
   * Marketing pages consume this rather than a hardcoded table, so a price
   * change in the superadmin panel cannot leave the website advertising an
   * amount checkout will not honour.
   */
  @Get("catalog/pricing")
  @Public()
  @ApiOperation({ summary: "Published catalog with prices (public)" })
  async pricing(@Query("locale") locale = "tr") {
    const rows = await this.prisma.marketplaceAddOn.findMany({
      where: { status: "published" },
      select: {
        code: true,
        name: true,
        description: true,
        kind: true,
        billing: true,
        priceCents: true,
        currency: true,
        creditKind: true,
        creditUnits: true,
        requiresLicense: true,
        sortOrder: true,
        i18n: true,
      },
      orderBy: [{ sortOrder: "asc" }],
    });
    return {
      products: rows.map((r) => {
        const copy = (r.i18n as Record<string, any> | null)?.[locale];
        return {
          code: r.code,
          name: copy?.name ?? r.name,
          description: copy?.description ?? r.description,
          kind: r.kind,
          billing: r.billing,
          priceCents: r.priceCents,
          currency: r.currency,
          creditKind: r.creditKind,
          creditUnits: r.creditUnits,
          requiresLicense: r.requiresLicense,
          sortOrder: r.sortOrder,
        };
      }),
    };
  }

  private buildOffers(
    catalog: Array<{
      code: string;
      name: string;
      kind: string;
      billing: string;
      priceCents: number;
      currency: string;
      grants: unknown;
      i18n: unknown;
    }>,
    ctx: Parameters<LicensingService["price"]>[0],
    locale: string,
  ) {
    const out: Record<string, unknown> = {};
    // Cheapest first, so a key resolves to the least a tenant can spend.
    const sorted = [...catalog].sort((a, b) => a.priceCents - b.priceCents);
    for (const row of sorted) {
      const grants = (row.grants ?? {}) as Record<string, unknown>;
      const priced =
        row.billing === "annual"
          ? this.licensing.price(ctx, row.priceCents)
          : null;
      const summary = {
        code: row.code,
        name:
          (row.i18n as Record<string, { name?: string }> | null)?.[locale]
            ?.name ?? row.name,
        kind: row.kind,
        annualPriceCents: row.priceCents,
        proratedCents: priced?.unitCents ?? row.priceCents,
        currency: row.currency,
        periodEnd: priced?.periodEnd.toISOString() ?? null,
      };
      for (const key of Object.keys(grants)) {
        if (!(key in out)) out[key] = summary;
      }
    }
    return out;
  }
}
