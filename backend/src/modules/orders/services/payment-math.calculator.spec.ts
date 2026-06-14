import { Prisma } from "@prisma/client";
import { PaymentMathCalculator } from "./payment-math.calculator";

/**
 * Direct unit spec for the pure per-item payment math that the
 * payments.service refactor folded into PaymentMathCalculator (the
 * derivePerUnitNet / perUnitGross / discountMultiplier /
 * itemTotalWithDiscount trio the read paths + payByItems delegate to).
 *
 * Pins the KDV-inclusive contract: `subtotal` is the authoritative
 * total value of the line (tax- and modifier-inclusive), so the math
 * must NOT add taxAmount/modifierTotal on top, and the order-level
 * discount distributes pro-rata via `1 - discount/totalAmount`.
 */
describe("PaymentMathCalculator", () => {
  const calc = new PaymentMathCalculator();
  const d = (v: string) => new Prisma.Decimal(v);

  describe("perUnitGross", () => {
    it("divides subtotal by quantity", () => {
      expect(
        calc.perUnitGross({ quantity: 4, subtotal: d("100.00") }).toFixed(2),
      ).toBe("25.00");
    });

    it("returns 0 for non-positive quantity (no divide-by-zero)", () => {
      expect(calc.perUnitGross({ quantity: 0, subtotal: d("100") }).toFixed(2)).toBe(
        "0.00",
      );
      expect(
        calc.perUnitGross({ quantity: -2, subtotal: d("100") }).toFixed(2),
      ).toBe("0.00");
    });
  });

  describe("discountMultiplier", () => {
    it("returns 1 when there is no discount", () => {
      expect(
        calc.discountMultiplier({ discount: d("0"), totalAmount: d("200") }).toFixed(4),
      ).toBe("1.0000");
    });

    it("returns 1 - discount/totalAmount", () => {
      // 50 off a 200 total → 0.75 multiplier.
      expect(
        calc
          .discountMultiplier({ discount: d("50"), totalAmount: d("200") })
          .toFixed(4),
      ).toBe("0.7500");
    });

    it("returns 1 when totalAmount is zero (avoids divide-by-zero)", () => {
      expect(
        calc.discountMultiplier({ discount: d("10"), totalAmount: d("0") }).toFixed(4),
      ).toBe("1.0000");
    });

    it("clamps to [0,1] when discount exceeds total", () => {
      expect(
        calc
          .discountMultiplier({ discount: d("300"), totalAmount: d("200") })
          .toFixed(4),
      ).toBe("0.0000");
    });
  });

  describe("itemTotalWithDiscount", () => {
    it("scales the line subtotal by the discount multiplier", () => {
      // subtotal 100 with a 25% order discount → 75.00
      expect(
        calc
          .itemTotalWithDiscount(
            { subtotal: d("100") },
            { discount: d("50"), totalAmount: d("200") },
          )
          .toFixed(2),
      ).toBe("75.00");
    });

    it("equals the subtotal when there is no discount", () => {
      expect(
        calc
          .itemTotalWithDiscount(
            { subtotal: d("42.50") },
            { discount: d("0"), totalAmount: d("85") },
          )
          .toFixed(2),
      ).toBe("42.50");
    });
  });

  describe("derivePerUnitNet", () => {
    it("is perUnitGross × discountMultiplier", () => {
      // 100/4 = 25 per unit, × 0.75 discount → 18.75
      expect(
        calc
          .derivePerUnitNet(
            { quantity: 4, subtotal: d("100") },
            { discount: d("50"), totalAmount: d("200") },
          )
          .toFixed(2),
      ).toBe("18.75");
    });

    it("returns 0 per unit when quantity is non-positive", () => {
      expect(
        calc
          .derivePerUnitNet(
            { quantity: 0, subtotal: d("100") },
            { discount: d("0"), totalAmount: d("200") },
          )
          .toFixed(2),
      ).toBe("0.00");
    });
  });
});
