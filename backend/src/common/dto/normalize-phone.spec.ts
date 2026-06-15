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
