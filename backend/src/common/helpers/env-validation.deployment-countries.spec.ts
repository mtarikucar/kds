/**
 * Task 12 — DEPLOYMENT_COUNTRIES gates which providers' credentials boot
 * validation requires, so a deployment that never serves Turkey (e.g.
 * DEPLOYMENT_COUNTRIES=UZ) can boot in production without PayTR
 * credentials. Default is "TR", so an unset variable must reproduce
 * today's behaviour bit-for-bit — that is the acceptance criterion, and
 * several tests below exist purely to pin it.
 *
 * IS_PROD and the RULES/PROVIDER-REQUIREMENTS derivation are computed at
 * module load against NODE_ENV (see env-validation.spec.ts's note), so
 * exercising the production branch requires a FRESH module per scenario:
 * set env vars, `jest.resetModules()`, then `require("./env-validation")`
 * inside the test. Sharing one top-level import across tests (as the
 * sibling dev-branch spec does) cannot see the prod branch at all.
 */
describe("validateEnv — DEPLOYMENT_COUNTRIES (production branch)", () => {
  const ORIGINAL = { ...process.env };
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.restoreAllMocks();
  });

  /** Every OTHER prod-required var, so each test isolates PayTR/country behaviour. */
  function setProdSecretsExceptPaytr() {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://localhost:5432/db";
    process.env.JWT_SECRET = "a".repeat(32);
    process.env.JWT_REFRESH_SECRET = "b".repeat(32);
    process.env.SUPERADMIN_JWT_SECRET = "c".repeat(32);
    process.env.SUPERADMIN_JWT_REFRESH_SECRET = "d".repeat(32);
    process.env.ENCRYPTION_MASTER_KEY = "e".repeat(32);
    process.env.INTEGRATION_KEY = "f".repeat(32);
    process.env.CORS_ORIGIN = "https://example.com";
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_USER = "smtp-user";
    process.env.EMAIL_PASSWORD = "smtp-pass";
    process.env.PAYTR_TEST_MODE = "0";
    // Set to "" rather than deleted: validateEnv() treats "" the same as
    // unset (missing), but resolveCountryProfile() (imported by
    // env-validation.ts to read country profiles) transitively pulls in
    // PrismaService -> @prisma/client, which runs `dotenv.config()` as an
    // import side effect. dotenv only fills in keys that are `undefined` —
    // on a dev machine whose backend/.env has real PAYTR_* sandbox
    // credentials (gitignored, never committed), a `delete` here would let
    // that side effect silently repopulate these vars mid-test and make
    // the test's outcome depend on the developer's local .env contents.
    // "" is never backfilled, so the test is deterministic everywhere.
    process.env.PAYTR_MERCHANT_ID = "";
    process.env.PAYTR_MERCHANT_KEY = "";
    process.env.PAYTR_MERCHANT_SALT = "";
    process.env.PAYTR_OK_URL = "";
    process.env.PAYTR_FAIL_URL = "";
  }

  function setPaytrSecrets() {
    process.env.PAYTR_MERCHANT_ID = "merchant-123";
    process.env.PAYTR_MERCHANT_KEY = "12345678";
    process.env.PAYTR_MERCHANT_SALT = "12345678";
    process.env.PAYTR_OK_URL = "https://example.com/ok";
    process.env.PAYTR_FAIL_URL = "https://example.com/fail";
  }

  function freshValidateEnv(): () => void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require("./env-validation") as typeof import("./env-validation"))
      .validateEnv;
  }

  it("still refuses to boot without PayTR when DEPLOYMENT_COUNTRIES is unset — today's behaviour", () => {
    setProdSecretsExceptPaytr();
    delete process.env.DEPLOYMENT_COUNTRIES;

    freshValidateEnv()();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0][0]).toEqual(
      expect.stringContaining("PAYTR_MERCHANT_ID"),
    );
  });

  it("still refuses to boot without PayTR when DEPLOYMENT_COUNTRIES=TR", () => {
    setProdSecretsExceptPaytr();
    process.env.DEPLOYMENT_COUNTRIES = "TR";

    freshValidateEnv()();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0][0]).toEqual(
      expect.stringContaining("PAYTR_MERCHANT_ID"),
    );
  });

  it("boots without PayTR credentials when DEPLOYMENT_COUNTRIES=UZ", () => {
    setProdSecretsExceptPaytr();
    process.env.DEPLOYMENT_COUNTRIES = "UZ";
    // A UZ-only deployment must not need PAYTR_TEST_MODE either — PayTR is
    // not in play for it at all.
    delete process.env.PAYTR_TEST_MODE;

    freshValidateEnv()();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("requires BOTH countries' providers when DEPLOYMENT_COUNTRIES=TR,UZ", () => {
    setProdSecretsExceptPaytr();
    process.env.DEPLOYMENT_COUNTRIES = "TR,UZ";
    // PayTR creds deliberately absent — TR is in the mix, so this must fail.

    freshValidateEnv()();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0][0]).toEqual(
      expect.stringContaining("PAYTR_MERCHANT_ID"),
    );
  });

  it("boots when DEPLOYMENT_COUNTRIES=TR,UZ and PayTR credentials are present", () => {
    setProdSecretsExceptPaytr();
    process.env.DEPLOYMENT_COUNTRIES = "TR,UZ";
    setPaytrSecrets();

    freshValidateEnv()();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("refuses to boot on an unknown country code rather than silently serving nothing", () => {
    setProdSecretsExceptPaytr();
    process.env.DEPLOYMENT_COUNTRIES = "XX";

    freshValidateEnv()();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0][0]).toEqual(
      expect.stringContaining("DEPLOYMENT_COUNTRIES"),
    );
    expect(errorSpy.mock.calls[0][0]).toEqual(expect.stringContaining("XX"));
  });

  it("is bit-identical between an unset DEPLOYMENT_COUNTRIES and an explicit TR", () => {
    setProdSecretsExceptPaytr();
    delete process.env.DEPLOYMENT_COUNTRIES;
    freshValidateEnv()();
    const unsetExit = exitSpy.mock.calls.length;
    const unsetErrors = errorSpy.mock.calls.map((c) => c[0]);

    jest.clearAllMocks();
    jest.resetModules();
    process.env.DEPLOYMENT_COUNTRIES = "TR";
    freshValidateEnv()();
    const trExit = exitSpy.mock.calls.length;
    const trErrors = errorSpy.mock.calls.map((c) => c[0]);

    expect(trExit).toBe(unsetExit);
    expect(trErrors).toEqual(unsetErrors);
  });

  it("boots on a lowercase country code (case-insensitive)", () => {
    setProdSecretsExceptPaytr();
    process.env.DEPLOYMENT_COUNTRIES = "uz";

    freshValidateEnv()();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
