import { foldMenuKey } from "./menu-key-fold";

describe("foldMenuKey", () => {
  it("folds an all-caps Turkish heading to match its lowercase spelling", () => {
    expect(foldMenuKey("İÇECEKLER")).toBe(foldMenuKey("içecekler"));
  });

  it("would NOT be satisfied by plain .toLowerCase() — that is the bug this helper fixes", () => {
    expect("İÇECEKLER".toLowerCase()).not.toBe("içecekler".toLowerCase());
  });

  it("trims surrounding whitespace", () => {
    expect(foldMenuKey("  Ana Yemek  ")).toBe(foldMenuKey("Ana Yemek"));
  });

  it("leaves plain ASCII input unaffected beyond casing", () => {
    expect(foldMenuKey("KEBAP")).toBe("kebap");
    expect(foldMenuKey("Kebap")).toBe("kebap");
  });
});
