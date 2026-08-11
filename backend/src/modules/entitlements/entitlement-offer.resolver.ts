import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { LicensingService } from "../licensing/licensing.service";
import { OfferSummary } from "./entitlement-required.exception";
import { LICENSE_PRODUCT_CODE } from "./entitlement-keys.const";

interface CachedCatalog {
  rows: Array<{
    code: string;
    name: string;
    kind: string;
    billing: string;
    priceCents: number;
    currency: string;
    grants: Record<string, unknown>;
    requiresLicense: boolean;
    i18n: Record<string, { name?: string }> | null;
  }>;
  expiresAt: number;
}

const CATALOG_TTL_MS = 5 * 60_000;

/**
 * Turns "you are missing entitlement X" into "here is the product that grants
 * X, and here is what it costs you today".
 *
 * This is what lets the frontend delete its hardcoded feature→plan table. That
 * table was a second source of pricing truth that nothing kept in sync with
 * the catalog; resolving the offer server-side means the price shown on the
 * upsell and the price charged at checkout come from the same read.
 *
 * The catalog is small and changes rarely, so it is cached for five minutes.
 * The PRICE, however, is computed per call: proration depends on the tenant's
 * position in their cycle, so a cached price would be wrong for everyone but
 * the tenant it was computed for.
 */
@Injectable()
export class EntitlementOfferResolver {
  private readonly logger = new Logger(EntitlementOfferResolver.name);
  private cache: CachedCatalog | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly licensing: LicensingService,
  ) {}

  private async catalog(): Promise<CachedCatalog["rows"]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.rows;
    const rows = await this.prisma.marketplaceAddOn.findMany({
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
      orderBy: [{ priceCents: "asc" }],
    });
    this.cache = {
      rows: rows as any,
      expiresAt: now + CATALOG_TTL_MS,
    };
    return this.cache.rows;
  }

  /** Drop the cache — called when the catalog is edited. */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * The cheapest published product whose grants satisfy `key`.
   *
   * `key` is a full entitlement key (`feature.advancedReports`,
   * `limit.maxBranches`, `integration.fiscal`). Ordering by price means a
   * tenant is always offered the least they can spend to unlock what they hit.
   */
  async forKey(
    tenantId: string,
    key: string,
    opts: { locale?: string; now?: Date } = {},
  ): Promise<OfferSummary | null> {
    const rows = await this.catalog();
    const match = rows.find((r) => {
      const grants = (r.grants ?? {}) as Record<string, unknown>;
      if (key.startsWith("integration.")) {
        // Any vendor in the domain unlocks the domain gate.
        return (
          Array.isArray(grants[key]) && (grants[key] as unknown[]).length > 0
        );
      }
      if (key.startsWith("limit.")) {
        return typeof grants[key] === "number";
      }
      return grants[key] === true;
    });
    if (!match) return null;

    return this.summarize(tenantId, match, opts);
  }

  /** The licence product itself, for the "you need a licence first" case. */
  async licenceOffer(
    tenantId: string,
    opts: { locale?: string; now?: Date } = {},
  ): Promise<OfferSummary | null> {
    const rows = await this.catalog();
    const licence = rows.find((r) => r.code === LICENSE_PRODUCT_CODE);
    return licence ? this.summarize(tenantId, licence, opts) : null;
  }

  private async summarize(
    tenantId: string,
    row: CachedCatalog["rows"][number],
    opts: { locale?: string; now?: Date },
  ): Promise<OfferSummary> {
    const localized =
      opts.locale && row.i18n?.[opts.locale]?.name
        ? row.i18n[opts.locale].name!
        : row.name;

    if (row.billing !== "annual") {
      // One-time products (credits, services) have no cycle to prorate into.
      return {
        code: row.code,
        name: localized,
        kind: row.kind,
        annualPriceCents: row.priceCents,
        proratedCents: row.priceCents,
        currency: row.currency,
        periodEnd: null,
      };
    }

    const ctx = await this.licensing.loadContext(
      tenantId,
      opts.now ?? new Date(),
    );
    const priced = this.licensing.price(ctx, row.priceCents);
    return {
      code: row.code,
      name: localized,
      kind: row.kind,
      annualPriceCents: row.priceCents,
      proratedCents: priced.unitCents,
      currency: row.currency,
      periodEnd: priced.periodEnd.toISOString(),
    };
  }

  /**
   * Did the tenant once own the product behind this offer?
   *
   * Drives "Renew" vs "Buy" on the 403. A lapsed product is one click from
   * working again; a never-owned one needs the full purchase flow.
   */
  async reasonFor(
    tenantId: string,
    offer: OfferSummary | null,
  ): Promise<"not_owned" | "lapsed"> {
    if (!offer) return "not_owned";
    const lapsed = await this.prisma.tenantAddOn.findFirst({
      where: {
        tenantId,
        addOn: { code: offer.code },
        status: { in: ["past_due", "expired", "cancelled"] },
      },
      select: { id: true },
    });
    return lapsed ? "lapsed" : "not_owned";
  }
}
