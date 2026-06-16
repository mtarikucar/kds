import { defineConfig, devices } from '@playwright/test';

// Minimal config for the live feature×plan UI matrix. Deliberately has NO
// globalSetup (the repo's global-setup re-seeds the Sultanahmet demo, which is
// stale vs branch-scope) and NO webServer (the backend :50080 + frontend :5179
// are booted manually against the throwaway restaurant_pos_e2e DB). baseURL is
// the current root '/' (the old '/app/' base was removed).
export default defineConfig({
  testDir: './tests/e2e/specs',
  testMatch: 'feature-plan-ui-matrix.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5179/',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
