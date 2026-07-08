import { FiscalReceiptGenerator } from "./fiscal-receipt.generator";

describe("FiscalReceiptGenerator", () => {
  const gen = new FiscalReceiptGenerator();

  it("builds KDV-inclusive lines with per-group VAT breakdown", () => {
    const r = gen.generate({
      orderNumber: "ORD-1",
      paymentMethod: "CARD",
      items: [
        { name: "Çay", quantity: 2, unitPrice: 20, taxRate: 10 }, // 40 incl, KDV = 40×10/110
        { name: "Kola", quantity: 1, unitPrice: 24, taxRate: 20 }, // 24 incl, KDV = 24×20/120 = 4
      ],
    });

    expect(r.grandTotal).toBe(64); // 40 + 24
    // group B (%10): base+kdv = 40; kdv = 40×10/110 = 3.64
    const b = r.kdvGroups.find((g) => g.group === "B")!;
    expect(b.total).toBe(40);
    expect(b.kdv).toBe(3.64);
    // group C (%20): total 24, kdv 4
    const c = r.kdvGroups.find((g) => g.group === "C")!;
    expect(c.total).toBe(24);
    expect(c.kdv).toBe(4);
    // total KDV = 3.64 + 4 = 7.64
    expect(r.totalKdv).toBe(7.64);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].kdvGroup).toBe("B");
    expect(r.paymentMethod).toBe("CARD");
  });

  it("maps a %1 rate to department group A and %0 to D", () => {
    const r = gen.generate({
      orderNumber: "ORD-2",
      items: [
        { name: "Ekmek", quantity: 1, unitPrice: 5, taxRate: 1 },
        { name: "Muaf", quantity: 1, unitPrice: 10, taxRate: 0 },
      ],
    });
    expect(r.kdvGroups.map((g) => g.group).sort()).toEqual(["A", "D"]);
    expect(r.kdvGroups.find((g) => g.group === "D")!.kdv).toBe(0);
  });
});
