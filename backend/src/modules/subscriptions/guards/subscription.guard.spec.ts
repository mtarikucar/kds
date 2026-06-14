import { ForbiddenException, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SubscriptionGuard } from "./subscription.guard";
import { SubscriptionService } from "../services/subscription.service";

/**
 * Long-tail spec for SubscriptionGuard. Decision table:
 *  - @Public route → allow (no service hit)
 *  - route NOT marked @RequiresActiveSubscription → allow
 *  - marked but no authed tenant → Forbidden
 *  - marked + active subscription → allow
 *  - marked + inactive subscription → Forbidden
 */
describe("SubscriptionGuard", () => {
  function setup(opts: {
    isPublic?: boolean;
    requiresSub?: boolean;
    user?: unknown;
    active?: boolean;
  }) {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === "isPublic" ? !!opts.isPublic : !!opts.requiresSub,
      ),
    } as unknown as Reflector;
    const subscriptionService = {
      isSubscriptionActive: jest.fn().mockResolvedValue(!!opts.active),
    } as unknown as SubscriptionService;
    const guard = new SubscriptionGuard(reflector, subscriptionService);
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user: opts.user }) }),
    } as unknown as ExecutionContext;
    return { guard, ctx, subscriptionService };
  }

  it("allows a @Public route without touching the service", async () => {
    const { guard, ctx, subscriptionService } = setup({ isPublic: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(subscriptionService.isSubscriptionActive).not.toHaveBeenCalled();
  });

  it("allows a route that does not require an active subscription", async () => {
    const { guard, ctx } = setup({ requiresSub: false });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("forbids when the subscription gate is on but there is no tenant", async () => {
    const { guard, ctx } = setup({ requiresSub: true, user: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("allows when an active subscription is found", async () => {
    const { guard, ctx } = setup({
      requiresSub: true,
      user: { tenantId: "t1" },
      active: true,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("forbids when the subscription is inactive/expired", async () => {
    const { guard, ctx } = setup({
      requiresSub: true,
      user: { tenantId: "t1" },
      active: false,
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(/expired|inactive/i);
  });
});
