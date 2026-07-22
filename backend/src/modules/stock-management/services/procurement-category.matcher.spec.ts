import { matchCategory } from "./procurement-category.matcher";

describe("matchCategory", () => {
  it("matches meat by item name", () => {
    expect(matchCategory({ itemName: "Dana Kıyma" })).toBe("MEAT");
    expect(matchCategory({ itemName: "tavuk but" })).toBe("MEAT");
    expect(matchCategory({ itemName: "Somon fileto" })).toBe("MEAT");
  });
  it("prefers the category name over the item name", () => {
    expect(matchCategory({ categoryName: "Temizlik", itemName: "Bez" })).toBe(
      "CLEANING",
    );
  });
  it("matches produce, dry goods, dairy, beverage, packaging", () => {
    expect(matchCategory({ itemName: "Domates" })).toBe("PRODUCE");
    expect(matchCategory({ itemName: "Pirinç" })).toBe("DRY_GOODS");
    expect(matchCategory({ itemName: "Beyaz peynir" })).toBe("DAIRY");
    expect(matchCategory({ itemName: "Kola 1L" })).toBe("BEVERAGE");
    expect(matchCategory({ itemName: "Karton kutu" })).toBe("PACKAGING");
  });
  it("returns null when nothing matches", () => {
    expect(matchCategory({ itemName: "Zzzxq" })).toBeNull();
  });
  it("is case/diacritic tolerant", () => {
    expect(matchCategory({ itemName: "KIYMA" })).toBe("MEAT");
  });
  it("resolves cross-category substring collisions by longest keyword", () => {
    expect(matchCategory({ itemName: "Tereyağı" })).toBe("DAIRY");
    expect(matchCategory({ itemName: "Meyve suyu" })).toBe("BEVERAGE");
    expect(matchCategory({ itemName: "Sabun" })).toBe("CLEANING");
    expect(matchCategory({ itemName: "Deterjan" })).toBe("CLEANING");
    expect(matchCategory({ itemName: "Tuvalet kağıdı" })).toBe("CLEANING");
    expect(matchCategory({ itemName: "Plastik pipet" })).toBe("PACKAGING");
    expect(matchCategory({ itemName: "Karton kutu" })).toBe("PACKAGING");
  });
  it("does not false-positive short keywords as substrings of unrelated words", () => {
    // "Peçete" (napkin) folds to "pecete", which contains "et" (MEAT) as a
    // raw substring — a real production misfire before the word-boundary fix.
    expect(matchCategory({ itemName: "Peçete" })).not.toBe("MEAT");
    expect(matchCategory({ itemName: "Kağıt Peçete" })).not.toBe("MEAT");
    // "Sünger" (sponge) folds to "sunger", which contains "un" (DRY_GOODS).
    expect(matchCategory({ itemName: "Sünger" })).not.toBe("DRY_GOODS");
    // "Reçete defteri" (prescription notebook) folds to "recete defteri",
    // which contains "et" (MEAT).
    expect(matchCategory({ itemName: "Reçete defteri" })).not.toBe("MEAT");
  });
  it("still matches real items via short (<=3 char) whole-word keywords", () => {
    expect(matchCategory({ itemName: "Su" })).toBe("BEVERAGE");
    expect(matchCategory({ itemName: "Un" })).toBe("DRY_GOODS");
    expect(matchCategory({ itemName: "Dana eti" })).toBe("MEAT");
  });
});
