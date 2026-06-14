import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateCashDrawerMovementDto } from "./create-cash-drawer-movement.dto";
import { RejectCashDrawerMovementDto } from "./reject-cash-drawer-movement.dto";

/**
 * Long-tail validation spec for the cash-drawer movement DTOs. Money
 * fields are load-bearing: type is a closed set, amount is positive with
 * at most 2 decimals and a sane upper bound, free-text is capped to protect
 * the audit log column, and a rejection requires a 5–500 char reason.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateCashDrawerMovementDto", () => {
  const base = { type: "CASH_IN", amount: 250 };

  it("accepts a valid movement", async () => {
    expect(await errs(plainToInstance(CreateCashDrawerMovementDto, base))).toEqual(
      [],
    );
  });

  it("rejects an unknown movement type", async () => {
    const dto = plainToInstance(CreateCashDrawerMovementDto, {
      ...base,
      type: "WITHDRAW",
    });
    expect((await errs(dto)).some((m) => /type/.test(m))).toBe(true);
  });

  it("rejects a non-positive amount", async () => {
    const dto = plainToInstance(CreateCashDrawerMovementDto, {
      ...base,
      amount: 0,
    });
    expect((await errs(dto)).some((m) => /amount/.test(m))).toBe(true);
  });

  it("rejects amounts with more than 2 decimal places", async () => {
    const dto = plainToInstance(CreateCashDrawerMovementDto, {
      ...base,
      amount: 1.234,
    });
    expect((await errs(dto)).some((m) => /amount/.test(m))).toBe(true);
  });

  it("rejects an absurdly large amount (overflow guard)", async () => {
    const dto = plainToInstance(CreateCashDrawerMovementDto, {
      ...base,
      amount: 10_000_001,
    });
    expect((await errs(dto)).some((m) => /amount/.test(m))).toBe(true);
  });

  it("caps the audit notes at 2000 chars", async () => {
    const dto = plainToInstance(CreateCashDrawerMovementDto, {
      ...base,
      notes: "x".repeat(2001),
    });
    expect((await errs(dto)).some((m) => /notes/.test(m))).toBe(true);
  });

  it("rejects a non-UUID zReportId", async () => {
    const dto = plainToInstance(CreateCashDrawerMovementDto, {
      ...base,
      zReportId: "not-a-uuid",
    });
    expect((await errs(dto)).some((m) => /zReportId/.test(m))).toBe(true);
  });
});

describe("RejectCashDrawerMovementDto", () => {
  it("accepts a 5–500 char reason", async () => {
    const dto = plainToInstance(RejectCashDrawerMovementDto, {
      reason: "Wrong amount entered",
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a too-short reason", async () => {
    const dto = plainToInstance(RejectCashDrawerMovementDto, { reason: "no" });
    expect((await errs(dto)).some((m) => /reason/.test(m))).toBe(true);
  });

  it("rejects an empty reason", async () => {
    const dto = plainToInstance(RejectCashDrawerMovementDto, { reason: "" });
    expect((await errs(dto)).length).toBeGreaterThan(0);
  });
});
