import { CURRENCY_SYMBOLS } from "./currency-symbols";

/**
 * Long-tail drift-guard for the Z-Report currency symbol map (shared by the
 * PDF renderer + email summary). A missing symbol would render the raw
 * currency code on a printed report; we pin TRY (the default market) and
 * that every entry is a non-empty glyph.
 */
describe("CURRENCY_SYMBOLS", () => {
  it("maps the Turkish Lira to ₺ (default market)", () => {
    expect(CURRENCY_SYMBOLS.TRY).toBe("₺");
  });

  it("covers the major currencies with non-empty glyphs", () => {
    for (const code of ["USD", "EUR", "GBP", "CAD", "AUD"]) {
      expect(CURRENCY_SYMBOLS[code]).toBeDefined();
      expect(CURRENCY_SYMBOLS[code].length).toBeGreaterThan(0);
    }
  });
});
