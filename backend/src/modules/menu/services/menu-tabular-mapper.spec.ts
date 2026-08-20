import { guessColumnMap, rowsToDraft, parsePrice } from "./menu-tabular-mapper";
import { RequestContext } from "../../../common/context/request-context";

describe("parsePrice", () => {
  it("reads Turkish decimal commas and thousands dots", () => {
    expect(parsePrice("1.250,50")).toBe(1250.5);
    expect(parsePrice("25,90")).toBe(25.9);
  });
  it("reads plain and English-formatted numbers", () => {
    expect(parsePrice("180")).toBe(180);
    expect(parsePrice("1,250.50")).toBe(1250.5);
  });
  it("strips currency symbols and spaces", () => {
    expect(parsePrice("₺ 25,90")).toBe(25.9);
    expect(parsePrice("25.90 TL")).toBe(25.9);
  });
  it("returns 0 for unreadable input rather than NaN", () => {
    expect(parsePrice("")).toBe(0);
    expect(parsePrice("fiyat yok")).toBe(0);
  });
});

describe("guessColumnMap", () => {
  it("recognises Turkish headers", () => {
    expect(guessColumnMap(["Ürün Adı", "Açıklama", "Fiyat", "Kategori"])).toEqual({
      name: "Ürün Adı",
      description: "Açıklama",
      price: "Fiyat",
      category: "Kategori",
    });
  });
  it("recognises English headers", () => {
    const m = guessColumnMap(["Name", "Price"]);
    expect(m).toEqual({ name: "Name", price: "Price" });
  });
  it("returns null when name or price cannot be found", () => {
    expect(guessColumnMap(["Sütun A", "Sütun B"])).toBeNull();
    expect(guessColumnMap(["Ürün"])).toBeNull();
  });
});

describe("rowsToDraft", () => {
  const headers = ["Ad", "Fiyat", "Kategori"];
  const map = { name: "Ad", price: "Fiyat", category: "Kategori" };

  it("groups rows under their category", () => {
    const d = rowsToDraft(headers, [
      ["Ayran", "25", "İçecekler"],
      ["Kola", "30", "İçecekler"],
      ["Kebap", "180", "Ana Yemek"],
    ], map);
    expect(d.categories.map((c) => c.name)).toEqual(["İçecekler", "Ana Yemek"]);
    expect(d.categories[0].products).toHaveLength(2);
  });

  it("falls back to a single 'Menü' category when there is no category column", () => {
    const d = rowsToDraft(["Ad", "Fiyat"], [["Ayran", "25"]], { name: "Ad", price: "Fiyat" });
    expect(d.categories[0].name).toBe("Menü");
  });

  it("strips the leading apostrophe our own CSV export adds", () => {
    // csv.util.ts escapes formula-injection by prefixing '; on import it inverts.
    const d = rowsToDraft(headers, [["'=Ayran", "25", "İçecekler"]], map);
    expect(d.categories[0].products[0].name).toBe("=Ayran");
  });

  it("skips rows with no name", () => {
    const d = rowsToDraft(headers, [["", "25", "X"], ["Ayran", "25", "X"]], map);
    expect(d.categories[0].products).toHaveLength(1);
  });

  describe("taxRate column is country-scoped", () => {
    const headersWithTax = ["Ad", "Fiyat", "KDV"];
    const mapWithTax = { name: "Ad", price: "Fiyat", taxRate: "KDV" };

    it("keeps a Turkish band value (10) under a TR tenant", () => {
      const d = RequestContext.run({ countryCode: "TR" }, () =>
        rowsToDraft(headersWithTax, [["Ayran", "25", "10"]], mapWithTax),
      );
      expect(d.categories[0].products[0].taxRate).toBe(10);
    });

    it("drops a Turkish-only value (20) under a UZ tenant — not a valid QQS band", () => {
      const d = RequestContext.run({ countryCode: "UZ" }, () =>
        rowsToDraft(headersWithTax, [["Ayran", "25", "20"]], mapWithTax),
      );
      expect(d.categories[0].products[0].taxRate).toBeUndefined();
    });

    it("ACCEPTS 12 (QQS) from the sheet under a UZ tenant — impossible before", () => {
      const d = RequestContext.run({ countryCode: "UZ" }, () =>
        rowsToDraft(headersWithTax, [["Kabob", "30000", "12"]], mapWithTax),
      );
      expect(d.categories[0].products[0].taxRate).toBe(12);
    });

    it("accepts the UZ catering rate of 6", () => {
      const d = RequestContext.run({ countryCode: "UZ" }, () =>
        rowsToDraft(headersWithTax, [["Kabob", "30000", "6"]], mapWithTax),
      );
      expect(d.categories[0].products[0].taxRate).toBe(6);
    });

    it("falls back to the Turkish band outside any request context", () => {
      const d = rowsToDraft(headersWithTax, [["Ayran", "25", "10"]], mapWithTax);
      expect(d.categories[0].products[0].taxRate).toBe(10);
      const d2 = rowsToDraft(headersWithTax, [["Ayran", "25", "12"]], mapWithTax);
      expect(d2.categories[0].products[0].taxRate).toBeUndefined();
    });
  });
});
