import { ForbiddenException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DeviceService } from "./device.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { LimitType } from "../subscriptions/decorators/check-limit.decorator";
import { ADDONS } from "../../../prisma/seeds/seed-marketplace";

/**
 * DEF-7 / Task 6 regression coverage: the `kds_extra_screen` (₺99/mo,
 * grants `limit.kdsScreens`) and `extra_tablet` (₺79/mo, grants
 * `limit.tablets`) marketplace add-ons wrote a grant into the entitlement
 * engine that NOTHING read — buying them changed nothing. This file locks
 * down the fix in two layers:
 *
 *  1. DeviceService.enforceDeviceCapacity — the REAL production enforcement
 *     path. POST /v1/devices creates every DeviceKind through one endpoint,
 *     so a route-level @CheckLimit (fixed per route, not per request-body
 *     field) can't gate only kds_screen/tablet_waiter; enforcement lives
 *     inside createSlot() instead.
 *  2. PlanFeatureGuard.checkLimit's KDS_SCREENS/TABLETS switch cases — the
 *     canonical "how do we count usage for this LimitType" definition,
 *     mirroring the LimitType.TABLES pattern, directly unit-tested the same
 *     way plan-feature.guard.spec.ts tests the rest of the guard.
 *
 * `kds_extra_station` (`limit.kdsStations`) is deliberately NOT covered
 * here — see check-limit.decorator.ts's LimitType doc and task-6-report.md:
 * KDS "stations" are not a persisted, countable entity anywhere in this
 * codebase (KdsRoutingService fans every order out branch-wide; there is no
 * station table/column/DeviceKind), so there is no anchor to enforce
 * against without inventing one.
 */
describe("DEF-7: kds_extra_screen / extra_tablet grant keys", () => {
  it("catalog fixture sanity: grants match the LimitType enum values exactly", () => {
    const screen = ADDONS.find((a) => a.code === "kds_extra_screen");
    const tablet = ADDONS.find((a) => a.code === "extra_tablet");
    expect(screen?.grants).toEqual({ "limit.kdsScreens": 1 });
    expect(tablet?.grants).toEqual({ "limit.tablets": 1 });
    // The literal regression this task fixes: LimitType values must equal
    // the grant key suffix (guard builds `limit.${limitType}`), NOT
    // "maxKdsScreens"/"maxTablets".
    expect(LimitType.KDS_SCREENS).toBe("kdsScreens");
    expect(LimitType.TABLETS).toBe("tablets");
  });

  it("kds_extra_station grants limit.kdsStations but has NO LimitType member (no persisted anchor to count — see report)", () => {
    const station = ADDONS.find((a) => a.code === "kds_extra_station");
    expect(station?.grants).toEqual({ "limit.kdsStations": 1 });
    expect((LimitType as Record<string, string>).KDS_STATIONS).toBeUndefined();
  });
});

describe("DeviceService.enforceDeviceCapacity (production enforcement path)", () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let entitlements: { getForTenant: jest.Mock };
  let svc: DeviceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue("outbox-id") };
    entitlements = { getForTenant: jest.fn() };
    svc = new DeviceService(
      prisma as any,
      outbox as any,
      entitlements as any,
      undefined,
    );
    (prisma.branch.findFirst as any).mockResolvedValue({ id: "b1" });
    (prisma.device.findUnique as any).mockResolvedValue(null); // no pairCode collision
    (prisma.device.create as any).mockImplementation(async ({ data }: any) => ({
      id: "dev-new",
      ...data,
    }));
  });

  function mockEngine(limits: Record<string, number>) {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits,
      integrations: {},
    });
  }

  function mockTenant(opts: {
    overrides?: Record<string, number> | null;
    planName?: string;
  } = {}) {
    (prisma.tenant.findUnique as any).mockResolvedValue({
      limitOverrides: opts.overrides ?? null,
      currentPlan: { displayName: opts.planName ?? "Profesyonel" },
    });
  }

  // RED (pre-fix behaviour, pinned here as the "at limit" case): a tenant
  // whose engine-resolved kdsScreens limit is exactly their current device
  // count must be refused the next one with 403.
  it("kds_screen: blocks creation when the tenant is AT its engine-resolved limit", async () => {
    mockTenant();
    mockEngine({ "limit.kdsScreens": 1 });
    (prisma.device.count as any)
      .mockResolvedValueOnce(0) // pending-slot count (branch-scoped)
      .mockResolvedValueOnce(1); // capacity count (kind-scoped) — 1 existing kds_screen

    const attempt = svc.createSlot("t1", {
      kind: "kds_screen",
      branchId: "b1",
    });
    await expect(attempt).rejects.toThrow(ForbiddenException);
    await expect(attempt).rejects.toThrow(/kdsScreens/);
    expect(prisma.device.create).not.toHaveBeenCalled();

    // The capacity count query is tenant + kind scoped and excludes retired
    // slots (a retired device frees its capacity back).
    const capacityCountCall = (prisma.device.count as any).mock.calls[1][0];
    expect(capacityCountCall.where).toEqual({
      tenantId: "t1",
      kind: "kds_screen",
      status: { not: "retired" },
    });
  });

  // GREEN: buying one more kds_extra_screen unit raises the engine limit —
  // the SAME creation attempt that was 403'd above now succeeds.
  it("kds_screen: an add-on purchase that raises the engine limit lets the next creation through", async () => {
    mockTenant();
    mockEngine({ "limit.kdsScreens": 2 }); // was 1, tenant bought +1 unit
    (prisma.device.count as any)
      .mockResolvedValueOnce(0) // pending
      .mockResolvedValueOnce(1); // 1 existing kds_screen, now under the raised limit of 2

    const out = await svc.createSlot("t1", {
      kind: "kds_screen",
      branchId: "b1",
    });
    expect(out.id).toBe("dev-new");
    expect(prisma.device.create).toHaveBeenCalled();
  });

  it("tablet_waiter: blocks at limit.tablets and passes once the grant raises it", async () => {
    mockTenant();
    mockEngine({ "limit.tablets": 3 });
    (prisma.device.count as any)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3); // at limit

    await expect(
      svc.createSlot("t1", { kind: "tablet_waiter", branchId: "b1" }),
    ).rejects.toThrow(/tablets/);

    mockEngine({ "limit.tablets": 4 }); // add-on unit purchased
    (prisma.device.count as any)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3); // still 3 existing, now under 4

    const out = await svc.createSlot("t1", {
      kind: "tablet_waiter",
      branchId: "b1",
    });
    expect(out.id).toBe("dev-new");
  });

  // The architectural call this task had to make explicit: neither
  // kdsScreens nor tablets has a SubscriptionPlan baseline column, so a
  // tenant who has NEVER bought the add-on has nothing to cap against.
  // Real-DB e2e coverage (test/device-mesh.e2e-spec.ts,
  // test/device-http.e2e-spec.ts) creates a kds_screen slot for a freshly
  // seeded tenant with zero add-ons and asserts success — a "missing ->
  // deny" default here would regress that.
  it("no add-on ever purchased and no admin override: creation is NOT blocked (nothing to cap against yet)", async () => {
    mockTenant();
    mockEngine({}); // engine has never seen a kdsScreens grant for this tenant
    (prisma.device.count as any)
      .mockResolvedValueOnce(0) // pending
      .mockResolvedValueOnce(500); // even a large existing count must not matter

    const out = await svc.createSlot("t1", {
      kind: "kds_screen",
      branchId: "b1",
    });
    expect(out.id).toBe("dev-new");
  });

  it("an admin limitOverride enforces a cap even with zero engine grants", async () => {
    mockTenant({ overrides: { kdsScreens: 0 } });
    mockEngine({}); // no add-on purchased
    (prisma.device.count as any)
      .mockResolvedValueOnce(0) // pending
      .mockResolvedValueOnce(0); // zero existing devices — still blocked, override caps at 0

    await expect(
      svc.createSlot("t1", { kind: "kds_screen", branchId: "b1" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("-1 (unlimited) engine grant never blocks regardless of current count", async () => {
    mockTenant();
    mockEngine({ "limit.kdsScreens": -1 });
    (prisma.device.count as any)
      .mockResolvedValueOnce(0) // pending
      .mockResolvedValueOnce(9999);

    const out = await svc.createSlot("t1", {
      kind: "kds_screen",
      branchId: "b1",
    });
    expect(out.id).toBe("dev-new");
  });

  it("retired devices are excluded from the capacity count (freed slot)", async () => {
    mockTenant();
    mockEngine({ "limit.kdsScreens": 1 });
    // Only 0 non-retired kds_screen devices remain (the 1 they had was
    // retired), so the count query — not this test — is what proves
    // retired rows don't count; we assert the WHERE clause directly.
    (prisma.device.count as any)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await svc.createSlot("t1", { kind: "kds_screen", branchId: "b1" });
    const capacityWhere = (prisma.device.count as any).mock.calls[1][0].where;
    expect(capacityWhere.status).toEqual({ not: "retired" });
  });

  it("skipPendingCap (paid hardware auto-provisioning) bypasses the capacity check entirely, even when at limit", async () => {
    mockTenant();
    mockEngine({ "limit.kdsScreens": 1 });
    // Would be over-limit if the check ran (2 >= 1) — but skipPendingCap
    // means enforceDeviceCapacity is never reached for this trusted,
    // already-paid-for provisioning path (same rationale as the existing
    // MAX_PENDING_SLOTS_PER_BRANCH bypass it shares the flag with).
    (prisma.device.count as any).mockResolvedValue(2);

    const out = await svc.createSlot("t1", {
      kind: "kds_screen",
      branchId: "b1",
      skipPendingCap: true,
    });
    expect(out.id).toBe("dev-new");
    // device.count must not have been called at all — neither the pending
    // check nor the capacity check run under skipPendingCap.
    expect(prisma.device.count).not.toHaveBeenCalled();
  });

  it("an unrelated device kind (receipt_printer) is never gated by kdsScreens/tablets, regardless of their limit state", async () => {
    mockTenant();
    mockEngine({ "limit.kdsScreens": 0, "limit.tablets": 0 }); // both maximally exhausted
    (prisma.device.count as any).mockResolvedValueOnce(0); // pending check only

    const out = await svc.createSlot("t1", {
      kind: "receipt_printer",
      branchId: "b1",
    });
    expect(out.id).toBe("dev-new");
    // Only the pending-slot count ran; enforceDeviceCapacity short-circuited
    // on the CAPACITY_LIMIT_BY_KIND lookup before ever calling entitlements
    // or a second device.count.
    expect(prisma.device.count).toHaveBeenCalledTimes(1);
  });
});

/**
 * Direct unit coverage for PlanFeatureGuard's KDS_SCREENS/TABLETS switch
 * cases — the canonical counting-logic definition (mirrors LimitType.TABLES),
 * exercised the same way plan-feature.guard.spec.ts tests every other branch.
 * Not wired to a live route (see DeviceService docstring for why), but kept
 * consistent and directly testable so a future single-purpose route could
 * use `@CheckLimit(LimitType.KDS_SCREENS)` and get identical behavior to
 * DeviceService's in-service check.
 */
describe("PlanFeatureGuard — KDS_SCREENS / TABLETS", () => {
  function makeReflector(meta: Record<string, unknown>): Reflector {
    return {
      getAllAndOverride: jest.fn((key: string) => meta[key]),
    } as unknown as Reflector;
  }

  function ctxFor(user: unknown): ExecutionContext {
    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  function makePrisma(opts: {
    plan?: Record<string, unknown>;
    limitOverrides?: Record<string, number> | null;
    deviceCount?: number;
  }) {
    return {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          currentPlan: {
            name: "PRO",
            displayName: "Profesyonel",
            ...opts.plan,
          },
          featureOverrides: null,
          limitOverrides: opts.limitOverrides ?? null,
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ status: "ACTIVE" }),
      },
      device: {
        count: jest.fn().mockResolvedValue(opts.deviceCount ?? 0),
      },
    } as unknown as any;
  }

  it("forbids creating a kds_screen when engine-resolved kdsScreens is at the count", async () => {
    const prisma = makePrisma({ deviceCount: 2 });
    const entitlements = {
      getForTenant: jest
        .fn()
        .mockResolvedValue({ features: {}, limits: { "limit.kdsScreens": 2 }, integrations: {} }),
    } as any;
    const guard = new PlanFeatureGuard(
      makeReflector({ checkLimit: LimitType.KDS_SCREENS }),
      prisma,
      entitlements,
    );
    await expect(
      guard.canActivate(ctxFor({ tenantId: "t1" })),
    ).rejects.toThrow(/reached the limit for kdsScreens/);
    expect(prisma.device.count).toHaveBeenCalledWith({
      where: { tenantId: "t1", kind: "kds_screen", status: { not: "retired" } },
    });
  });

  it("allows creating a tablet_waiter once the engine limit rises above the count", async () => {
    const prisma = makePrisma({ deviceCount: 3 });
    const entitlements = {
      getForTenant: jest
        .fn()
        .mockResolvedValue({ features: {}, limits: { "limit.tablets": 4 }, integrations: {} }),
    } as any;
    const guard = new PlanFeatureGuard(
      makeReflector({ checkLimit: LimitType.TABLETS }),
      prisma,
      entitlements,
    );
    await expect(
      guard.canActivate(ctxFor({ tenantId: "t1" })),
    ).resolves.toBe(true);
    expect(prisma.device.count).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        kind: "tablet_waiter",
        status: { not: "retired" },
      },
    });
  });

  it("no engine grant and no override for kdsScreens: allows without counting (nothing to cap against)", async () => {
    const prisma = makePrisma({ deviceCount: 999 });
    const entitlements = {
      getForTenant: jest
        .fn()
        .mockResolvedValue({ features: {}, limits: {}, integrations: {} }),
    } as any;
    const guard = new PlanFeatureGuard(
      makeReflector({ checkLimit: LimitType.KDS_SCREENS }),
      prisma,
      entitlements,
    );
    await expect(
      guard.canActivate(ctxFor({ tenantId: "t1" })),
    ).resolves.toBe(true);
    expect(prisma.device.count).not.toHaveBeenCalled();
  });

  it("an admin limitOverride enforces TABLETS even with zero engine grants", async () => {
    const prisma = makePrisma({ deviceCount: 1, limitOverrides: { tablets: 1 } });
    const entitlements = {
      getForTenant: jest
        .fn()
        .mockResolvedValue({ features: {}, limits: {}, integrations: {} }),
    } as any;
    const guard = new PlanFeatureGuard(
      makeReflector({ checkLimit: LimitType.TABLETS }),
      prisma,
      entitlements,
    );
    await expect(
      guard.canActivate(ctxFor({ tenantId: "t1" })),
    ).rejects.toThrow(/reached the limit for tablets/);
  });
});
