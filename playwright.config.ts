import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests
 *
 * Prerequisites:
 * 1. Start backend: cd backend && npm run start:dev
 * 2. Start frontend: cd frontend && npm run dev
 * 3. Run tests: npm run test:e2e
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests sequentially for order management tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1, // Single worker for sequential execution
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
    ['list'],
  ],
  use: {
    // Frontend uses /app/ base path - trailing slash is required for relative URLs to work
    baseURL: process.env.BASE_URL || 'http://localhost:5173/app/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    // Slow down actions for better visibility during debugging
    // launchOptions: { slowMo: 100 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: 'test-results/',
  // Global timeout for each test
  timeout: 60000,
  // Expect timeout
  expect: {
    timeout: 10000,
  },
});
