import { E164_PATTERN } from "./e164.const";
import { normalizePhoneToE164 } from "../dto/normalize-phone";
import { RequestContext } from "../context/request-context";

describe("E164_PATTERN", () => {
  it("accepts a Turkish and an Uzbek number", () => {
    expect(E164_PATTERN.test("+905551234567")).toBe(true);
    expect(E164_PATTERN.test("+998901234567")).toBe(true);
  });
  it("rejects a leading zero and a local-format number", () => {
    expect(E164_PATTERN.test("+0555123")).toBe(false);
    expect(E164_PATTERN.test("05551234567")).toBe(false);
  });
  it("rejects a bare-digit E.164-shaped number without the '+'", () => {
    // The optional-'+' variant used to pass this at 8 endpoints. It never
    // should have: everything reaching this regex already went through
    // @NormalizePhone, which always produces a leading '+'.
    expect(E164_PATTERN.test("905551234567")).toBe(false);
  });
});

describe("normalizePhoneToE164 ambient region", () => {
  it("parses a locally-typed Uzbek number under a UZ tenant", () => {
    RequestContext.run({ countryCode: "UZ" }, () => {
      expect(normalizePhoneToE164("90 123 45 67")).toBe("+998901234567");
    });
  });
  it("still parses a locally-typed Turkish number under a TR tenant", () => {
    RequestContext.run({ countryCode: "TR" }, () => {
      expect(normalizePhoneToE164("0555 123 45 67")).toBe("+905551234567");
    });
  });
  it("falls back to TR outside a request — cron and bootstrap keep working", () => {
    expect(normalizePhoneToE164("0555 123 45 67")).toBe("+905551234567");
  });
  it("an explicit defaultRegion argument still wins over the ambient country", () => {
    RequestContext.run({ countryCode: "UZ" }, () => {
      expect(normalizePhoneToE164("(202) 555-0182", "US")).toBe(
        "+12025550182",
      );
    });
  });
});
