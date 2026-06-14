import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "../services/subscription.service";
import { BillingService } from "../services/billing.service";
import { UsageService } from "../services/usage.service";

/**
 * Long-tail forwarding spec for the thin subscription controller. The
 * load-bearing contracts: every :id endpoint threads req.user.tenantId into
 * the service (cross-tenant IDOR fix), pagination query strings are parsed
 * to integers (undefined when absent), and cancel coalesces immediate→false.
 */
describe("SubscriptionController", () => {
  let sub: Record<string, jest.Mock>;
  let billing: Record<string, jest.Mock>;
  let usage: Record<string, jest.Mock>;
  let ctrl: SubscriptionController;
  const req = { user: { tenantId: "t1", id: "u1" } };

  beforeEach(() => {
    sub = {
      getAvailablePlans: jest.fn().mockResolvedValue([]),
      getEffectiveFeatures: jest.fn().mockResolvedValue({}),
      getCurrentSubscription: jest.fn().mockResolvedValue({}),
      getSubscriptionById: jest.fn().mockResolvedValue({}),
      createSubscription: jest.fn().mockResolvedValue({}),
      updateSubscription: jest.fn().mockResolvedValue({}),
      changePlan: jest.fn().mockResolvedValue({}),
      cancelSubscription: jest.fn().mockResolvedValue({}),
      reactivateSubscription: jest.fn().mockResolvedValue({}),
      getScheduledDowngrade: jest.fn().mockResolvedValue({}),
      cancelScheduledDowngrade: jest.fn().mockResolvedValue({}),
    };
    billing = {
      getTenantInvoices: jest.fn().mockResolvedValue([]),
      getSubscriptionInvoices: jest.fn().mockResolvedValue([]),
    };
    usage = { getSnapshot: jest.fn().mockResolvedValue({}) };
    ctrl = new SubscriptionController(
      sub as unknown as SubscriptionService,
      billing as unknown as BillingService,
      usage as unknown as UsageService,
    );
  });

  it("getPlans forwards to the public plan catalogue (no tenant)", async () => {
    await ctrl.getPlans();
    expect(sub.getAvailablePlans).toHaveBeenCalledTimes(1);
  });

  it("getSubscription threads tenantId for IDOR scoping", async () => {
    await ctrl.getSubscription("s1", req);
    expect(sub.getSubscriptionById).toHaveBeenCalledWith("s1", "t1");
  });

  it("createSubscription passes tenantId, dto and acting user id", async () => {
    const dto = { planId: "pro" } as any;
    await ctrl.createSubscription(req, dto);
    expect(sub.createSubscription).toHaveBeenCalledWith("t1", dto, "u1");
  });

  it("changePlan threads id, tenantId, dto and user id", async () => {
    const dto = { newPlanId: "biz" } as any;
    await ctrl.changePlan("s1", dto, req);
    expect(sub.changePlan).toHaveBeenCalledWith("s1", "t1", dto, "u1");
  });

  it("cancelSubscription coalesces immediate to false when absent", async () => {
    await ctrl.cancelSubscription("s1", {} as any, req);
    expect(sub.cancelSubscription).toHaveBeenCalledWith(
      "s1",
      "t1",
      false,
      undefined,
      "u1",
    );
  });

  it("cancelSubscription forwards an explicit immediate=true + reason", async () => {
    await ctrl.cancelSubscription(
      "s1",
      { immediate: true, reason: "churn" } as any,
      req,
    );
    expect(sub.cancelSubscription).toHaveBeenCalledWith(
      "s1",
      "t1",
      true,
      "churn",
      "u1",
    );
  });

  it("getTenantInvoices parses page/pageSize query strings to ints", async () => {
    await ctrl.getTenantInvoices(req, "2", "50");
    expect(billing.getTenantInvoices).toHaveBeenCalledWith("t1", 2, 50);
  });

  it("getInvoices passes undefined paging when query params are absent", async () => {
    await ctrl.getInvoices("s1", req);
    expect(billing.getSubscriptionInvoices).toHaveBeenCalledWith(
      "s1",
      "t1",
      undefined,
      undefined,
    );
  });

  it("getUsageSnapshot reads the tenant usage snapshot", async () => {
    await ctrl.getUsageSnapshot(req);
    expect(usage.getSnapshot).toHaveBeenCalledWith("t1");
  });
});
