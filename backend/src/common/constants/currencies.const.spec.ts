import {
  SUPPORTED_CURRENCIES,
  CURRENCY_INFO,
  DEFAULT_CURRENCY,
} from "./currencies.const";

/**
 * Long-tail drift-guard for the currency catalogue. Load-bearing
 * contracts: every supported currency has a name+symbol entry (a missing
 * entry would render `undefined` symbols on invoices), and the default
 * currency is itself supported.
 */
describe("currencies.const", () => {
  it("has a CURRENCY_INFO entry with name+symbol for every supported currency", () => {
    for (const code of SUPPORTED_CURRENCIES) {
      expect(CURRENCY_INFO[code]).toBeDefined();
      expect(CURRENCY_INFO[code].name.length).toBeGreaterThan(0);
      expect(CURRENCY_INFO[code].symbol.length).toBeGreaterThan(0);
    }
  });

  it("does not carry CURRENCY_INFO entries for unsupported codes", () => {
    expect(Object.keys(CURRENCY_INFO).sort()).toEqual(
      [...SUPPORTED_CURRENCIES].sort(),
    );
  });

  it("uses a supported currency as the default (TRY)", () => {
    expect(SUPPORTED_CURRENCIES).toContain(DEFAULT_CURRENCY);
    expect(DEFAULT_CURRENCY).toBe("TRY");
  });
});
