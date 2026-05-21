import { defineConfig, devices } from '@playwright/test';
// Pull backend/.env into the Playwright process so PAYTR_* (and any
// other secret the backend reads) is available to both `webServer.env`
// and the test-runner helpers. Without this the test runner only sees
// what the shell exported, and the PayTR sandbox creds in
// `backend/.env` wouldn't reach the spec files. backend/.env is
// gitignored — no secrets land in source control.
require('./backend/node_modules/dotenv').config({ path: './backend/.env' });

/**
 * Playwright configuration for E2E tests.
 *
 * `webServer` brings up both the backend (port 3000) and the frontend
 * (port 5173) on `npm run test:e2e`. The DB is expected to be migrated
 * and the Sultanahmet demo seed loaded; see SETUP.md for the one-off
 * `npm run prisma:seed && npm run seed:demo` step.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
const isCI = !!process.env.CI;
const reuseServer = !isCI; // locally, reuse running dev servers if present

// PayTR credentials for the test stack. Prefer real PAYTR_* values
// from the environment (typically backend/.env, sourced by the shell
// before running playwright). Without them, fall back to deterministic
// mock values so the suite still runs offline. The webhook helper
// reads from the same env vars so its HMAC keys match the backend.
const PAYTR_TEST_MERCHANT_ID = process.env.PAYTR_MERCHANT_ID || 'e2e-merchant-id';
const PAYTR_TEST_MERCHANT_KEY =
  process.env.PAYTR_MERCHANT_KEY || 'e2e-merchant-key-for-hmac-32-chars-long';
const PAYTR_TEST_MERCHANT_SALT =
  process.env.PAYTR_MERCHANT_SALT || 'e2e-merchant-salt-for-hmac-32-chars';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Sequential — POS/Kitchen specs share DB state
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
    ['list'],
  ],
  use: {
    // Frontend uses `/app/` base path — trailing slash is required for
    // relative URLs to resolve under Vite's `base` config. Port 5179
    // avoids colliding with another local project on 5173.
    baseURL: process.env.BASE_URL || 'http://localhost:5179/app/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Mobile-only specs live under specs/mobile/. They run in the
      // `mobile-chromium` project below so the Pixel-5 viewport drives
      // their viewport+UA, and they're explicitly excluded here so the
      // desktop suite isn't billed twice for the same assertions.
      testIgnore: ['**/specs/mobile/**'],
    },
    {
      // Mobile project — only picks up specs/mobile/**. Pixel 5 is a
      // representative phone viewport (393×851); when more device
      // shapes are needed (tablet, iPhone), add more projects here
      // with their own testMatch filters.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: ['**/specs/mobile/**/*.spec.ts'],
    },
  ],
  outputDir: 'test-results/',
  timeout: 60000,
  expect: { timeout: 10000 },
  // Bring up both services together on non-default ports so other
  // local projects on :3000 / :5173 stay untouched. Each `webServer`
  // block has its own readiness probe; Playwright won't run tests
  // until both respond.
  webServer: [
    {
      command: 'npm run start:dev',
      cwd: './backend',
      url: 'http://localhost:50080/api/health',
      reuseExistingServer: reuseServer,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // Inject deterministic PayTR creds so the webhook helper can
        // sign callbacks. Leaves backend/.env free of test secrets.
        PAYTR_MERCHANT_ID: PAYTR_TEST_MERCHANT_ID,
        PAYTR_MERCHANT_KEY: PAYTR_TEST_MERCHANT_KEY,
        PAYTR_MERCHANT_SALT: PAYTR_TEST_MERCHANT_SALT,
        PAYTR_TEST_MODE: '1',
        // Short-circuit the PayTR HTTP call in PaytrAdapter.getIframeToken
        // so create-intent works without sandbox reachability. The webhook
        // hash still uses the real MERCHANT_KEY/SALT, so simulatePaytrSuccess
        // exercises the full webhook → state-change chain.
        PAYTR_USE_FAKE_ADAPTER: 'true',
        // Static token the marketing leads ingest spec presents. Must
        // match the literal in tests/e2e/specs/marketing/ingest.spec.ts.
        MARKETING_INGEST_TOKEN: 'e2e-ingest-token-do-not-rotate-pls-32+',
      },
    },
    {
      command: 'npm run dev',
      cwd: './frontend',
      url: 'http://localhost:5179/app/',
      reuseExistingServer: reuseServer,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
