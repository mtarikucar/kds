import { orderAddOnLinesForProvisioning, KIND_RANK } from "./provision-order";

const line = (code: string, kind: string, deps: string[] = []) => ({
  code,
  meta: { kind, deps },
});

describe("orderAddOnLinesForProvisioning", () => {
  it("provisions the licence before everything else", () => {
    const out = orderAddOnLinesForProvisioning([
      line("module_personnel", "module"),
      line("license_annual", "license"),
    ]);
    expect(out.map((l) => l.code)).toEqual([
      "license_annual",
      "module_personnel",
    ]);
  });

  it("provisions module_personnel before module_personnel_card_shift even when the cart lists the card first", () => {
    // THE MONEY BUG. Both are kind:'module' → equal KIND_RANK → a stable sort
    // preserves the cart order → purchase() looks for an ACTIVE parent that
    // does not exist yet → the whole Serializable tx rolls back AFTER PayTR
    // has already settled.
    const out = orderAddOnLinesForProvisioning([
      line("module_personnel_card_shift", "module", ["module_personnel"]),
      line("module_personnel", "module"),
    ]);
    expect(out.map((l) => l.code)).toEqual([
      "module_personnel",
      "module_personnel_card_shift",
    ]);
  });

  it("keeps credit packs last", () => {
    const out = orderAddOnLinesForProvisioning([
      line("credit_ai_photo_100", "credit", ["module_ai_studio"]),
      line("module_ai_studio", "module"),
      line("license_annual", "license"),
    ]);
    expect(out.map((l) => l.code)).toEqual([
      "license_annual",
      "module_ai_studio",
      "credit_ai_photo_100",
    ]);
  });

  it("is stable for lines with no dependency relationship", () => {
    const out = orderAddOnLinesForProvisioning([
      line("module_inventory", "module"),
      line("module_reservations", "module"),
      line("delivery_getir", "integration"),
    ]);
    expect(out.map((l) => l.code)).toEqual([
      "module_inventory",
      "module_reservations",
      "delivery_getir",
    ]);
  });

  it("falls back to input order on a dependency cycle instead of dropping a line", () => {
    // Ordering is not a money decision — the guard is. A cycle (only reachable
    // from corrupt catalog data) must never make a paid line vanish.
    const out = orderAddOnLinesForProvisioning([
      line("a", "module", ["b"]),
      line("b", "module", ["a"]),
    ]);
    expect(out.map((l) => l.code)).toEqual(["a", "b"]);
    expect(out).toHaveLength(2);
  });

  it("ignores a dep that is not in this cart", () => {
    // An already-owned parent is not a cart line. Treating its absence as a
    // missing node would strand the dependent line.
    const out = orderAddOnLinesForProvisioning([
      line("module_personnel_card_shift", "module", ["module_personnel"]),
    ]);
    expect(out.map((l) => l.code)).toEqual(["module_personnel_card_shift"]);
  });

  it("ranks an unknown kind last rather than first", () => {
    const out = orderAddOnLinesForProvisioning([
      line("mystery", "wat"),
      line("license_annual", "license"),
    ]);
    expect(out.map((l) => l.code)).toEqual(["license_annual", "mystery"]);
  });

  it("exports the rank table the checkout used to inline", () => {
    expect(KIND_RANK).toEqual({
      license: 0,
      module: 1,
      integration: 1,
      capacity: 2,
      service: 3,
      credit: 4,
    });
  });
});
