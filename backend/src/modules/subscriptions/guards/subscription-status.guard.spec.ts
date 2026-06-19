import { ForbiddenException } from "@nestjs/common";
import { SubscriptionStatusGuard } from "./subscription-status.guard";

/**
 * Onboarding-trial lock: a tenant with no live subscription (TRIAL_ENDED /
 * EXPIRED) is 403'd on non-allowlisted routes; the allowlist (auth, plans,
 * payments, profile, legal) lets them recover.
 */
describe("SubscriptionStatusGuard", () => {
  let prisma: { subscription: { findFirst: jest.Mock } };
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: SubscriptionStatusGuard;

  beforeEach(() => {
    prisma = { subscription: { findFirst: jest.fn() } };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new SubscriptionStatusGuard(reflector as any, prisma as any);
  });

  function ctx(path: string, user: any) {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ path, user }) }),
    } as any;
  }

  it("allows @Public routes without touching the DB", async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(ctx("/api/orders", { tenantId: "t1" }))).resolves.toBe(true);
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it("allows requests with no tenant principal (superadmin / unauthenticated)", async () => {
    await expect(guard.canActivate(ctx("/api/orders", undefined))).resolves.toBe(true);
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it("allows allowlisted recovery routes even when locked (no DB query)", async () => {
    for (const p of [
      "/api/subscriptions/plans",
      "/api/subscriptions/current",
      "/api/payments/create-intent",
      "/api/checkout/intent",
      "/api/legal/documents",
      "/api/users/me",
      "/api/auth/refresh",
    ]) {
      await expect(guard.canActivate(ctx(p, { tenantId: "t1" }))).resolves.toBe(true);
    }
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it("allows a gated route when the tenant has a live subscription", async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: "sub-1" });
    await expect(guard.canActivate(ctx("/api/orders", { tenantId: "t1" }))).resolves.toBe(true);
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
        }),
      }),
    );
  });

  it("LOCKS a gated route when the tenant has no live subscription (TRIAL_ENDED)", async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(
      guard.canActivate(ctx("/api/orders", { tenantId: "t1" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(ctx("/api/orders", { tenantId: "t1" }));
    } catch (e: any) {
      expect(e.getResponse().errorCode).toBe("PLAN_SELECTION_REQUIRED");
    }
  });

  it("is segment-aware: '/api/menu' does NOT match the '/me' allowlist (locked → blocked)", async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(
      guard.canActivate(ctx("/api/menu/categories", { tenantId: "t1" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
