import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateSubscriptionDto } from "./create-subscription.dto";
import { CancelSubscriptionDto } from "./cancel-subscription.dto";
import { ChangePlanDto } from "./change-plan.dto";
import { UpdateSubscriptionDto } from "./update-subscription.dto";
import { BillingCycle } from "../../../common/constants/subscription.enum";

/**
 * Long-tail validation spec for the subscription write DTOs. The
 * load-bearing rules: planId/newPlanId required strings; billingCycle is
 * a closed enum (junk rejected); the cancellation reason is capped at 500
 * chars (it lands in a DB column — uncapped it could persist a 100KB blob);
 * boolean flags only accept booleans.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("subscription write DTOs", () => {
  describe("CreateSubscriptionDto", () => {
    it("accepts a valid planId + billingCycle", async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        planId: "pro",
        billingCycle: BillingCycle.MONTHLY,
      });
      expect(await errs(dto)).toEqual([]);
    });

    it("rejects an empty planId", async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        planId: "",
        billingCycle: BillingCycle.MONTHLY,
      });
      expect((await errs(dto)).length).toBeGreaterThan(0);
    });

    it("rejects a billingCycle outside the enum", async () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        planId: "pro",
        billingCycle: "FORTNIGHTLY",
      });
      expect((await errs(dto)).some((m) => /billingCycle/.test(m))).toBe(true);
    });
  });

  describe("CancelSubscriptionDto", () => {
    it("accepts an empty body (all fields optional)", async () => {
      expect(await errs(plainToInstance(CancelSubscriptionDto, {}))).toEqual([]);
    });

    it("caps the reason at 500 chars (DB-column protection)", async () => {
      const dto = plainToInstance(CancelSubscriptionDto, {
        reason: "x".repeat(501),
      });
      expect((await errs(dto)).some((m) => /reason/.test(m))).toBe(true);
    });

    it("rejects a non-boolean immediate flag", async () => {
      const dto = plainToInstance(CancelSubscriptionDto, {
        immediate: "yes",
      });
      expect((await errs(dto)).some((m) => /immediate/.test(m))).toBe(true);
    });
  });

  describe("ChangePlanDto", () => {
    it("accepts just a newPlanId (cycle/payment optional)", async () => {
      const dto = plainToInstance(ChangePlanDto, { newPlanId: "business" });
      expect(await errs(dto)).toEqual([]);
    });

    it("rejects a missing newPlanId", async () => {
      const dto = plainToInstance(ChangePlanDto, {});
      expect((await errs(dto)).some((m) => /newPlanId/.test(m))).toBe(true);
    });

    it("rejects an out-of-enum billingCycle when provided", async () => {
      const dto = plainToInstance(ChangePlanDto, {
        newPlanId: "x",
        billingCycle: "WEEKLY",
      });
      expect((await errs(dto)).some((m) => /billingCycle/.test(m))).toBe(true);
    });
  });

  describe("UpdateSubscriptionDto", () => {
    it("accepts an empty body and a valid boolean flag", async () => {
      expect(await errs(plainToInstance(UpdateSubscriptionDto, {}))).toEqual([]);
      expect(
        await errs(
          plainToInstance(UpdateSubscriptionDto, { cancelAtPeriodEnd: true }),
        ),
      ).toEqual([]);
    });

    it("rejects a non-boolean cancelAtPeriodEnd", async () => {
      const dto = plainToInstance(UpdateSubscriptionDto, {
        cancelAtPeriodEnd: "true",
      });
      expect((await errs(dto)).length).toBeGreaterThan(0);
    });
  });
});
