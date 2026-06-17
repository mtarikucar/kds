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
  const base = {
    code: "kds_extra_screen",
    name: "Extra KDS Screen",
    kind: "capacity",
    billing: "recurring",
    priceCents: 4900,
    grants: { "limit.kdsScreens": 1 },
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
      deps: ["plan:PRO", 5],
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
