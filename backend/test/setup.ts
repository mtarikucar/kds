/**
 * E2E Test Setup
 * Runs before all E2E tests
 */

// Set test environment variables. Secrets must each be ≥32 chars or
// env-validation.ts refuses to boot the app — the framework treats
// short secrets as an obvious dev-leak signal. Using long deterministic
// strings keeps the e2e harness reproducible while still satisfying
// the validator.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-chars-long-aaaa';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-must-be-at-least-32-chars-bbbb';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.SUPERADMIN_JWT_SECRET = 'test-superadmin-secret-must-be-32-chars-cccccccccc';
process.env.SUPERADMIN_JWT_REFRESH_SECRET = 'test-superadmin-refresh-secret-32-chars-dddddddd';
process.env.MARKETING_JWT_SECRET = 'test-marketing-secret-must-be-32-chars-eeeeeeee';
process.env.MARKETING_JWT_REFRESH_SECRET = 'test-marketing-refresh-32-chars-ffffffffffffffff';
process.env.ENCRYPTION_MASTER_KEY = 'test-encryption-master-key-32-chars-gggggggggg';
process.env.IP_HASH_SALT = 'test-ip-hash-salt-32-chars-hhhhhhhhhhhhhhhhhh';

// Increase timeout for E2E tests
jest.setTimeout(30000); // 30 seconds

// Global test utilities
global.beforeAll(() => {
  console.log('Starting E2E tests...');
});

global.afterAll(() => {
  console.log('E2E tests completed');
});
