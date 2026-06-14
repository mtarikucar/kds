/**
 * Unit-test environment bootstrap (wired via jest `setupFiles` in
 * package.json).
 *
 * encryption.helper.requireMasterKey() reads ENCRYPTION_MASTER_KEY at call
 * time, so any unit test that transitively hits an encrypt/decrypt path
 * (e.g. CameraService.createCamera → encryptString) needs it present. This
 * was only set for e2e (test/setup.ts), so such tests passed locally off the
 * ambient .env but FAILED in CI where the secret is absent.
 *
 * Deliberately ONLY this key:
 *  - IP_HASH_SALT is intentionally left UNSET — public-stats.core.spec asserts
 *    the service's "dev-fallback-salt" path, which only runs when the salt is
 *    absent. Setting it here would break that test.
 *  - JWT/superadmin secrets aren't needed by the unit suite (it never boots a
 *    real JWT module), so they're omitted to keep the surface minimal.
 * Conditional (`= x || default`) so a spec that sets/deletes its own value
 * still wins (e.g. the "missing key throws" specs that delete it in beforeEach).
 */
process.env.ENCRYPTION_MASTER_KEY =
  process.env.ENCRYPTION_MASTER_KEY ||
  "test-encryption-master-key-32-chars-gggggggggg";
