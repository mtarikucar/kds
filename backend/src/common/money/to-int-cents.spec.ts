import { Prisma } from "@prisma/client";
import { toIntCents } from "./to-int-cents";

/**
 * Pins the rounding contract of the shared money→int-cents helper that
 * was lifted VERBATIM from OrdersService/KdsService. The order-outbox emit
 * paths (orders / kds / customer-orders) all feed it a Prisma.Decimal
 * `finalAmount`, so the Decimal branch is the production-critical one; the
 * number/string branches are pinned to guard the test-fixture callers.
 */
describe("toIntCents", () => {
  it("returns undefined for null / undefined", () => {
    expect(toIntCents(null)).toBeUndefined();
    expect(toIntCents(undefined)).toBeUndefined();
  });

  describe("Prisma.Decimal (production path — DB finalAmount column)", () => {
    it("converts a 2-dp Decimal to integer cents via the string path", () => {
      expect(toIntCents(new Prisma.Decimal("123.45"))).toBe(12345);
    });

    it("renders trailing zeros as cents (no float drift)", () => {
      expect(toIntCents(new Prisma.Decimal("100.00"))).toBe(10000);
      expect(toIntCents(new Prisma.Decimal("100.5"))).toBe(10050);
    });

    it("preserves precision on large amounts past the IEEE-754 danger zone", () => {
      // *100 → Math.round on a JS number would drift here; the toFixed(2)
      // string path does not cross the float boundary.
      expect(toIntCents(new Prisma.Decimal("999999.99"))).toBe(99999999);
    });

    it("rounds half-up at the 2dp boundary (Decimal.toFixed semantics)", () => {
      expect(toIntCents(new Prisma.Decimal("1.005"))).toBe(101);
    });

    it("handles zero", () => {
      expect(toIntCents(new Prisma.Decimal("0"))).toBe(0);
    });
  });

  describe("number (test-fixture callers)", () => {
    it("rounds number*100", () => {
      expect(toIntCents(123.45)).toBe(12345);
      expect(toIntCents(0)).toBe(0);
    });
  });

  describe("string", () => {
    it("parses then rounds", () => {
      expect(toIntCents("123.45")).toBe(12345);
    });

    it("returns undefined for a non-numeric string", () => {
      expect(toIntCents("not-a-number")).toBeUndefined();
    });
  });

  it("returns undefined for an unsupported type (e.g. boolean)", () => {
    expect(toIntCents(true as unknown)).toBeUndefined();
  });
});
