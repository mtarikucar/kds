import { apportionDiscount, buildFiscalLines } from "./fiscal-line-builder";

describe("fiscal-line-builder", () => {
  describe("apportionDiscount", () => {
    it("returns all-zero with no discount", () => {
      expect(apportionDiscount([600, 400], 0)).toEqual([0, 0]);
    });

    it("returns all-zero with no value to split against", () => {
      expect(apportionDiscount([0, 0], 500)).toEqual([0, 0]);
    });

    it("apportions by value and the parts sum EXACTLY to the discount", () => {
      // 1000c discount over 6000c/4000c lines → 600/400.
      const parts = apportionDiscount([6000, 4000], 1000);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
      expect(parts).toEqual([600, 400]);
    });

    it("hands leftover kuruş to the largest fractional parts (no drift)", () => {
      // 100c over three equal lines: 33.33 each → 33,33,33 + 1 leftover.
      const parts = apportionDiscount([1000, 1000, 1000], 100);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
      expect(parts.filter((p) => p === 34).length).toBe(1);
    });

    it("never apportions more than the goods are worth", () => {
      const parts = apportionDiscount([300, 200], 9999);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(500); // clamped to total
    });
  });

  describe("buildFiscalLines", () => {
    it("includes paid modifiers in the unit price and balances netCents to the goods total", () => {
      // base 30.00 + modifier 5.00 = 35.00/unit × 2 = 7000c; base 10.00 × 1 = 1000c.
      const { lines, netCents } = buildFiscalLines(
        [
          {
            productId: "p1",
            productName: "Burger",
            quantity: 2,
            unitPrice: 30,
            modifierTotal: 5,
            taxRate: 20,
          },
          {
            productId: "p2",
            productName: "Su",
            quantity: 1,
            unitPrice: 10,
            modifierTotal: 0,
          },
        ],
        0,
      );
      expect(lines[0]).toEqual({
        productCode: "p1",
        name: "Burger",
        qty: 2,
        unitPriceCents: 3500,
        vatRate: 20,
        discountCents: 0,
      });
      expect(lines[1].vatRate).toBe(10); // default when taxRate is absent
      expect(netCents).toBe(8000);
    });

    it("apportions the order discount across lines (net == goods − discount)", () => {
      const { lines, netCents } = buildFiscalLines(
        [
          { productId: "p1", quantity: 1, unitPrice: 60, modifierTotal: 0 },
          { productId: "p2", quantity: 1, unitPrice: 40, modifierTotal: 0 },
        ],
        10, // ₺10 → 1000c over 6000/4000
      );
      expect(lines[0].discountCents).toBe(600);
      expect(lines[1].discountCents).toBe(400);
      expect(netCents).toBe(9000);
    });

    it("falls back to a default name when the product name is missing", () => {
      const { lines } = buildFiscalLines(
        [{ productId: "p1", productName: null, quantity: 1, unitPrice: 5, modifierTotal: 0 }],
        0,
      );
      expect(lines[0].name).toBe("Ürün");
    });
  });
});
