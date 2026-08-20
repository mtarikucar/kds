import {
  COUNTRY_PROFILES,
  DEFAULT_COUNTRY,
  CountryProfileCode,
} from "./country-profile.const";

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

  it("names the exact provider ids the adapters register under", () => {
    // These four strings were ALL wrong in the first draft ("generic",
    // "hugin", "nilvera", "eskiz"). They are plain strings, so nothing but
    // an explicit assertion catches a typo here. Task 9 adds the stronger
    // check that walks these against the live registries.
    const tr = COUNTRY_PROFILES.TR.capabilities;
    expect(tr.escposBuilderId).toBe("escpos-tr");        // escpos-builder.service.ts
    expect(tr.fiscalProviderIds).toContain("fiscal_hugin"); // hugin-fiscal-provider.ts
    expect(tr.paymentProviderIds).toEqual(["paytr"]);    // paytr-payment-provider.ts
    expect(tr.eDocumentAdapterId).toBe("NILVERA");       // AccountingProvider enum
    expect(tr.smsProviderId).toBe("netgsm");             // SMS_PROVIDER value
  });

  it("lists fiscal providers as a SET, because the device is a tenant choice", () => {
    // Turkey has four registered fiscal adapters; naming one in the country
    // profile would silently pick a device the restaurant may not own.
    expect(COUNTRY_PROFILES.TR.capabilities.fiscalProviderIds.length).toBeGreaterThan(1);
  });

  it("UZ declares nothing it has not built — no silent fallback to Turkish providers", () => {
    const uz = COUNTRY_PROFILES.UZ.capabilities;
    expect(uz.fiscalProviderIds).toEqual([]);
    expect(uz.paymentProviderIds).toEqual([]);
    expect(uz.eDocumentAdapterId).toBeNull();
    expect(uz.smsProviderId).toBeNull();
  });

  it("UZ has its OWN ESC/POS builder — Task 13, no longer shares the CP857 (Turkish) one", () => {
    // escpos-tr's CP857 codepage cannot represent Cyrillic at all; sharing
    // it silently turned every Cyrillic product name into '?'. escpos-uz
    // (escpos-builder-uz.service.ts) selects CP866 instead.
    expect(COUNTRY_PROFILES.UZ.capabilities.escposBuilderId).toBe("escpos-uz");
    expect(COUNTRY_PROFILES.UZ.capabilities.escposBuilderId).not.toBe(
      COUNTRY_PROFILES.TR.capabilities.escposBuilderId,
    );
  });

  it("CountryProfileCode narrows to the real keys, not to string", () => {
    // NOTE: the real proof is the `_CountryCodeIsNarrow` type in
    // country-profile.const.ts, NOT this test. tsconfig.json excludes
    // `**/*.spec.ts`, so a `@ts-expect-error` written here is never
    // typechecked — an earlier version of this test carried one and passed
    // happily against the broken `Record<string, …>` annotation.
    // This runtime half only pins the key set.
    const codes: CountryProfileCode[] = ["TR", "UZ"];
    expect(Object.keys(COUNTRY_PROFILES).sort()).toEqual(codes.sort());
  });

  it("every profile's locale fields are populated", () => {
    for (const p of Object.values(COUNTRY_PROFILES)) {
      expect(p.defaultLocale).toBeTruthy();
      expect(p.intlLocale).toBeTruthy();
      expect(p.defaultTimezone).toBeTruthy();
    }
  });

  it("no profile declares a storage minor-unit exponent — storage is always x100", () => {
    for (const p of Object.values(COUNTRY_PROFILES)) {
      expect(p).not.toHaveProperty("storageMinorExponent");
      expect(p).not.toHaveProperty("minorUnitExponent");
    }
  });
});
