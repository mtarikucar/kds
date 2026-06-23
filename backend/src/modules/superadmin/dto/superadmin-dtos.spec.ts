import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RefundSubscriptionPaymentDto } from "./refund-subscription-payment.dto";
import { UserFilterDto } from "./user-filter.dto";
import { SubscriptionFilterDto } from "./subscription-filter.dto";
import { UpdateTenantOverridesDto } from "./update-tenant-overrides.dto";

/**
 * Long-tail validation spec for the superadmin write/filter DTOs. Load-
 * bearing rules: refund needs a UUID paymentId + a positive amount + a
 * 3-500 char reason (audit trail); filter pagination is clamped; the
 * subscription filter status is a closed set; tenant-override numbers are
 * non-negative and string-booleans coerce.
 */
function flattenErrors(es: import("class-validator").ValidationError[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...flattenErrors(e.children ?? []),
  ]);
}
async function errs(dto: object): Promise<string[]> {
  return flattenErrors(await validate(dto));
}

const UUID = "0c4612e8-18e6-4f16-9edd-844f9369edc7";

describe("RefundSubscriptionPaymentDto", () => {
  it("accepts a full refund (no amount) with a reason", async () => {
    const dto = plainToInstance(RefundSubscriptionPaymentDto, {
      paymentId: UUID,
      reason: "duplicate charge",
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a non-UUID paymentId", async () => {
    const dto = plainToInstance(RefundSubscriptionPaymentDto, {
      paymentId: "pay-1",
      reason: "oops",
    });
    expect((await errs(dto)).some((m) => /paymentId/.test(m))).toBe(true);
  });

  it("rejects a non-positive partial amount", async () => {
    const dto = plainToInstance(RefundSubscriptionPaymentDto, {
      paymentId: UUID,
      amount: -5,
      reason: "partial",
    });
    expect((await errs(dto)).some((m) => /amount/.test(m))).toBe(true);
  });

  it("rejects a too-short reason", async () => {
    const dto = plainToInstance(RefundSubscriptionPaymentDto, {
      paymentId: UUID,
      reason: "x",
    });
    expect((await errs(dto)).some((m) => /reason/.test(m))).toBe(true);
  });
});

describe("UserFilterDto", () => {
  it("coerces page/limit and clamps the limit to 100", async () => {
    const dto = plainToInstance(UserFilterDto, { page: "2", limit: "200" });
    expect((await errs(dto)).some((m) => /limit/.test(m))).toBe(true);
    const ok = plainToInstance(UserFilterDto, { page: "2", limit: "50" });
    expect(await errs(ok)).toEqual([]);
    expect(ok.limit).toBe(50);
  });
});

describe("SubscriptionFilterDto", () => {
  it("rejects a status outside the closed set", async () => {
    const dto = plainToInstance(SubscriptionFilterDto, { status: "FROZEN" });
    expect((await errs(dto)).some((m) => /status/.test(m))).toBe(true);
  });

  it("rejects a non-UUID tenantId filter", async () => {
    const dto = plainToInstance(SubscriptionFilterDto, { tenantId: "t1" });
    expect((await errs(dto)).some((m) => /tenantId/.test(m))).toBe(true);
  });
});

describe("UpdateTenantOverridesDto", () => {
  it("coerces nested string-boolean feature flags", async () => {
    const dto = plainToInstance(UpdateTenantOverridesDto, {
      featureOverrides: { advancedReports: "true", apiAccess: "false" },
    });
    expect(await errs(dto)).toEqual([]);
    expect(dto.featureOverrides!.advancedReports).toBe(true);
    expect(dto.featureOverrides!.apiAccess).toBe(false);
  });

  // -1 is the unlimited sentinel and a VALID override: a limit override
  // REPLACES the plan value in the engine, so without -1 an override could
  // never grant unlimited (and a 0 override could not be undone to unlimited).
  it("accepts a -1 (unlimited) limit override", async () => {
    const dto = plainToInstance(UpdateTenantOverridesDto, {
      limitOverrides: { maxUsers: -1, maxBranches: -1 },
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a limit override below -1", async () => {
    const dto = plainToInstance(UpdateTenantOverridesDto, {
      limitOverrides: { maxUsers: -2 },
    });
    expect((await errs(dto)).some((m) => /maxUsers/.test(m))).toBe(true);
  });
});
