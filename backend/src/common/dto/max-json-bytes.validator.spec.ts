import { validate } from "class-validator";
import { MaxJsonBytes } from "./max-json-bytes.validator";

class Holder {
  @MaxJsonBytes(64)
  payload?: unknown;
}

/**
 * Long-tail spec for the MaxJsonBytes custom validator. Load-bearing
 * contracts: nullish is allowed (optional field), a small object passes,
 * an object whose serialized byte size exceeds the cap fails, and a
 * non-serializable (circular) value is rejected rather than throwing.
 */
describe("MaxJsonBytes validator", () => {
  async function errs(value: unknown): Promise<string[]> {
    const h = new Holder();
    h.payload = value;
    const results = await validate(h);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it("allows undefined/null (optional free-form field)", async () => {
    expect(await errs(undefined)).toEqual([]);
    expect(await errs(null)).toEqual([]);
  });

  it("accepts a small object under the byte cap", async () => {
    expect(await errs({ a: 1 })).toEqual([]);
  });

  it("rejects an object whose JSON exceeds the cap", async () => {
    const big = { blob: "x".repeat(200) };
    const msgs = await errs(big);
    expect(msgs.some((m) => /maximum allowed size/.test(m))).toBe(true);
  });

  it("rejects a circular (non-serializable) value", async () => {
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    const msgs = await errs(circ);
    expect(msgs.length).toBeGreaterThan(0);
  });
});
