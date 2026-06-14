import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CancelReceiptDto } from "./cancel-receipt.dto";

/**
 * Long-tail validation spec for CancelReceiptDto. The reason lands in a
 * TR-law audit row, so the cap is load-bearing: non-empty, max 500 chars,
 * string only.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CancelReceiptDto", () => {
  it("accepts a normal ops note", async () => {
    expect(
      await errs(plainToInstance(CancelReceiptDto, { reason: "Wrong order" })),
    ).toEqual([]);
  });

  it("rejects an empty reason", async () => {
    expect(
      (await errs(plainToInstance(CancelReceiptDto, { reason: "" }))).length,
    ).toBeGreaterThan(0);
  });

  it("rejects a reason over 500 chars (audit-row cap)", async () => {
    const dto = plainToInstance(CancelReceiptDto, { reason: "x".repeat(501) });
    expect((await errs(dto)).some((m) => /reason/.test(m))).toBe(true);
  });

  it("rejects a non-string reason", async () => {
    const dto = plainToInstance(CancelReceiptDto, { reason: 123 as unknown });
    expect((await errs(dto)).length).toBeGreaterThan(0);
  });
});
