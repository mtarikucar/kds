import { resolveDeploymentCountries } from "./deployment-countries";

/**
 * Task 12: DEPLOYMENT_COUNTRIES is parsed exactly once, here, so
 * env-validation.ts (boot, pre-DI) and SmsService.onApplicationBootstrap()
 * (post-DI, see its class comment) agree on what "this deployment serves
 * these countries" means instead of each carrying its own copy of the
 * parsing/uppercasing/unknown-code logic.
 */
describe("resolveDeploymentCountries", () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("defaults to TR when unset", () => {
    delete process.env.DEPLOYMENT_COUNTRIES;
    const result = resolveDeploymentCountries();
    expect(result.countryCodes).toEqual(["TR"]);
    expect(result.paymentProviderIds).toEqual(new Set(["paytr"]));
    expect(result.smsProviderIds).toEqual(new Set(["netgsm"]));
    expect(result.unknownCodes).toEqual([]);
  });

  it("defaults to TR on an empty string", () => {
    process.env.DEPLOYMENT_COUNTRIES = "";
    const result = resolveDeploymentCountries();
    expect(result.countryCodes).toEqual(["TR"]);
  });

  it("resolves UZ to an empty provider set — no payment or SMS provider exists for it yet", () => {
    process.env.DEPLOYMENT_COUNTRIES = "UZ";
    const result = resolveDeploymentCountries();
    expect(result.countryCodes).toEqual(["UZ"]);
    expect(result.paymentProviderIds.size).toBe(0);
    expect(result.smsProviderIds.size).toBe(0);
    expect(result.unknownCodes).toEqual([]);
  });

  it("unions provider ids across multiple countries", () => {
    process.env.DEPLOYMENT_COUNTRIES = "TR,UZ";
    const result = resolveDeploymentCountries();
    expect(result.countryCodes).toEqual(["TR", "UZ"]);
    expect(result.paymentProviderIds).toEqual(new Set(["paytr"]));
    expect(result.smsProviderIds).toEqual(new Set(["netgsm"]));
  });

  it("is case-insensitive and trims whitespace", () => {
    process.env.DEPLOYMENT_COUNTRIES = " tr , uz ";
    const result = resolveDeploymentCountries();
    expect(result.countryCodes).toEqual(["TR", "UZ"]);
    expect(result.unknownCodes).toEqual([]);
  });

  it("collects an unknown code without resolving it to a fallback profile", () => {
    process.env.DEPLOYMENT_COUNTRIES = "XX";
    const result = resolveDeploymentCountries();
    expect(result.unknownCodes).toEqual(["XX"]);
    expect(result.countryCodes).toEqual([]);
    expect(result.paymentProviderIds.size).toBe(0);
  });

  it("resolves the known codes in a mixed list and reports only the unknown one", () => {
    process.env.DEPLOYMENT_COUNTRIES = "TR,XX";
    const result = resolveDeploymentCountries();
    expect(result.countryCodes).toEqual(["TR"]);
    expect(result.unknownCodes).toEqual(["XX"]);
    expect(result.paymentProviderIds).toEqual(new Set(["paytr"]));
  });
});
