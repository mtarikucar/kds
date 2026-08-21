import { normalizePhoneToE164 } from "./normalize-phone";

describe("normalizePhoneToE164 (default region TR)", () => {
  it.each([
    ["0555 123 45 67", "+905551234567"],
    ["+90 555 123 45 67", "+905551234567"],
    ["05551234567", "+905551234567"],
    ["(0555) 123-45-67", "+905551234567"],
    ["+905551234567", "+905551234567"],
    ["90 555 123 45 67", "+905551234567"],
  ])("normalizes a Turkish number %p to %p", (input, expected) => {
    expect(normalizePhoneToE164(input)).toBe(expected);
  });

  it("normalizes an explicit-international number (US) to E.164", () => {
    expect(normalizePhoneToE164("+1 202 555 0182")).toBe("+12025550182");
  });

  it("returns empty string unchanged", () => {
    expect(normalizePhoneToE164("")).toBe("");
    expect(normalizePhoneToE164("   ")).toBe("");
  });

  it("leaves an unparseable value as-is (trimmed) so the validator rejects it with a clear message", () => {
    expect(normalizePhoneToE164("not-a-phone")).toBe("not-a-phone");
    expect(normalizePhoneToE164("123")).toBe("123");
  });

  it("honors an explicit default region override", () => {
    // A bare national US number parsed under region US.
    expect(normalizePhoneToE164("(202) 555-0182", "US")).toBe("+12025550182");
  });
});

describe("normalizePhoneToE164 — the registration blind spot", () => {
  // Registration is @Public() with no tenant, so RequestContext.countryCode
  // is never set there — resolveCountryProfile(undefined) falls back to
  // DEFAULT_COUNTRY (TR), which is what the default-region branch in
  // normalizePhoneToE164 reads. This is fine IN PRACTICE only because
  // PhoneInput always emits E.164 (a leading "+"), which libphonenumber-js
  // parses correctly regardless of the region argument.
  it("MISPARSES a bare, locally-typed Uzbek number under the ambient TR fallback (no leading +)", () => {
    // A bare national UZ number, exactly as a user might type it without a
    // country selector or a "+" prefix, run through the SAME no-ambient-
    // country path registration hits. This is deliberately NOT a "PhoneInput
    // saves us" test — it proves the DTO-level gap the frontend is relied
    // upon to avoid.
    const result = normalizePhoneToE164("901234567"); // no defaultRegion → TR fallback
    expect(result).not.toBe("+998901234567");
  });

  it("parses an E.164 Uzbek number correctly with NO ambient region at all — the actual registration path", () => {
    // PhoneInput's onChange contract always emits E.164 ("+998…"), which
    // libphonenumber-js parses from the leading "+" regardless of the
    // region argument — this is why the misparse above never reaches
    // production despite the ambient-country gap.
    expect(normalizePhoneToE164("+998901234567")).toBe("+998901234567");
  });
});
