import { COUNTRY_PROFILES, DEFAULT_COUNTRY } from "./country-profile.const";

describe("COUNTRY_PROFILES", () => {
  it("has TR and UZ", () => {
    expect(Object.keys(COUNTRY_PROFILES).sort()).toEqual(["TR", "UZ"]);
  });

  it("TR keeps today's behaviour exactly — this is the regression pin", () => {
    const tr = COUNTRY_PROFILES.TR;
    expect(tr.currency).toBe("TRY");
    expect(tr.displayDecimals).toBe(2);
    expect(tr.taxRates).toEqual([0, 1, 10, 20]);
    expect(tr.defaultTaxRate).toBe(10);
    expect(tr.phoneRegion).toBe("TR");
    expect(tr.intlLocale).toBe("tr-TR");
    expect(tr.defaultTimezone).toBe("Europe/Istanbul");
  });

  it("UZ carries the Uzbek parameters", () => {
    const uz = COUNTRY_PROFILES.UZ;
    expect(uz.currency).toBe("UZS");
    expect(uz.displayDecimals).toBe(0); // so'm shows no decimals
    expect(uz.taxRates).toContain(12);  // QQS
    expect(uz.defaultTaxRate).toBe(12);
    expect(uz.phoneRegion).toBe("UZ");
    expect(uz.defaultTimezone).toBe("Asia/Tashkent");
  });

  it("every profile's defaultTaxRate is one of its own taxRates", () => {
    for (const [code, p] of Object.entries(COUNTRY_PROFILES)) {
      expect(p.taxRates).toContain(p.defaultTaxRate);
    }
  });

  it("every profile declares at least one tax-id rule", () => {
    for (const p of Object.values(COUNTRY_PROFILES)) {
      expect(p.taxIdRules.length).toBeGreaterThan(0);
    }
  });

  it("TR tax-id rules accept VKN(10) and TCKN(11) and reject 9 digits", () => {
    const rules = COUNTRY_PROFILES.TR.taxIdRules;
    const ok = (v: string) => rules.some((r) => r.pattern.test(v));
    expect(ok("1234567890")).toBe(true);
    expect(ok("12345678901")).toBe(true);
    expect(ok("123456789")).toBe(false);
  });

  it("UZ tax-id rules accept STIR(9) and PINFL(14)", () => {
    const rules = COUNTRY_PROFILES.UZ.taxIdRules;
    const ok = (v: string) => rules.some((r) => r.pattern.test(v));
    expect(ok("123456789")).toBe(true);
    expect(ok("12345678901234")).toBe(true);
    expect(ok("1234567890")).toBe(false);
  });

  it("DEFAULT_COUNTRY exists in the map", () => {
    expect(COUNTRY_PROFILES[DEFAULT_COUNTRY]).toBeDefined();
  });

  it("no profile declares a storage minor-unit exponent — storage is always x100", () => {
    for (const p of Object.values(COUNTRY_PROFILES)) {
      expect(p).not.toHaveProperty("storageMinorExponent");
      expect(p).not.toHaveProperty("minorUnitExponent");
    }
  });
});
