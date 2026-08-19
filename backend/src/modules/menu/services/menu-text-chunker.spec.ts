import { chunkMenuText, mergeDrafts } from "./menu-text-chunker";

describe("chunkMenuText", () => {
  it("returns one chunk when the text fits", () => {
    expect(chunkMenuText("a\nb\nc", { maxChars: 100 })).toEqual(["a\nb\nc"]);
  });

  it("splits on line boundaries, never mid-line", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
    const chunks = chunkMenuText(text, { maxChars: 60, overlapLines: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      for (const line of c.split("\n")) {
        expect(line).toMatch(/^line-\d+$|^$/);
      }
    }
  });

  it("overlaps consecutive chunks so a heading is never orphaned", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
    const chunks = chunkMenuText(text, { maxChars: 60, overlapLines: 3 });
    const firstTail = chunks[0].split("\n").slice(-3);
    expect(chunks[1].split("\n").slice(0, 3)).toEqual(firstTail);
  });

  it("refuses rather than silently importing half the menu", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `line-${i}`).join("\n");
    expect(() => chunkMenuText(text, { maxChars: 50, maxChunks: 3 })).toThrow(
      /too long/i,
    );
  });
});

describe("mergeDrafts", () => {
  it("merges products under the same category name, case-insensitively", () => {
    const merged = mergeDrafts([
      { categories: [{ name: "İçecekler", products: [{ name: "Ayran", price: 25 }] }] },
      { categories: [{ name: "içecekler", products: [{ name: "Kola", price: 30 }] }] },
    ]);
    expect(merged.categories).toHaveLength(1);
    expect(merged.categories[0].name).toBe("İçecekler");
    expect(merged.categories[0].products.map((p) => p.name)).toEqual(["Ayran", "Kola"]);
  });

  it("de-duplicates the products the overlap produced", () => {
    const merged = mergeDrafts([
      { categories: [{ name: "Ana", products: [{ name: "Kebap", price: 180 }] }] },
      { categories: [{ name: "Ana", products: [{ name: "kebap", price: 180 }, { name: "Pide", price: 120 }] }] },
    ]);
    expect(merged.categories[0].products.map((p) => p.name)).toEqual(["Kebap", "Pide"]);
  });
});
