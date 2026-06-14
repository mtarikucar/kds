import { SuperAdminSubscriptionsController } from "./superadmin-subscriptions.controller";
import { SuperAdminSubscriptionsService } from "../services/superadmin-subscriptions.service";

/**
 * Long-tail forwarding spec for the superadmin subscriptions controller.
 * Load-bearing: every plan/subscription mutation threads the acting super-
 * admin id + email (audit attribution); the manual cron triggers route to
 * their service methods; cancel destructures mode + reason from the dto.
 */
describe("SuperAdminSubscriptionsController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: SuperAdminSubscriptionsController;
  const actorId = "sa-1";
  const actorEmail = "root@x.com";

  beforeEach(() => {
    svc = {
      findAllPlans: jest.fn().mockResolvedValue([]),
      createPlan: jest.fn().mockResolvedValue({}),
      updatePlan: jest.fn().mockResolvedValue({}),
      deletePlan: jest.fn().mockResolvedValue({}),
      triggerExpireTrials: jest.fn().mockResolvedValue({}),
      triggerPeriodEndSweep: jest.fn().mockResolvedValue({}),
      triggerExpiryReminders: jest.fn().mockResolvedValue({}),
      findAllSubscriptions: jest.fn().mockResolvedValue([]),
      findOneSubscription: jest.fn().mockResolvedValue({}),
      updateSubscription: jest.fn().mockResolvedValue({}),
      extendSubscription: jest.fn().mockResolvedValue({}),
      cancelSubscription: jest.fn().mockResolvedValue({}),
      refundPayment: jest.fn().mockResolvedValue({}),
    };
    ctrl = new SuperAdminSubscriptionsController(
      svc as unknown as SuperAdminSubscriptionsService,
    );
  });

  it("createPlan threads dto + actor identity", async () => {
    const dto = { name: "PRO" } as any;
    await ctrl.createPlan(dto, actorId, actorEmail);
    expect(svc.createPlan).toHaveBeenCalledWith(dto, actorId, actorEmail);
  });

  it("manual trigger endpoints route to their cron-equivalent service methods", async () => {
    await ctrl.expireTrials();
    await ctrl.sweepPeriodEnd();
    await ctrl.sendExpiryReminders();
    expect(svc.triggerExpireTrials).toHaveBeenCalled();
    expect(svc.triggerPeriodEndSweep).toHaveBeenCalled();
    expect(svc.triggerExpiryReminders).toHaveBeenCalled();
  });

  it("extendSubscription threads dto + actor identity", async () => {
    const dto = { days: 7 } as any;
    await ctrl.extendSubscription("s1", dto, actorId, actorEmail);
    expect(svc.extendSubscription).toHaveBeenCalledWith(
      "s1",
      dto,
      actorId,
      actorEmail,
    );
  });

  it("cancelSubscription destructures mode + reason from the dto", async () => {
    const dto = { mode: "IMMEDIATE", reason: "fraud" } as any;
    await ctrl.cancelSubscription("s1", dto, actorId, actorEmail);
    expect(svc.cancelSubscription).toHaveBeenCalledWith(
      "s1",
      actorId,
      actorEmail,
      "IMMEDIATE",
      "fraud",
    );
  });

  it("refundPayment threads subscriptionId + dto + actor identity", async () => {
    const dto = { paymentId: "p1", reason: "dup" } as any;
    await ctrl.refundPayment("s1", dto, actorId, actorEmail);
    expect(svc.refundPayment).toHaveBeenCalledWith(
      "s1",
      dto,
      actorId,
      actorEmail,
    );
  });
});
