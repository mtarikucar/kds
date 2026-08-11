import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateAddOnDto, UpdateAddOnDto } from "./addon.dto";

/**
 * Long-tail validation spec for the marketplace add-on DTOs. Load-bearing
 * rules: `code` is an immutable URL/dependency-safe handle (lowercase,
 * digits, underscores only); kind/billing/status are closed sets; price is
 * a non-negative integer (minor units, no float drift).
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateAddOnDto", () => {
  // v3.3.0 vocabulary. `kds_extra_screen`/`limit.kdsScreens` was the old
  // fixture and is deliberately gone: that product is archived and the key it
  // granted was never read by anything.
  const base = {
    code: "extra_branch",
    name: "Extra Branch",
    kind: "capacity",
    billing: "annual",
    priceCents: 399_000,
    grants: { "limit.maxBranches": 1 },
  };

  it("accepts a valid add-on", async () => {
    expect(await errs(plainToInstance(CreateAddOnDto, base))).toEqual([]);
  });

  it("rejects a code with uppercase/dashes (URL/dep safety)", async () => {
    const dto = plainToInstance(CreateAddOnDto, { ...base, code: "KDS-Screen" });
    const msgs = await errs(dto);
    expect(
      msgs.some((m) => /lowercase letters, digits, underscores only/.test(m)),
    ).toBe(true);
  });

  it("rejects an unknown kind", async () => {
    const dto = plainToInstance(CreateAddOnDto, { ...base, kind: "hardware" });
    expect((await errs(dto)).some((m) => /kind/.test(m))).toBe(true);
  });

  it("rejects the retired pre-3.3 kind and billing vocabulary", async () => {
    const kind = plainToInstance(CreateAddOnDto, { ...base, kind: "software" });
    expect((await errs(kind)).some((m) => /kind/.test(m))).toBe(true);
    const billing = plainToInstance(CreateAddOnDto, {
      ...base,
      billing: "recurring",
    });
    expect((await errs(billing)).some((m) => /billing/.test(m))).toBe(true);
  });

  it("accepts the a-la-carte credit-pack fields", async () => {
    const dto = plainToInstance(CreateAddOnDto, {
      ...base,
      code: "credit_ai_photo_100",
      kind: "credit",
      billing: "oneTime",
      grants: {},
      requiresLicense: false,
      creditKind: "PHOTO",
      creditUnits: 100,
      sortOrder: 40,
      i18n: { tr: { name: "100 AI Gorsel", description: "aciklama" } },
      commissionRate: 0.1,
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects an unknown creditKind and an out-of-range commissionRate", async () => {
    const dto = plainToInstance(CreateAddOnDto, {
      ...base,
      creditKind: "BOGUS",
      commissionRate: 1.5,
    });
    const msgs = await errs(dto);
    expect(msgs.some((m) => /creditKind/.test(m))).toBe(true);
    expect(msgs.some((m) => /commissionRate/.test(m))).toBe(true);
  });

  it("rejects a negative price", async () => {
    const dto = plainToInstance(CreateAddOnDto, { ...base, priceCents: -1 });
    expect((await errs(dto)).some((m) => /priceCents/.test(m))).toBe(true);
  });

  it("rejects a non-integer price (minor-units invariant)", async () => {
    const dto = plainToInstance(CreateAddOnDto, { ...base, priceCents: 49.5 });
    expect((await errs(dto)).some((m) => /priceCents/.test(m))).toBe(true);
  });

  it("rejects non-string entries in deps", async () => {
    const dto = plainToInstance(CreateAddOnDto, {
      ...base,
      deps: ["module_ai_studio", 5],
    });
    expect((await errs(dto)).some((m) => /deps|each/.test(m))).toBe(true);
  });
});

describe("UpdateAddOnDto", () => {
  it("accepts a partial patch (no code field)", async () => {
    expect(
      await errs(plainToInstance(UpdateAddOnDto, { name: "Renamed" })),
    ).toEqual([]);
  });

  it("rejects an out-of-set status", async () => {
    const dto = plainToInstance(UpdateAddOnDto, { status: "live" });
    expect((await errs(dto)).some((m) => /status/.test(m))).toBe(true);
  });
});
