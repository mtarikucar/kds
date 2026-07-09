import {
  resolveEffectivePrice,
  isCampaignActive,
  explodeComboLine,
  ComboValidationError,
  ComboCatalog,
} from "./combo-pricing";

const NOW = new Date("2026-07-09T12:00:00Z");

describe("resolveEffectivePrice", () => {
  it("returns list price when no campaign", () => {
    expect(resolveEffectivePrice({ price: 100 }, NOW)).toBe(100);
  });
  it("returns campaign price when window open (no dates = always)", () => {
    expect(resolveEffectivePrice({ price: 100, campaignPrice: 80 }, NOW)).toBe(
      80,
    );
  });
  it("ignores campaign before start", () => {
    expect(
      resolveEffectivePrice(
        { price: 100, campaignPrice: 80, campaignStartAt: "2026-07-10T00:00:00Z" },
        NOW,
      ),
    ).toBe(100);
  });
  it("ignores campaign after end", () => {
    expect(
      resolveEffectivePrice(
        { price: 100, campaignPrice: 80, campaignEndAt: "2026-07-08T00:00:00Z" },
        NOW,
      ),
    ).toBe(100);
  });
  it("honours campaign inside a window", () => {
    expect(
      resolveEffectivePrice(
        {
          price: 100,
          campaignPrice: 80,
          campaignStartAt: "2026-07-01T00:00:00Z",
          campaignEndAt: "2026-07-31T00:00:00Z",
        },
        NOW,
      ),
    ).toBe(80);
  });
  it("ignores a negative/garbage campaign price", () => {
    expect(resolveEffectivePrice({ price: 100, campaignPrice: -5 }, NOW)).toBe(
      100,
    );
  });
});

describe("isCampaignActive", () => {
  it("true only when it actually discounts and window open", () => {
    expect(isCampaignActive({ price: 100, campaignPrice: 80 }, NOW)).toBe(true);
    expect(isCampaignActive({ price: 100, campaignPrice: 120 }, NOW)).toBe(
      false,
    );
    expect(isCampaignActive({ price: 100 }, NOW)).toBe(false);
  });
});

// helper to assert per-line VAT extraction (KDV-inclusive)
const extract = (gross: number, rate: number) =>
  Math.round(((gross * rate) / (100 + rate)) * 100) / 100;

describe("explodeComboLine — fixed content (2 Dürüm + 2 Ayran)", () => {
  const catalog: ComboCatalog = {
    combo: { id: "combo1", price: 200 },
    groups: [
      {
        id: "g-durum",
        name: "Dürüm",
        minSelect: 1,
        maxSelect: 1,
        items: [
          {
            componentProductId: "durum",
            quantity: 2,
            priceDelta: 0,
            isDefault: true,
            component: { id: "durum", price: 90, taxRate: 10 },
          },
        ],
      },
      {
        id: "g-ayran",
        name: "Ayran",
        minSelect: 1,
        maxSelect: 1,
        items: [
          {
            componentProductId: "ayran",
            quantity: 2,
            priceDelta: 0,
            isDefault: true,
            component: { id: "ayran", price: 20, taxRate: 10 },
          },
        ],
      },
    ],
  };

  it("explodes into 4 qty-1 children summing to the combo price", () => {
    const r = explodeComboLine(catalog, [], 1, NOW); // no selections → defaults
    expect(r.children).toHaveLength(4); // 2 dürüm + 2 ayran
    r.children.forEach((c) => expect(c.quantity).toBe(1));
    const sum = r.children.reduce((s, c) => s + c.subtotal, 0);
    expect(sum).toBeCloseTo(200, 2);
    expect(r.lineTotal).toBeCloseTo(200, 2);
    // parent is a 0₺ grouping line
    expect(r.parent.subtotal).toBe(0);
    expect(r.parent.taxAmount).toBe(0);
    expect(r.parent.quantity).toBe(1);
    // parent.listUnitPrice = component list value (2*90 + 2*20 = 220) — a saving vs 200
    expect(r.parent.listUnitPrice).toBeCloseTo(220, 2);
  });

  it("keeps the invariant subtotal === unitPrice for every child (qty 1)", () => {
    const r = explodeComboLine(catalog, [], 1, NOW);
    r.children.forEach((c) => expect(c.subtotal).toBeCloseTo(c.unitPrice, 2));
  });

  it("extracts per-line VAT from each child subtotal", () => {
    const r = explodeComboLine(catalog, [], 1, NOW);
    r.children.forEach((c) =>
      expect(c.taxAmount).toBeCloseTo(extract(c.subtotal, c.taxRate), 2),
    );
    // total tax == sum of child taxes
    const t = r.children.reduce((s, c) => s + c.taxAmount, 0);
    expect(r.lineTax).toBeCloseTo(t, 2);
  });
});

describe("explodeComboLine — choice slot + priceDelta + mixed VAT", () => {
  const catalog: ComboCatalog = {
    combo: { id: "maxi", price: 150 },
    groups: [
      {
        id: "g-main",
        name: "Ana Ürün",
        minSelect: 1,
        maxSelect: 1,
        items: [
          {
            componentProductId: "burger",
            quantity: 1,
            priceDelta: 0,
            isDefault: true,
            component: { id: "burger", price: 120, taxRate: 10 },
          },
        ],
      },
      {
        id: "g-side",
        name: "Yan Ürün",
        minSelect: 1,
        maxSelect: 1,
        items: [
          {
            componentProductId: "fries-s",
            quantity: 1,
            priceDelta: 0,
            isDefault: true,
            component: { id: "fries-s", price: 40, taxRate: 10 },
          },
          {
            componentProductId: "fries-l",
            quantity: 1,
            priceDelta: 10, // büyük patates +10₺
            isDefault: false,
            component: { id: "fries-l", price: 55, taxRate: 10 },
          },
        ],
      },
      {
        id: "g-drink",
        name: "İçecek",
        minSelect: 1,
        maxSelect: 1,
        items: [
          {
            componentProductId: "cola",
            quantity: 1,
            priceDelta: 0,
            isDefault: true,
            component: { id: "cola", price: 35, taxRate: 20 },
          },
        ],
      },
    ],
  };

  it("adds priceDelta of the chosen upgrade to the combo total", () => {
    const r = explodeComboLine(
      catalog,
      [
        { groupId: "g-main", componentProductId: "burger" },
        { groupId: "g-side", componentProductId: "fries-l" }, // +10
        { groupId: "g-drink", componentProductId: "cola" },
      ],
      1,
      NOW,
    );
    expect(r.lineTotal).toBeCloseTo(160, 2); // 150 + 10 delta
    expect(r.children).toHaveLength(3);
    // cola child carries 20% VAT, burger/fries 10%
    const cola = r.children.find((c) => c.productId === "cola")!;
    expect(cola.taxRate).toBe(20);
    r.children.forEach((c) =>
      expect(c.taxAmount).toBeCloseTo(extract(c.subtotal, c.taxRate), 2),
    );
  });

  it("distributes an odd total to the exact kuruş (no drift)", () => {
    const odd: ComboCatalog = {
      combo: { id: "odd", price: 99.99 },
      groups: catalog.groups,
    };
    const r = explodeComboLine(
      odd,
      [
        { groupId: "g-main", componentProductId: "burger" },
        { groupId: "g-side", componentProductId: "fries-s" },
        { groupId: "g-drink", componentProductId: "cola" },
      ],
      1,
      NOW,
    );
    const sumCents = r.children.reduce(
      (s, c) => s + Math.round(c.subtotal * 100),
      0,
    );
    expect(sumCents).toBe(9999);
  });

  it("scales children and total by combo quantity, staying kuruş-exact", () => {
    const r = explodeComboLine(
      catalog,
      [
        { groupId: "g-main", componentProductId: "burger" },
        { groupId: "g-side", componentProductId: "fries-s" },
        { groupId: "g-drink", componentProductId: "cola" },
      ],
      3,
      NOW,
    );
    expect(r.parent.quantity).toBe(3);
    expect(r.children).toHaveLength(9); // 3 combos * 3 components
    expect(r.lineTotal).toBeCloseTo(450, 2); // 150 * 3
    const sumCents = r.children.reduce(
      (s, c) => s + Math.round(c.subtotal * 100),
      0,
    );
    expect(sumCents).toBe(45000);
  });

  it("honours a campaign price on the combo itself", () => {
    const promo: ComboCatalog = {
      combo: { id: "maxi", price: 150, campaignPrice: 120 },
      groups: catalog.groups,
    };
    const r = explodeComboLine(
      promo,
      [
        { groupId: "g-main", componentProductId: "burger" },
        { groupId: "g-side", componentProductId: "fries-s" },
        { groupId: "g-drink", componentProductId: "cola" },
      ],
      1,
      NOW,
    );
    expect(r.lineTotal).toBeCloseTo(120, 2);
  });

  it("rejects a selection count outside min/max", () => {
    expect(() =>
      explodeComboLine(
        catalog,
        [
          { groupId: "g-main", componentProductId: "burger" },
          { groupId: "g-side", componentProductId: "fries-s" },
          { groupId: "g-side", componentProductId: "fries-l" }, // 2 in a max-1 slot
          { groupId: "g-drink", componentProductId: "cola" },
        ],
        1,
        NOW,
      ),
    ).toThrow(ComboValidationError);
  });

  it("rejects a component that is not part of the group", () => {
    expect(() =>
      explodeComboLine(
        catalog,
        [
          { groupId: "g-main", componentProductId: "burger" },
          { groupId: "g-side", componentProductId: "NON_EXISTENT" },
          { groupId: "g-drink", componentProductId: "cola" },
        ],
        1,
        NOW,
      ),
    ).toThrow(ComboValidationError);
  });
});
