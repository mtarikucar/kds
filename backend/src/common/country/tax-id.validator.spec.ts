import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { IsOptional, IsString } from "class-validator";
import { isValidTaxId, IsCountryTaxId } from "./tax-id.validator";
import { COUNTRY_PROFILES } from "./country-profile.const";
import { RequestContext } from "../context/request-context";

/**
 * The operator-typed tax id (settings/accounting/invoice forms) used to be
 * validated against a fixed VKN(10)/TCKN(11) shape everywhere — before this,
 * every Uzbek STIR(9) or PINFL(14) was rejected no matter what was typed.
 * TR behaviour must stay bit-identical since it's the fallback everywhere.
 */
describe("isValidTaxId", () => {
  const TR = COUNTRY_PROFILES.TR;
  const UZ = COUNTRY_PROFILES.UZ;

  it("TR accepts VKN(10) and TCKN(11)", () => {
    expect(isValidTaxId("1234567890", TR)).toBe(true);
    expect(isValidTaxId("12345678901", TR)).toBe(true);
  });
  it("TR rejects the Uzbek shapes", () => {
    expect(isValidTaxId("123456789", TR)).toBe(false);
    expect(isValidTaxId("12345678901234", TR)).toBe(false);
  });
  it("UZ accepts STIR(9) and PINFL(14) and rejects the Turkish shapes", () => {
    expect(isValidTaxId("123456789", UZ)).toBe(true);
    expect(isValidTaxId("12345678901234", UZ)).toBe(true);
    expect(isValidTaxId("1234567890", UZ)).toBe(false);
  });
  it("rejects non-digits and empty regardless of country", () => {
    expect(isValidTaxId("abc", TR)).toBe(false);
    expect(isValidTaxId("", UZ)).toBe(false);
  });
});

// A private throwaway DTO — @IsCountryTaxId() is exercised end-to-end
// through class-validator here; the three real call sites (tenant settings,
// accounting settings, sales invoice) get their own wiring tests in their
// respective *.spec.ts files.
class TaxIdTestDto {
  @IsOptional()
  @IsString()
  @IsCountryTaxId()
  taxId?: string;
}

const make = (taxId?: string) => plainToInstance(TaxIdTestDto, { taxId });
const errorsFor = (taxId: string | undefined, countryCode: string) =>
  RequestContext.run({ countryCode }, () => validate(make(taxId)));

describe("IsCountryTaxId decorator", () => {
  it("accepts TR shapes under a TR tenant", async () => {
    expect(await errorsFor("1234567890", "TR")).toHaveLength(0);
    expect(await errorsFor("12345678901", "TR")).toHaveLength(0);
  });

  it("rejects UZ shapes under a TR tenant", async () => {
    expect((await errorsFor("123456789", "TR")).length).toBeGreaterThan(0);
  });

  it("ACCEPTS UZ shapes under a UZ tenant — impossible before this task", async () => {
    expect(await errorsFor("123456789", "UZ")).toHaveLength(0);
    expect(await errorsFor("12345678901234", "UZ")).toHaveLength(0);
  });

  it("rejects TR shapes under a UZ tenant", async () => {
    expect((await errorsFor("1234567890", "UZ")).length).toBeGreaterThan(0);
  });

  it("falls back to the Turkish shapes outside any request", async () => {
    // Cron, seeds, bootstrap. Must not start rejecting everything.
    expect(await validate(make("1234567890"))).toHaveLength(0);
    expect((await validate(make("123456789"))).length).toBeGreaterThan(0);
  });

  it("passes through undefined — presence is @IsOptional's job", async () => {
    expect(await errorsFor(undefined, "TR")).toHaveLength(0);
  });

  it("still rejects a non-string value", async () => {
    const errors = await RequestContext.run({ countryCode: "TR" }, () =>
      validate(plainToInstance(TaxIdTestDto, { taxId: 12345 as unknown as string })),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("names the property in the rejection message", async () => {
    const errors = await errorsFor("123", "TR");
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages.some((m) => /taxId/.test(m))).toBe(true);
  });

  it("names the tenant's OWN rule names in the rejection message, not Turkey's", async () => {
    const errors = await errorsFor("bad", "UZ");
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages.some((m) => /STIR/.test(m) && /PINFL/.test(m))).toBe(
      true,
    );
  });
});
