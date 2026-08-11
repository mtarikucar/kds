import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EntitlementService } from "../entitlements/entitlement.service";
import { featureKey } from "../entitlements/entitlement-keys.const";
import {
  DEFAULT_TENANT_TZ,
  ProrationResult,
  anchorDateFor,
  nextAnniversary,
  prorate,
} from "./anniversary";

/**
 * Everything a pricing pass needs about one tenant's licensing position,
 * loaded ONCE per quote.
 *
 * Resolving the anchor per line would be both an N+1 and — worse — a
 * correctness bug: the first cart a tenant ever submits contains the licence
 * that DEFINES the anchor, so every sibling line must be priced against the
 * same resolved anchor, not against a value re-read line by line.
 */
export interface LicensingContext {
  tenantId: string;
  /** The tenant's immutable anniversary anchor, or null before the first licence. */
  anchorAt: Date | null;
  /** Does a live (active or in-grace) licence exist right now? */
  hasLicense: boolean;
  /** Frozen pricing instant. Settlement re-prices with this exact value. */
  now: Date;
  /** IANA zone the anchor's calendar date is resolved in. */
  tz: string;
}

@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  /**
   * `now` must be the caller's FROZEN pricing instant
   * (`CheckoutIntent.pricedAt`), never `new Date()` at the call site.
   * Settlement re-quotes the cart and refuses to provision on a >1 kuruş
   * divergence; proration depends on `now`, so an intent priced at 23:58 and
   * settled at 00:03 would diverge by a day's worth and strand a paid cart.
   */
  async loadContext(tenantId: string, now: Date): Promise<LicensingContext> {
    const [tenant, ent] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { licenseAnchorAt: true, timezone: true },
      }),
      this.entitlements.getForTenant(tenantId, null),
    ]);
    return {
      tenantId,
      anchorAt: tenant?.licenseAnchorAt ?? null,
      hasLicense: ent?.features?.[featureKey("license")] === true,
      now,
      // Same convention as ReportsService / AttendanceService: the tenant's
      // configured zone decides which calendar day an instant belongs to.
      tz: tenant?.timezone || DEFAULT_TENANT_TZ,
    };
  }

  /**
   * Price one annual line against the tenant's cycle.
   *
   * When `ctx.anchorAt` is null — the tenant's very first purchase — prorate
   * anchors to today, which makes every line in that opening cart resolve to
   * a full, perfectly aligned cycle. That is why the context is loaded once
   * and shared: pricing line-by-line off a freshly re-read tenant row would
   * be an N+1 AND would let two lines in the same cart disagree about when
   * the year starts.
   */
  price(
    ctx: LicensingContext,
    annualPriceCents: number,
    opts: { quantity?: number } = {},
  ): ProrationResult {
    return prorate({
      annualPriceCents,
      anchorAt: ctx.anchorAt,
      now: ctx.now,
      quantity: opts.quantity,
      tz: ctx.tz,
    });
  }

  /** The anchor this cart will establish, for persisting on first purchase. */
  resolveAnchorFor(ctx: LicensingContext): Date {
    return ctx.anchorAt ?? anchorDateFor(ctx.now, ctx.tz);
  }

  /** The anniversary an item bought now should run to. */
  periodEndFor(ctx: LicensingContext, annualPriceCents = 0): Date {
    return this.price(ctx, annualPriceCents).periodEnd;
  }

  /**
   * Stamp the anniversary anchor the first time a tenant is licensed.
   *
   * `licenseAnchorAt ?? anchor` inside the update is deliberate and is the
   * whole reason the anchor lives on Tenant rather than on the TenantAddOn
   * row: `purchase()` rewrites `activatedAt` on every renewal, so an anchor
   * derived from the ownership row would drift forward every time a customer
   * paid a renewal late. Written once, never rewritten.
   */
  async stampAnchorIfAbsent(
    tx: Prisma.TransactionClient,
    tenantId: string,
    anchorAt: Date,
  ): Promise<void> {
    const updated = await tx.tenant.updateMany({
      where: { id: tenantId, licenseAnchorAt: null },
      data: { licenseAnchorAt: anchorAt },
    });
    if (updated.count > 0) {
      this.logger.log(
        `Tenant ${tenantId} licence anchor set to ${anchorAt.toISOString().slice(0, 10)}`,
      );
    }
  }

  /**
   * The tenant's next anniversary, or null when they have never been
   * licensed. Used by the renewal-cycle generator and the licence UI.
   */
  nextAnniversaryFor(
    anchorAt: Date | null,
    from: Date,
    tz = DEFAULT_TENANT_TZ,
  ): Date | null {
    if (!anchorAt) return null;
    return nextAnniversary(anchorAt, anchorDateFor(from, tz));
  }
}
