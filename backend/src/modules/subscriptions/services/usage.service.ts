import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { EntitlementInvalidationBus } from "../../entitlements/entitlement-invalidation.bus";

/**
 * v2.8.88 — usage snapshot.
 *
 * Feeds:
 *   - Plan & Erişim page (kotalar grid)
 *   - Dashboard quota mini-cards
 *   - Future: upsell prompts when usage approaches a limit
 *
 * Reads counts from the source tables (User, Branch, Product,
 * Order) and pairs each with the resolved limit from the entitlement
 * engine. `-1` means unlimited per the engine convention; we surface
 * that verbatim to the client.
 *
 * Cache: 60s per tenant, in-process Map. Counts move on order/user/
 * branch mutations but the UI doesn't need sub-second freshness on a
 * quota card. Bus-driven invalidation can land later if a tenant
 * approaching a limit needs immediate feedback.
 */
export interface UsageDimension {
  current: number;
  max: number; // -1 means unlimited
}

export interface UsageSnapshot {
  users: UsageDimension;
  branches: UsageDimension;
  tables: UsageDimension;
  products: UsageDimension;
  monthlyOrders: UsageDimension;
  computedAt: string;
}

@Injectable()
export class UsageService implements OnModuleInit {
  private readonly logger = new Logger(UsageService.name);
  private readonly cache = new Map<
    string,
    { snapshot: UsageSnapshot; expiresAt: number }
  >();
  private readonly cacheTtlMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    // v2.8.91: subscribe to the entitlement invalidation bus so the
    // usage snapshot drops alongside the engine cache on every
    // subscription / addon / override mutation. Pre-v2.8.91 the
    // invalidate() method existed but had no producer — a tenant who
    // bought an add-on could see stale quotas for up to 60s.
    @Optional() private readonly invalidationBus?: EntitlementInvalidationBus,
  ) {}

  onModuleInit(): void {
    // Same listener shape EntitlementService uses; the bus filters by
    // senderId so we never re-publish to ourselves.
    this.invalidationBus?.registerListener((tenantId) =>
      this.invalidate(tenantId),
    );
  }

  async getSnapshot(tenantId: string): Promise<UsageSnapshot> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

    // Tenant existence sanity — protects the count queries from
    // running against a missing tenant (would return 0 anyway, but
    // surfacing NotFound is more honest).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException("Tenant not found");

    // Bound the order count to the current calendar month — matches
    // the existing PlanFeatureGuard.checkLimit MONTHLY_ORDERS logic
    // so a value visible in the snapshot matches the value used to
    // gate.
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      userCount,
      branchCount,
      tableCount,
      productCount,
      orderCount,
      entSet,
    ] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, status: "ACTIVE" } }),
      // v3.0.0 — count only active branches; archived rows are
      // soft-deleted and don't count toward the cap (same predicate
      // PlanFeatureGuard.checkLimit uses for BRANCHES).
      this.prisma.branch.count({ where: { tenantId, status: "active" } }),
      this.prisma.table.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: startOfMonth } },
      }),
      this.entitlements.getForTenant(tenantId, null),
    ]);

    // Engine limits use the `limit.<name>` prefix. Use the engine value
    // when present; fall back to the plan row if the engine hasn't
    // populated yet (mirrors getEffectiveFeatures fallback).
    const maxUsers = this.resolveLimit(entSet.limits, "maxUsers");
    const maxBranches = this.resolveLimit(entSet.limits, "maxBranches");
    const maxTables = this.resolveLimit(entSet.limits, "maxTables");
    const maxProducts = this.resolveLimit(entSet.limits, "maxProducts");
    const maxMonthlyOrders = this.resolveLimit(
      entSet.limits,
      "maxMonthlyOrders",
    );

    // Plan-only fallback for the engine-missing case (mid-projector
    // race for brand-new tenants). The engine path is authoritative
    // post-v3.0.0 — `maxBranches` now lives on SubscriptionPlan, so the
    // pre-v3 "branches default 1, no plan column" assumption no longer
    // holds.
    let snapshot: UsageSnapshot;
    if (
      maxUsers === undefined ||
      maxTables === undefined ||
      maxProducts === undefined ||
      maxMonthlyOrders === undefined
    ) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { currentPlan: true },
      });
      const plan = t?.currentPlan;
      snapshot = {
        users: { current: userCount, max: maxUsers ?? plan?.maxUsers ?? 0 },
        branches: {
          current: branchCount,
          max: maxBranches ?? plan?.maxBranches ?? 1,
        },
        tables: { current: tableCount, max: maxTables ?? plan?.maxTables ?? 0 },
        products: {
          current: productCount,
          max: maxProducts ?? plan?.maxProducts ?? 0,
        },
        monthlyOrders: {
          current: orderCount,
          max: maxMonthlyOrders ?? plan?.maxMonthlyOrders ?? 0,
        },
        computedAt: new Date().toISOString(),
      };
    } else {
      snapshot = {
        users: { current: userCount, max: maxUsers },
        // Branches default 1 when no grant — every tenant has at least
        // a single implicit "main" branch concept.
        branches: { current: branchCount, max: maxBranches ?? 1 },
        tables: { current: tableCount, max: maxTables },
        products: { current: productCount, max: maxProducts },
        monthlyOrders: { current: orderCount, max: maxMonthlyOrders },
        computedAt: new Date().toISOString(),
      };
    }

    this.cache.set(tenantId, {
      snapshot,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    return snapshot;
  }

  /**
   * Engine `limit.X` reading. Returns undefined when the key is not
   * present in the engine set so callers can decide whether to fall
   * back to plan rows.
   */
  private resolveLimit(
    engineLimits: Record<string, number>,
    name: string,
  ): number | undefined {
    const v = engineLimits[`limit.${name}`];
    return typeof v === "number" ? v : undefined;
  }

  /** Called by the entitlement invalidation bus on add-on / plan changes. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
