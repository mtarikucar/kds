import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateDeviceSlotDto,
  PairDeviceDto,
  HeartbeatDto,
  EnqueueCommandDto,
  AckCommandDto,
} from "./device.dto";

/**
 * Long-tail validation spec for the device-mesh DTOs. Load-bearing rules:
 * device kind is a closed set; pair code is exactly 6 uppercase
 * alphanumerics; command kind is a lowercase dot identifier; capabilities
 * array + per-element length are capped (JSONB bloat guard); battery is a
 * 0-100 percentage; ack error text is capped.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateDeviceSlotDto", () => {
  it("accepts a valid slot", async () => {
    const dto = plainToInstance(CreateDeviceSlotDto, {
      kind: "kds_screen",
      capabilities: ["print", "scan"],
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects an unknown device kind", async () => {
    const dto = plainToInstance(CreateDeviceSlotDto, { kind: "smart_fridge" });
    expect((await errs(dto)).some((m) => /kind/.test(m))).toBe(true);
  });

  it("rejects a capabilities array over the 32-element cap", async () => {
    const dto = plainToInstance(CreateDeviceSlotDto, {
      kind: "kds_screen",
      capabilities: Array.from({ length: 33 }, (_, i) => `c${i}`),
    });
    expect((await errs(dto)).some((m) => /capabilities/.test(m))).toBe(true);
  });
});

describe("PairDeviceDto", () => {
  it("accepts a 6-char uppercase code", async () => {
    expect(
      await errs(plainToInstance(PairDeviceDto, { pairCode: "A4F9K2" })),
    ).toEqual([]);
  });

  it("rejects a lowercase or wrong-length code", async () => {
    expect(
      (await errs(plainToInstance(PairDeviceDto, { pairCode: "a4f9k2" }))).length,
    ).toBeGreaterThan(0);
    expect(
      (await errs(plainToInstance(PairDeviceDto, { pairCode: "ABC" }))).length,
    ).toBeGreaterThan(0);
  });
});

describe("HeartbeatDto", () => {
  it("rejects a battery percentage above 100", async () => {
    const dto = plainToInstance(HeartbeatDto, { batteryPct: 150 });
    expect((await errs(dto)).some((m) => /batteryPct/.test(m))).toBe(true);
  });
});

describe("EnqueueCommandDto", () => {
  it("accepts a canonical CommandKind with an object payload", async () => {
    const dto = plainToInstance(EnqueueCommandDto, {
      kind: "print_receipt",
      payload: { orderId: "o1" },
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a non-canonical (dot-form) kind that would bypass the double-charge guard", async () => {
    // `charge.card` / `print.receipt` pass the old free-form regex but do
    // NOT match the canonical underscore-form CommandKind the no-auto-requeue
    // guard keys on — enqueuing under such an alias would bypass the guard
    // and risk a double charge. Must be rejected at the DTO boundary.
    for (const kind of ["charge.card", "print.receipt", "open.drawer"]) {
      const dto = plainToInstance(EnqueueCommandDto, { kind, payload: {} });
      expect((await errs(dto)).some((m) => /kind/.test(m))).toBe(true);
    }
  });

  it("rejects an uppercase/invalid kind", async () => {
    const dto = plainToInstance(EnqueueCommandDto, {
      kind: "Print Receipt",
      payload: {},
    });
    expect((await errs(dto)).some((m) => /kind/.test(m))).toBe(true);
  });

  it("rejects a non-object payload (bridge dispatcher crash guard)", async () => {
    const dto = plainToInstance(EnqueueCommandDto, {
      kind: "print_receipt",
      payload: "not-an-object",
    });
    expect((await errs(dto)).some((m) => /payload/.test(m))).toBe(true);
  });
});

describe("AckCommandDto", () => {
  it("rejects a status outside done/failed", async () => {
    const dto = plainToInstance(AckCommandDto, { status: "pending" });
    expect((await errs(dto)).some((m) => /status/.test(m))).toBe(true);
  });

  it("caps the error text at 1000 chars", async () => {
    const dto = plainToInstance(AckCommandDto, {
      status: "failed",
      error: "x".repeat(1001),
    });
    expect((await errs(dto)).some((m) => /error/.test(m))).toBe(true);
  });
});
