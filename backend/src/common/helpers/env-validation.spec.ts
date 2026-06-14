import { validateEnv } from "./env-validation";

/**
 * Long-tail spec for fail-fast env validation. Because validateEnv calls
 * process.exit(1) on error, we stub exit/console and assert from the
 * observable side-effects: a complete dev env passes (no exit), a missing
 * required secret aborts (exit called), and short dev secrets only warn.
 *
 * NOTE: the rules array is computed at module load against NODE_ENV, so we
 * exercise the development branch (the worktree default) only.
 */
describe("validateEnv (development branch)", () => {
  const ORIGINAL = { ...process.env };
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.restoreAllMocks();
  });

  function setDevSecrets() {
    process.env.DATABASE_URL = "postgres://localhost:5432/db";
    process.env.JWT_SECRET = "dev-jwt-secret-1";
    process.env.JWT_REFRESH_SECRET = "dev-jwt-refresh-secret-2";
    process.env.SUPERADMIN_JWT_SECRET = "dev-sa-jwt-3";
    process.env.SUPERADMIN_JWT_REFRESH_SECRET = "dev-sa-refresh-4";
    process.env.ENCRYPTION_MASTER_KEY = "dev-encryption-key-5";
    process.env.INTEGRATION_KEY = "dev-integration-key-6";
  }

  it("passes (no exit) when all required dev vars are present", () => {
    setDevSecrets();
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("aborts (exit 1) when a required var is missing", () => {
    setDevSecrets();
    delete process.env.DATABASE_URL;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("warns (but does not abort) on a short core secret in dev", () => {
    setDevSecrets();
    process.env.JWT_SECRET = "short"; // < 32 chars, dev only warns
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
